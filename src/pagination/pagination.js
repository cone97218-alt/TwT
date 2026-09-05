// @ts-nocheck
import { extension_settings } from '../../../../../extensions.js';
import { showMoreMessages } from '../../../../../../script.js';

// ============================================================
// P1：TauriTavern API 接入层 — 阅读位置记忆
// 完全可选：标准 SillyTavern 上静默跳过，不影响任何功能
// ============================================================
const TT_NS = 'twt';  // metadata namespace

function getWin() {
    try {
        if (window.parent && window.parent.document) return window.parent;
    } catch {}
    return window;
}

/** 获取 TauriTavern Chat API handle，不可用时返回 null */
async function getTTHandle() {
    try {
        const win = getWin();
        const tt = win.__TAURITAVERN__ || window.__TAURITAVERN__ || window.parent?.__TAURITAVERN__ || window.top?.__TAURITAVERN__;
        if (!tt) return null;
        await (tt.ready ?? tt.__TAURITAVERN_MAIN_READY__);
        return tt.api?.chat?.current?.handle?.() ?? null;
    } catch {
        return null;
    }
}

let savePositionTimer = null;

/**
 * 保存当前阅读位置到 TauriTavern metadata
 */
export async function savePaginationPosition(targetPage = lastUserPage) {
    if (targetPage < 0) return;
    try {
        const handle = await getTTHandle();
        if (handle) {
            await handle.metadata.setExtension({
                namespace: TT_NS,
                value: { lastPage: targetPage, savedAt: Date.now() },
            });
        }
        if (typeof chat_metadata !== 'undefined' && chat_metadata) {
            chat_metadata[TT_NS] = chat_metadata[TT_NS] || {};
            chat_metadata[TT_NS].lastPage = targetPage;
            chat_metadata[TT_NS].savedAt = Date.now();
        }
    } catch (e) {
        console.warn('[TwT] Failed to save reading position:', e);
    }
}

export function debouncedSavePaginationPosition() {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
        savePaginationPosition(lastUserPage);
    }, 500);
}

/**
 * 从 TauriTavern / chat_metadata 恢复阅读位置
 * 在新聊天的列宽稳定后调用，返回恢复的页码（无数据时返回 0）
 */
async function restorePaginationPosition() {
    try {
        const handle = await getTTHandle();
        if (handle) {
            const meta = await handle.metadata.get();
            const saved = meta?.extensions?.[TT_NS];
            if (saved && typeof saved.lastPage === 'number') return Math.max(0, saved.lastPage);
        }
        if (typeof chat_metadata !== 'undefined' && chat_metadata?.[TT_NS]?.lastPage !== undefined) {
            return Math.max(0, Number(chat_metadata[TT_NS].lastPage) || 0);
        }
        return 0;
    } catch (e) {
        console.warn('[TwT] Failed to restore reading position:', e);
        return 0;
    }
}

// ============================================================
// 核心状态
// ============================================================
let lastUserPage = 0;           // 用户当前所在页（唯一权威来源）
let isScrolling = false;        // 正在执行程序化 scrollTo，屏蔽 snap 校正
let isTouching = false;         // 手指正在触摸屏幕

/** 判断用户当前是否在输入框打字（此时应全面暂停后台排版与重试计算，避免打字卡顿） */
export function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) && !el.classList.contains('twt-p-textarea');
}

// ============================================================
// Observer / Timer 句柄
// ============================================================
let resizeObserver = null;
let mutationObserver = null;
let scrollEventsAbortController = null;
let snapTimer = null;
let colWidthRetryTimer = null;
let stableColWidth = 0;         // Precise step cache after layout stabilizes; 0 = not established
let lastKnownScrollWidth = 0;   // Last scrollWidth seen by MutationObserver, for streaming detection
let stableColWidthTimer = null; // Timer to rebuild stableColWidth after streaming ends

// ============================================================
// 纵向滚动阻断锁：彻底杜绝多列横向布局下的 scrollTop 顶出位移
// 拦截外部脚本（如酒馆原生 showMoreMessages / scrollChatToBottom）
// 向 #chat.scrollTop 写入非 0 值的操作
// ============================================================
let isScrollTopLocked = false;
let origScrollTopDescriptor = null;

export function lockChatScrollTop(chat) {
    if (!chat || isScrollTopLocked) return;
    try {
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        if (!desc) return;
        origScrollTopDescriptor = desc;
        Object.defineProperty(chat, 'scrollTop', {
            get() {
                return 0;
            },
            set(val) {
                if (document.body.classList.contains('twt-reading-mode')) {
                    // 仅在真实 scrollTop 不为 0 时才写 0，避免重复写 DOM 属性触发重绘与脏标记
                    if (desc.get.call(chat) !== 0) {
                        desc.set.call(chat, 0);
                    }
                    return;
                }
                desc.set.call(chat, val);
            },
            configurable: true
        });
        isScrollTopLocked = true;
        if (chat.scrollTop !== 0) chat.scrollTop = 0;
    } catch (e) {
        console.warn('[TwT] Failed to lock chat.scrollTop:', e);
    }
}

export function unlockChatScrollTop(chat) {
    if (!chat || !isScrollTopLocked) return;
    try {
        delete chat.scrollTop;
        isScrollTopLocked = false;
    } catch (e) {
        console.warn('[TwT] Failed to unlock chat.scrollTop:', e);
    }
}

// ============================================================
// 消息截断机制（“要渲染 # 条消息”）历史消息加载与锚点定位
// ============================================================
let isExplicitJumpLoading = false;
let isLoadingMoreMessages = false;
let pendingMessageLoadAnchor = null;
let pendingFlipBackwards = false;

export function setExplicitJumpLoading(val) {
    isExplicitJumpLoading = !!val;
}

export function captureReadingAnchor() {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return null;
    const currentScrollLeft = chat.scrollLeft;
    const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
    if (cw <= 0) return null;
    const pageCenter = currentScrollLeft + (cw / 2);
    const chatRect = chat.getBoundingClientRect();
    const messages = Array.from(chat.querySelectorAll('.mes'));
    let closestMes = null;
    let minDistance = Infinity;
    for (let i = messages.length - 1; i >= 0; i--) {
        const mes = messages[i];
        const rect = mes.getBoundingClientRect();
        const absLeft = rect.left - chatRect.left + currentScrollLeft;
        const absRight = rect.right - chatRect.left + currentScrollLeft;
        if (pageCenter >= absLeft && pageCenter <= absRight) {
            const mesId = mes.getAttribute('mesid');
            const offsetInMes = pageCenter - absLeft;
            return { mesId, offsetInMes, rectWidth: rect.width };
        }
        const dist = Math.min(Math.abs(pageCenter - absLeft), Math.abs(pageCenter - absRight));
        if (dist < minDistance) {
            minDistance = dist;
            closestMes = { mes, absLeft, rectWidth: rect.width };
        }
    }
    if (closestMes && closestMes.mes) {
        const mesId = closestMes.mes.getAttribute('mesid');
        const offsetInMes = Math.max(0, pageCenter - closestMes.absLeft);
        return { mesId, offsetInMes, rectWidth: closestMes.rectWidth };
    }
    const firstMes = chat.querySelector('.mes');
    if (firstMes) {
        return { mesId: firstMes.getAttribute('mesid'), offsetInMes: 0, rectWidth: firstMes.getBoundingClientRect().width };
    }
    return null;
}

let activeReadingAnchor = null;
let isAutoScrollingToNewMessage = false;
let autoScrollTimeout = null;

let isReadingPositionLocked = false;
let lockedReadingAnchor = null;

export function lockReadingPosition() {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    updateActiveReadingAnchor();
    if (!activeReadingAnchor || !activeReadingAnchor.mesId) {
        activeReadingAnchor = captureReadingAnchor();
    }
    if (activeReadingAnchor) {
        lockedReadingAnchor = { ...activeReadingAnchor };
    }
    isReadingPositionLocked = true;
}

export function unlockReadingPosition() {
    isReadingPositionLocked = false;
    lockedReadingAnchor = null;
}

export function markAutoScrollingToNewMessage() {
    isAutoScrollingToNewMessage = true;
    clearTimeout(autoScrollTimeout);
    autoScrollTimeout = setTimeout(() => {
        isAutoScrollingToNewMessage = false;
    }, 2000);
}

export function updateActiveReadingAnchor() {
    if (isTouching || isScrolling || isAutoScrollingToNewMessage || isReadingPositionLocked) return;
    const anchor = captureReadingAnchor();
    if (anchor && anchor.mesId) {
        activeReadingAnchor = anchor;
    }
}

export function realignToActiveAnchor() {
    const anchor = (isReadingPositionLocked && lockedReadingAnchor) ? lockedReadingAnchor : activeReadingAnchor;
    if (!anchor || !anchor.mesId) return false;
    if (isTouching) return false;
    if (isAutoScrollingToNewMessage) return false;
    if (isReadingPositionLocked) {
        isScrolling = false;
    } else if (isScrolling) {
        return false;
    }

    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return false;

    let anchorEl = chat.querySelector(`.mes[mesid="${anchor.mesId}"]`);
    if (!anchorEl) {
        // 若当前锚点消息已被移除（如被淘汰的最旧楼层），降级对齐当前剩下的第一条消息
        anchorEl = chat.querySelector('.mes');
        if (!anchorEl) return false;
    }

    const rw = chat.getBoundingClientRect().width || chat.clientWidth;
    const sw = chat.scrollWidth;
    if (sw > 0 && rw > 0) {
        const n = Math.max(1, Math.round(sw / rw));
        stableColWidth = sw / n;
        lastKnownScrollWidth = sw;
    }
    const step = stableColWidth > 0 ? stableColWidth : getColStep(chat);
    if (step <= 0) return false;

    const chatRect = chat.getBoundingClientRect();
    const rect = anchorEl.getBoundingClientRect();
    const currentScrollLeft = chat.scrollLeft;
    const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
    const targetPos = absoluteLeft + (anchor.offsetInMes ?? (step / 2));
    const targetPage = Math.max(0, Math.floor(targetPos / step));
    const expectedScrollLeft = targetPage * step;

    if (Math.abs(chat.scrollLeft - expectedScrollLeft) > 1 || lastUserPage !== targetPage) {
        lastUserPage = targetPage;
        chat.scrollLeft = expectedScrollLeft;
        chat.scrollTop = 0;
    }
    return true;
}

export async function triggerLoadMoreMessages(isFlippingBackwards = false) {
    if (isLoadingMoreMessages) return;
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    const showMoreBtn = document.getElementById('show_more_messages');
    if (!showMoreBtn) return;

    isLoadingMoreMessages = true;
    pendingFlipBackwards = isFlippingBackwards;
    pendingMessageLoadAnchor = captureReadingAnchor();
    try {
        if (typeof showMoreMessages === 'function') {
            await showMoreMessages();
        } else {
            showMoreBtn.click();
        }
    } catch (e) {
        console.warn('[TwT] Failed to load more messages via showMoreMessages:', e);
        try {
            showMoreBtn.click();
        } catch {}
    } finally {
        isLoadingMoreMessages = false;
    }
}

export async function handleMoreMessagesLoaded(isExplicitJump = isExplicitJumpLoading) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    // 1. 深度清零纵向滚动
    chat.scrollTop = 0;
    const sheld = document.getElementById('sheld');
    if (sheld) sheld.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    // 2. 等待浏览器完成多列排版计算 (双帧等待)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // 3. 强制重排与列宽步长重算
    stableColWidth = 0;
    lastKnownScrollWidth = 0;
    clearTimeout(stableColWidthTimer);

    updateColWidth();
    containOversizedElements();
    tagToolCallMessages();
    void chat.offsetHeight;

    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
    const newSw = chat.scrollWidth;
    if (newSw > 0 && rawW > 0) {
        const n = Math.max(1, Math.round(newSw / rawW));
        stableColWidth = newSw / n;
        lastKnownScrollWidth = newSw;
    }
    const step = stableColWidth > 0 ? stableColWidth : getColStep(chat);

    // 4. 目录专属跳转：交由 Mulu 自行定向定位
    if (isExplicitJump) {
        pendingMessageLoadAnchor = null;
        pendingFlipBackwards = false;
        chat.scrollTop = 0;
        return;
    }

    // 5. 若有预先捕获的阅读锚点
    if (pendingMessageLoadAnchor && pendingMessageLoadAnchor.mesId) {
        const anchorEl = chat.querySelector(`.mes[mesid="${pendingMessageLoadAnchor.mesId}"]`);
        if (anchorEl && step > 0) {
            const chatRect = chat.getBoundingClientRect();
            const rect = anchorEl.getBoundingClientRect();
            const currentScrollLeft = chat.scrollLeft;
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const targetPos = absoluteLeft + (pendingMessageLoadAnchor.offsetInMes || 0);
            let targetPage = Math.max(0, Math.floor(targetPos / step));

            // 如果读者是在第 0 页向前翻页（左翻）触发的加载，自然滑向新加载批次的最后一页
            if (pendingFlipBackwards && targetPage > 0) {
                targetPage = targetPage - 1;
            }

            lastUserPage = targetPage;
            chat.scrollLeft = targetPage * step;
            pendingMessageLoadAnchor = null;
            pendingFlipBackwards = false;
            chat.scrollTop = 0;
            setTimeout(updateActiveReadingAnchor, 50);
            return;
        }
    }
    pendingMessageLoadAnchor = null;
    pendingFlipBackwards = false;

    // 6. 无锚点情况：确保页码安全在范围内且无纵向位移
    if (step > 0) {
        const total = Math.round(chat.scrollWidth / step);
        const page = Math.min(lastUserPage, Math.max(0, total - 1));
        chat.scrollLeft = page * step;
    }
    chat.scrollTop = 0;
    setTimeout(updateActiveReadingAnchor, 50);
}

/**
 * 处理用户发送新消息或 AI 回复渲染完成（USER_MESSAGE_RENDERED / CHARACTER_MESSAGE_RENDERED）
 * 根据 autoScrollNewMessage 配置决定是否自动翻到最新一页，或者严格保持在当前阅读位置
 */
export function handleNewMessageRendered(messageId, settings = extension_settings?.twt) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    const shouldAutoScroll = settings?.autoScrollNewMessage !== false;

    // 清零外部可能写入的纵向位移
    chat.scrollTop = 0;

    if (shouldAutoScroll) {
        unlockReadingPosition();
        markAutoScrollingToNewMessage();
        // 双帧等待，确保插入新消息及可能发生的历史截断（如 JSR cancelChatMessages）完全执行完毕
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!document.body.classList.contains('twt-reading-mode')) {
                    isAutoScrollingToNewMessage = false;
                    return;
                }

                // 重新对齐并刷新列宽步长
                const rw = chat.getBoundingClientRect().width || chat.clientWidth;
                const sw = chat.scrollWidth;
                if (sw > 0 && rw > 0) {
                    const n = Math.max(1, Math.round(sw / rw));
                    stableColWidth = sw / n;
                    lastKnownScrollWidth = sw;
                }
                const step = stableColWidth > 0 ? stableColWidth : getColStep(chat);
                if (step <= 0) {
                    isAutoScrollingToNewMessage = false;
                    return;
                }

                const total = Math.max(1, Math.round(chat.scrollWidth / step));
                let targetPage = total - 1;

                // 若传入了目标消息 ID，优先定位到该消息的起始页（方便读者从头阅读新消息）
                if (messageId !== undefined && messageId !== null) {
                    const targetMes = chat.querySelector(`.mes[mesid="${messageId}"]`);
                    if (targetMes) {
                        const chatRect = chat.getBoundingClientRect();
                        const rect = targetMes.getBoundingClientRect();
                        const absLeft = rect.left - chatRect.left + chat.scrollLeft;
                        targetPage = Math.max(0, Math.min(total - 1, Math.floor(absLeft / step)));
                    }
                }

                // 平滑翻页到最新楼层所在页
                scrollToPage(chat, targetPage, step);
                setTimeout(() => {
                    isAutoScrollingToNewMessage = false;
                    updateActiveReadingAnchor();
                }, 400);
            });
        });
    } else {
        // 关闭自动翻页：立即同步锁定并重定位锚点，随后双帧等待与延时再次对齐，抵消最旧楼层被移出导致的向左漂移或新消息导致的任何位移
        realignToActiveAnchor();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!document.body.classList.contains('twt-reading-mode')) return;
                realignToActiveAnchor();
                setTimeout(() => {
                    realignToActiveAnchor();
                }, 100);
            });
        });
    }
}

// ============================================================
// 超大元素收容与强制断页（高性能读写分离优化版）
// 100% 保留原有逻辑与折中防 Bug 判定规则，彻底消除循环内部 DOM 强制重排 (Layout Thrashing)
// ============================================================
const elementPrevHeights = new WeakMap();
const HEIGHT_SURGE_THRESHOLD = 80;

const EXCLUDED_TAGS = new Set([
    'P','SPAN','BLOCKQUOTE','PRE','OL','UL','LI',
    'H1','H2','H3','H4','H5','H6','A','CODE','EM','STRONG','I','B'
]);

function getAdaptiveMaxHeight(el, chat, colH, pageBreakEnabled) {
    if (pageBreakEnabled) return colH - 20;
    const elTop = el.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    const remaining = (elTop > 0 && elTop < colH) ? colH - elTop : colH;
    return remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
}

function containOversizedElements() {
    const chat = document.getElementById('chat');
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    const colH = chat.clientHeight;
    if (colH <= 0) return;

    // 如果启用了 HTML 弹窗召出功能，则跳过在翻页文本流中的断页与强制收容逻辑
    if (extension_settings?.twt?.htmlPopupEnabled !== false) {
        return;
    }

    const pageBreakEnabled = extension_settings?.twt?.htmlPageBreakEnabled !== false;
    const chatRect = chat.getBoundingClientRect();

    // 缓存数据计划队列，彻底分离“读相位”与“写相位”
    const toScrollable = [];
    const toBreakSet   = new Set();
    const scrollableEls = new Set();
    const containerClasses = [];

    const children = chat.querySelectorAll('.mes_text > *');

    // ------------------------------------------------------------
    // 读相位 (Phase 1: Read All Layout Data) - 全程 0 次 DOM 写入
    // ------------------------------------------------------------
    for (let i = 0; i < children.length; i++) {
        const el = children[i];

        // 1. 跳过思维链
        if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) continue;

        // 1.1 跳过 Tool Call 内部容器（避免对其内部折叠块或代码块误加 .twt-html-needs-break 导致意外断页）
        if (el.closest('.toolCall, .twt-toolcall-mes')) continue;

        const isContainer = (
            el.tagName === 'DIV' || el.tagName === 'TABLE' ||
            el.tagName === 'SECTION' || el.tagName === 'FORM' ||
            el.tagName === 'ARTICLE' || el.tagName === 'DETAILS' ||
            el.tagName === 'IFRAME'
        );
        containerClasses.push({ el, isContainer });

        // 2. 已经是 scrollable 的，直接沿用并重算高度
        if (el.classList.contains('twt-pagination-scrollable')) {
            const maxH = getAdaptiveMaxHeight(el, chat, colH, pageBreakEnabled);
            toScrollable.push({ el, maxH });
            scrollableEls.add(el);
            if (pageBreakEnabled) toBreakSet.add(el);
            continue;
        }

        // 3. 跳过已决定收容的元素的子孙
        let isChildOfScrollable = false;
        for (const scrollableParent of scrollableEls) {
            if (scrollableParent.contains(el)) {
                isChildOfScrollable = true;
                break;
            }
        }
        if (isChildOfScrollable) continue;

        // 4. 跳过普通文字流标签
        if (EXCLUDED_TAGS.has(el.tagName)) continue;

        const elRect = el.getBoundingClientRect();
        const elTop = elRect.top - chatRect.top;
        const remaining = (elTop > 0 && elTop < colH) ? colH - elTop : colH;
        const currentH = el.scrollHeight;

        // 5. DETAILS：展开后估算高度
        if (el.tagName === 'DETAILS') {
            const wasOpen = el.open;
            if (!wasOpen) el.open = true;
            const expandedH = Array.from(el.children).reduce((s, c) => s + c.scrollHeight, 0);
            if (!wasOpen) el.open = false;

            if (expandedH > remaining) {
                if (pageBreakEnabled) {
                    toBreakSet.add(el);
                    if (expandedH > colH) {
                        toScrollable.push({ el, maxH: colH - 20 });
                        scrollableEls.add(el);
                    }
                } else {
                    const maxH = remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
                    toScrollable.push({ el, maxH });
                    scrollableEls.add(el);
                }
            }
            elementPrevHeights.set(el, el.scrollHeight);
            continue;
        }

        // 6. 高度突变检测（未知折叠组件）
        const prevH = elementPrevHeights.get(el);
        const surged = prevH !== undefined && (currentH - prevH) > HEIGHT_SURGE_THRESHOLD;
        elementPrevHeights.set(el, currentH);

        if (currentH > remaining || surged) {
            const cs = getComputedStyle(el);
            const makesBFC = (
                (cs.overflow !== 'visible' && cs.overflow !== '') ||
                cs.display === 'flex' || cs.display === 'inline-flex' ||
                cs.display === 'grid' || cs.display === 'inline-grid' ||
                cs.position === 'absolute' || cs.position === 'fixed' ||
                cs.display === 'flow-root'
            );
            if (makesBFC || isContainer) {
                if (pageBreakEnabled) {
                    toBreakSet.add(el);
                    if (currentH > colH || surged) {
                        toScrollable.push({ el, maxH: colH - 20 });
                        scrollableEls.add(el);
                    }
                } else {
                    const maxH = remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
                    toScrollable.push({ el, maxH });
                    scrollableEls.add(el);
                }
            }
        }
    }

    // ------------------------------------------------------------
    // 写相位 (Phase 2: Batch DOM Writes) - 一次性集中批量写入与脏检查
    // ------------------------------------------------------------
    // 标记/取消标记 twt-html-container
    for (let i = 0; i < containerClasses.length; i++) {
        const { el, isContainer } = containerClasses[i];
        if (isContainer) {
            if (!el.classList.contains('twt-html-container')) {
                el.classList.add('twt-html-container');
            }
        } else {
            if (el.classList.contains('twt-html-container')) el.classList.remove('twt-html-container');
            if (el.classList.contains('twt-html-needs-break')) el.classList.remove('twt-html-needs-break');
        }
    }

    // 断页标记更新 (使用 Set O(1) 匹配与脏检查)
    const existingBreakEls = chat.querySelectorAll('.twt-html-needs-break');
    for (let i = 0; i < existingBreakEls.length; i++) {
        const el = existingBreakEls[i];
        if (!toBreakSet.has(el)) el.classList.remove('twt-html-needs-break');
    }
    toBreakSet.forEach(el => {
        if (!el.classList.contains('twt-html-needs-break')) el.classList.add('twt-html-needs-break');
    });

    // 收容样式批量写入 (带脏检查，避免频繁重复设 inline style)
    for (let i = 0; i < toScrollable.length; i++) {
        const { el, maxH } = toScrollable[i];
        const targetMaxH = `${maxH}px`;
        if (el.style.getPropertyValue('max-height') !== targetMaxH) {
            el.style.setProperty('max-height', targetMaxH, 'important');
        }
        if (el.style.getPropertyValue('overflow-y') !== 'auto') {
            el.style.setProperty('overflow-y', 'auto', 'important');
        }
        if (!el.classList.contains('twt-pagination-scrollable')) {
            el.classList.add('twt-pagination-scrollable');
        }
    }

    // 越界校正（优先使用稳定步长缓存）
    if (!isTouching && !isReadingPositionLocked) {
        const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
        if (cw > 0) {
            const total = Math.round(chat.scrollWidth / cw);
            if (lastUserPage >= total) {
                lastUserPage = Math.max(0, total - 1);
                chat.scrollLeft = lastUserPage * cw;
            }
        }
    }
}

// ============================================================
// 核心翻页：scrollToPage
// ============================================================
function getChat() { return document.getElementById('chat'); }

/**
 * 获取多列布局下 Chromium / WebKit 渲染引擎排版每一列的绝对精确物理步长 (Column Step S)
 * 在 CSS Multi-column 布局下，总可滚动宽度为 chat.scrollWidth，总列数为 N。
 * 每列精准步长 S = chat.scrollWidth / N。
 * 任何一页 page 的精确 scrollLeft 均为 page * S。
 * 彻底抹平因 Math.round() 整数化与亚像素 (subpixel) 渲染不匹配导致的“逐页累积偏移/左移”Bug！
 */
export function getColStep(chat) {
    if (!chat) return 0;
    if (stableColWidth > 0) return stableColWidth;
    const rawWidth = chat.getBoundingClientRect().width || chat.clientWidth;
    if (rawWidth <= 0) return 0;
    const scrollW = chat.scrollWidth;
    if (scrollW <= 0) return rawWidth;
    const n = Math.max(1, Math.round(scrollW / rawWidth));
    return scrollW / n;
}

function getColWidth(chat) {
    return getColStep(chat);
}

let scrollUnlockTimer = null;

function scrollToPage(chat, page, cw) {
    if (!chat) return;
    unlockReadingPosition();
    // Prefer the verified stable step cache to avoid streamed-layout drift
    const step = stableColWidth > 0 ? stableColWidth : cw;
    const total = Math.round(chat.scrollWidth / step);
    page = Math.max(0, Math.min(page, total - 1));
    lastUserPage = page;
    debouncedSavePaginationPosition();
    isScrolling = true;

    clearTimeout(scrollUnlockTimer);
    // 350ms timeout force-unlock, prevents isScrolling deadlock if scrollend never fires
    scrollUnlockTimer = setTimeout(() => {
        isScrolling = false;
        updateActiveReadingAnchor();
    }, 350);

    chat.scrollTo({ left: page * step, behavior: 'smooth' });
}

// ============================================================
// snap 校正（scroll 结束后对齐到最近整页）
// ============================================================
function doSnap(chat) {
    if (isTouching || isInputFocused()) return;
    if (!document.body.classList.contains('twt-reading-mode')) return;
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    if (isReadingPositionLocked) {
        realignToActiveAnchor();
        return;
    }

    // Prefer the stable step cache. When the cache is absent (stableColWidth === 0,
    // i.e. during streaming) only update lastUserPage; do NOT force-write scrollLeft,
    // because an unstable cw would jump the page to a wrong position — the root cause
    // of the "drifts right during streaming, corrects after generation" symptom.
    const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
    if (cw <= 0) return;

    const nearest = Math.round(chat.scrollLeft / cw);
    const expected = nearest * cw;

    if (Math.abs(chat.scrollLeft - expected) > 2) {
        if (stableColWidth > 0) {
            // Stable layout: safe to correct scrollLeft
            chat.scrollLeft = expected;
        }
        // Unstable layout (streaming): skip scrollLeft correction, only update lastUserPage below
    }
    lastUserPage = Math.round(chat.scrollLeft / cw);
    isScrolling = false;
    clearTimeout(scrollUnlockTimer);
    updateActiveReadingAnchor();
}

// ============================================================
// 列宽初始化：等待 scrollWidth 稳定
// ============================================================
function updateColWidth() {
    stableColWidth = 0; // Invalidate cache; layout is changing
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
    if (rawW > 0) {
        // Use precise floating-point viewport width so column-width matches the real viewport
        chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
        containOversizedElements();
        // Attempt to immediately rebuild stable step cache
        const sw = chat.scrollWidth;
        if (sw > 0) {
            const n = Math.max(1, Math.round(sw / rawW));
            stableColWidth = sw / n;
            lastKnownScrollWidth = sw;
        }
    }
}

function updateColWidthWhenReady(retries = 20, interval = 150) {
    clearTimeout(colWidthRetryTimer);
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
    if (rawW <= 0) {
        if (retries > 0) colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
        return;
    }

    // Wait for scrollWidth to stabilise over two frames (tolerance 2px for HiDPI/subpixel)
    const sw1 = chat.scrollWidth;
    requestAnimationFrame(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const sw2 = chat.scrollWidth;
        if (Math.abs(sw2 - sw1) > 2 && retries > 0) {
            colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
            return;
        }
        chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
        containOversizedElements();
        // Layout verified stable over two frames: establish precise step cache
        {
            const sw = chat.scrollWidth;
            if (sw > 0) {
                const n = Math.max(1, Math.round(sw / rawW));
                stableColWidth = sw / n;
                lastKnownScrollWidth = sw;
            }
        }
        // ③ layout stable: restore reading position (P1 core)
        const shouldRestore = extension_settings?.twt?.autoRestoreReadingPosition !== false;
        if (shouldRestore) {
            // Read metadata async, then jump to saved page in next frame
            restorePaginationPosition().then(savedPage => {
                requestAnimationFrame(() => {
                    if (!document.body.classList.contains('twt-reading-mode')) return;
                    const restoredPage = savedPage > 0 ? savedPage : lastUserPage;
                    if (restoredPage > 0) {
                        const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
                        const total = Math.round(chat.scrollWidth / cw);
                        const page = Math.min(restoredPage, total - 1);
                        lastUserPage = page;
                        chat.scrollLeft = page * cw;
                    } else {
                        chat.scrollLeft = 0;
                    }
                    setTimeout(updateActiveReadingAnchor, 100);
                });
            });
        } else {
            requestAnimationFrame(() => {
                if (!document.body.classList.contains('twt-reading-mode')) return;
                lastUserPage = 0;
                chat.scrollLeft = 0;
                setTimeout(updateActiveReadingAnchor, 100);
            });
        }
    });
}

// ============================================================
// MutationObserver：监听 DOM 变化，驱动 containOversizedElements
// ============================================================
function initMutationObserver() {
    const chat = getChat();
    if (!chat || mutationObserver) return;

    let debounceTimer = null;
    let pendingDelay  = null;
    let realignRafScheduled = false;

    mutationObserver = new MutationObserver((mutations) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isFocusGuarding) return;

        // 检查是否有消息元素从 #chat 中被移除（如历史截断移出最旧楼层）
        let mesRemoved = false;
        if (mutations && mutations.length > 0) {
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (m.type === 'childList' && m.removedNodes && m.removedNodes.length > 0) {
                    for (let j = 0; j < m.removedNodes.length; j++) {
                        const node = m.removedNodes[j];
                        if (node.nodeType === 1 && (node.classList?.contains('mes') || node.id === 'show_more_messages')) {
                            mesRemoved = true;
                            break;
                        }
                    }
                }
                if (mesRemoved) break;
            }
        }

        // 若最旧楼层在前面被截断移除，立即微任务级重定位锚点，彻底消除内容整体向前跳跃
        if (mesRemoved && !isAutoScrollingToNewMessage && !isTouching && !isScrolling) {
            realignToActiveAnchor();
            requestAnimationFrame(() => {
                realignToActiveAnchor();
            });
        }

        // 若当前处于锁定阅读位置状态（关闭新消息自动翻页中），通过 RAF 帧同步节流对齐，确保手机端绝对不产生强制重排 (Zero Layout Thrashing)
        if (isReadingPositionLocked && !isTouching && !realignRafScheduled) {
            realignRafScheduled = true;
            requestAnimationFrame(() => {
                realignRafScheduled = false;
                if (isReadingPositionLocked && !isTouching) {
                    realignToActiveAnchor();
                }
            });
        }

        // 用户打字输入期间，跳过背景重排与收容，保证键盘打字极速响应
        if (isInputFocused()) return;

        clearTimeout(debounceTimer);
        clearTimeout(pendingDelay);
        debounceTimer = setTimeout(() => {
            if (isTouching || isInputFocused()) return;
            mutationObserver.disconnect();
            try {
                containOversizedElements();
                tagToolCallMessages();
                // Streaming & content addition detection: a scrollWidth change means content appended
                const currentSW = chat.scrollWidth;
                if (currentSW !== lastKnownScrollWidth) {
                    lastKnownScrollWidth = currentSW;
                    const rw = chat.getBoundingClientRect().width || chat.clientWidth;
                    if (rw > 0) {
                        const n = Math.max(1, Math.round(currentSW / rw));
                        stableColWidth = currentSW / n;
                    }
                    // Schedule a rebuild check: if scrollWidth has not changed again after
                    // 600 ms (streaming ended), re-establish the stable step cache.
                    clearTimeout(stableColWidthTimer);
                    stableColWidthTimer = setTimeout(() => {
                        const c = getChat();
                        if (!c || !document.body.classList.contains('twt-reading-mode')) return;
                        if (c.scrollWidth === lastKnownScrollWidth) {
                            const rw2 = c.getBoundingClientRect().width || c.clientWidth;
                            if (rw2 > 0) {
                                const sw2 = c.scrollWidth;
                                const n2 = Math.max(1, Math.round(sw2 / rw2));
                                stableColWidth = sw2 / n2;
                            }
                        }
                    }, 600);
                }
            } finally {
                mutationObserver.observe(chat, MUT_OPTS);
            }
        }, 200);
    });

    mutationObserver.observe(chat, MUT_OPTS);
}

const MUT_OPTS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
};

function disconnectMutationObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
}

// ============================================================
// ResizeObserver（带防抖与打字期静默）
// ============================================================
let resizeDebounceTimer = null;
function initResizeObserver() {
    const chat = getChat();
    if (!chat || resizeObserver) return;
    resizeObserver = new ResizeObserver(() => {
        if (isInputFocused()) return;
        clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
            if (!document.body.classList.contains('twt-reading-mode')) return;
            if (isInputFocused()) return;
            const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
            if (rawW <= 0) return;
            const currentVar = chat.style.getPropertyValue('--twt-col-width');
            if (currentVar !== `${rawW}px`) {
                updateColWidth();
                realignToActiveAnchor();
            }
        }, 120);
    });
    resizeObserver.observe(chat);
}

// ============================================================
// patchScrollIntoView（阅读模式内禁止 scrollIntoView 劫持滚动位置）
// ============================================================
let scrollIntoViewPatched = false;
function patchScrollIntoView() {
    if (scrollIntoViewPatched) return;
    scrollIntoViewPatched = true;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
        if (document.body.classList.contains('twt-reading-mode') && this.closest('#chat')) return;
        orig.apply(this, args);
    };
}

// ============================================================
// 虚拟键盘防护
// ============================================================
let keyboardGuardInit = false;

function initVirtualKeyboardGuard() {
    if (keyboardGuardInit) return;
    keyboardGuardInit = true;

    // 当输入框失焦（键盘收起）时，平滑轻量校准一次阅读锚点
    document.addEventListener('focusout', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            setTimeout(() => {
                if (!isInputFocused()) {
                    const chat = getChat();
                    if (!chat) return;
                    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
                    if (rawW > 0 && chat.style.getPropertyValue('--twt-col-width') !== `${rawW}px`) {
                        updateColWidth();
                    }
                    realignToActiveAnchor();
                }
            }, 250);
        }
    });
}

/**
 * 获取消息楼层编号文本（如 "#15"）
 */
function getMessageFloorText(mes) {
    const idDisplay = mes.querySelector('.mesIDDisplay');
    const text = idDisplay?.textContent?.trim();
    if (text) {
        return text.startsWith('#') ? text : `#${text}`;
    }
    const mesId = mes.getAttribute('mesid');
    if (mesId !== null && mesId !== undefined && mesId !== '') {
        return `#${mesId}`;
    }
    const chat = mes.parentElement;
    if (chat) {
        const allMes = Array.from(chat.querySelectorAll('.mes'));
        const idx = allMes.indexOf(mes);
        if (idx >= 0) return `#${idx}`;
    }
    return '';
}

/**
 * 注入或更新 Tool Call 楼层的专属楼层徽章
 */
function updateToolCallFloorBadge(mes) {
    const floorText = getMessageFloorText(mes);
    if (!floorText) return;

    const summary = mes.querySelector('.mes_text details summary');
    if (summary) {
        let badge = summary.querySelector('.twt-toolcall-floor-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'twt-toolcall-floor-badge';
            summary.prepend(badge);
        }
        const badgeContent = `<i class="fa-solid fa-wrench"></i><span>${floorText} 工具调用</span>`;
        if (badge.innerHTML !== badgeContent) {
            badge.innerHTML = badgeContent;
        }
        if (!summary.querySelector('.twt-toolcall-arrow')) {
            const arrow = document.createElement('i');
            arrow.className = 'fa-solid fa-chevron-right twt-toolcall-arrow';
            summary.appendChild(arrow);
        }
    } else {
        const mesText = mes.querySelector('.mes_text');
        if (mesText) {
            let badge = mesText.querySelector(':scope > .twt-toolcall-floor-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'twt-toolcall-floor-badge';
                badge.style.marginBottom = '4px';
                mesText.prepend(badge);
            }
            const badgeContent = `<i class="fa-solid fa-wrench"></i><span>${floorText} 工具调用</span>`;
            if (badge.innerHTML !== badgeContent) {
                badge.innerHTML = badgeContent;
            }
        }
    }
}

/**
 * 为 Tool Call 楼层打上标记类名，以便 CSS 规则匹配
 */
export function tagToolCallMessages(settings = extension_settings?.twt) {
    const chat = getChat();
    if (!chat) return;
    const selector = settings?.toolCallSelector?.trim() || '.mes.toolCall, .mes[is_system="true"].toolCall';
    try {
        const matches = chat.querySelectorAll(selector);
        matches.forEach(el => {
            const mes = el.closest('.mes') || el;
            if (!mes.classList.contains('twt-toolcall-mes')) {
                mes.classList.add('twt-toolcall-mes');
            }
            updateToolCallFloorBadge(mes);
        });
    } catch (e) {
        console.warn('[TwT] Invalid toolCallSelector:', e);
    }
}

// ============================================================
// 公开 API
// ============================================================

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        const chat = getChat();
        if (chat) lockChatScrollTop(chat);
        if (settings) {
            document.body.classList.toggle('twt-swipe-disabled',      !settings.swipeEnabled);
            document.body.classList.toggle('twt-message-page',        !!settings.messagePageEnabled);
            document.body.classList.toggle('twt-avatar-theme-layout', settings.avatarLayoutMode === 'theme');
            document.body.classList.toggle('twt-toolcall-hide',       settings.toolCallMode === 'hide');
            document.body.classList.toggle('twt-toolcall-compact',    settings.toolCallMode === 'compact');
            document.body.classList.toggle('twt-toolcall-minimal',    (settings.toolCallMode || 'minimal') === 'minimal');
            document.body.classList.toggle('twt-toolcall-no-break',   settings.toolCallNoPageBreak !== false);
            tagToolCallMessages(settings);
        }
        updateColWidthWhenReady();
        window.addEventListener('resize', onWindowResize);
        initResizeObserver();
        patchScrollIntoView();
        initVirtualKeyboardGuard();
        initMutationObserver();
    } else {
        document.body.classList.remove(
            'twt-reading-mode', 'twt-swipe-disabled',
            'twt-message-page', 'twt-avatar-theme-layout',
            'twt-toolcall-hide', 'twt-toolcall-compact', 'twt-toolcall-minimal', 'twt-toolcall-no-break'
        );
        window.removeEventListener('resize', onWindowResize);

        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        disconnectMutationObserver();

        const chat = getChat();
        if (chat) unlockChatScrollTop(chat);
        if (chat) {
            chat.querySelectorAll('.twt-pagination-scrollable').forEach(el => {
                el.style.removeProperty('max-height');
                el.style.removeProperty('overflow-y');
                el.classList.remove('twt-pagination-scrollable');
            });
            chat.querySelectorAll('.twt-html-container, .twt-html-needs-break').forEach(el => {
                el.classList.remove('twt-html-container', 'twt-html-needs-break');
            });
        }
    }
}

function onWindowResize() {
    if (isInputFocused()) return;
    updateColWidth();
}

export function refreshPagination(targetPage = null) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    updateColWidth();
    const cw = getColWidth(chat);
    if (cw <= 0) return;
    const total = Math.round(chat.scrollWidth / cw);
    const page = targetPage !== null ? Math.max(0, Math.min(targetPage, total - 1)) : total - 1;
    requestAnimationFrame(() => {
        scrollToPage(chat, page, cw);
    });
}

export function scrollPageLeft() {
    if (isInputFocused()) return;
    const chat = getChat();
    if (!chat) return;
    const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
    if (cw <= 0) return;
    if (lastUserPage <= 0 && document.getElementById('show_more_messages')) {
        triggerLoadMoreMessages(true);
        return;
    }
    scrollToPage(chat, lastUserPage - 1, cw);
}

export function scrollPageRight() {
    if (isInputFocused()) return;
    const chat = getChat();
    if (!chat) return;
    const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
    if (cw <= 0) return;
    scrollToPage(chat, lastUserPage + 1, cw);
}

export function setLastUserPage(page) {
    lastUserPage = page;
}

/**
 * 核心归正功能：全向深度归正（左右翻页网格校准 + 纵向打字顶出位移复原）
 * 1. 深度清零 #chat、所有祖先容器及 window/body 的 scrollTop 纵向偏移
 * 2. 解除可能处于冻结状态的 #chat 容器高度与焦点保护锁
 * 3. 强制重置 #chat 内部所有消息块及子容器的纵向滚动偏位
 * 4. 触发强制重排 (Reflow) 与列宽校准，消除横向亚像素漂移并重置 scrollLeft
 * @param {boolean} verbose 是否弹出 Toast 提示与打印控制台诊断日志
 * @returns {object|null} 返回归正前后的物理偏差诊断报告
 */
export function realignPagination(verbose = true) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) {
        if (verbose && typeof toastr !== 'undefined') {
            toastr.info('当前未处于翻页阅读模式，无需归正。', '翻页归正');
        }
        return null;
    }

    // 1. 采集归正前的纵向漂移与横向物理数据
    const prevChatScrollTop = chat.scrollTop || 0;
    const prevWinScrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    
    let ancestorScrollTopSum = 0;
    let node = chat.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
        if (node.scrollTop > 0) {
            ancestorScrollTopSum += node.scrollTop;
            node.scrollTop = 0;
        }
        node = node.parentElement;
    }

    // 2. 强制清零所有层级的纵向滚动
    chat.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    try {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {}

    const sheld = document.getElementById('sheld');
    if (sheld) sheld.scrollTop = 0;

    // 清理聊天区内部所有子元素可能产生的 scrollTop
    const internalScrolled = chat.querySelectorAll('.mes, .mes_text, .mes_block');
    internalScrolled.forEach(el => {
        if (el.scrollTop > 0) el.scrollTop = 0;
    });

    // 4. 采集横向网格数据
    const rawW = chat.getBoundingClientRect().width || chat.clientWidth || 0;
    const scrollW = chat.scrollWidth || 0;
    const currentScrollLeft = chat.scrollLeft;
    const currentPage = lastUserPage;

    const calcStep = getColStep(chat);
    const expectedScrollLeft = currentPage * (stableColWidth > 0 ? stableColWidth : calcStep);
    const offsetDelta = currentScrollLeft - expectedScrollLeft;
    const subpixelDrift = (currentScrollLeft % (calcStep || 1)).toFixed(3);
    const totalPages = calcStep > 0 ? Math.round(scrollW / calcStep) : 1;

    // 5. 执行物理归正重置与强制 Reflow
    stableColWidth = 0;
    lastKnownScrollWidth = 0;
    clearTimeout(stableColWidthTimer);

    if (rawW > 0) {
        chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
    }

    containOversizedElements();

    // 强制同步重排，确保高度和列断点恢复正常
    void chat.offsetHeight;

    const newSw = chat.scrollWidth;
    if (newSw > 0 && rawW > 0) {
        const n = Math.max(1, Math.round(newSw / rawW));
        stableColWidth = newSw / n;
        lastKnownScrollWidth = newSw;
    }

    const finalStep = stableColWidth > 0 ? stableColWidth : calcStep;
    const finalMaxPage = finalStep > 0 ? Math.max(0, Math.round(newSw / finalStep) - 1) : 0;
    const targetPage = Math.min(currentPage, finalMaxPage);
    lastUserPage = targetPage;

    // 物理强行归正对齐
    chat.scrollLeft = targetPage * finalStep;
    chat.scrollTop = 0;
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch {}

    const totalVerticalDrift = Number((prevChatScrollTop + prevWinScrollY + ancestorScrollTopSum).toFixed(2));
    const report = {
        currentPage: targetPage,
        totalPages: finalMaxPage + 1,
        currentScrollLeft: Number(currentScrollLeft.toFixed(2)),
        expectedScrollLeft: Number(expectedScrollLeft.toFixed(2)),
        offsetDelta: Number(offsetDelta.toFixed(2)),
        subpixelDrift: Number(subpixelDrift),
        verticalDrift: totalVerticalDrift,
        colWidth: Number(calcStep.toFixed(2)),
        scrollWidth: newSw,
        viewportWidth: rawW
    };

    // 6. 诊断日志输出
    const logMsg = `🔍 全向归正诊断：当前页 [${targetPage + 1}/${finalMaxPage + 1}]，` +
                   `横向偏差: ${offsetDelta > 0 ? '+' : ''}${offsetDelta.toFixed(2)}px，` +
                   `纵向顶出位移: ${totalVerticalDrift}px (已完全复原)`;
    console.log('[TwT] ' + logMsg);

    // 7. 用户 Toast 反馈
    if (verbose && typeof toastr !== 'undefined') {
        const absDelta = Math.abs(offsetDelta).toFixed(1);
        let msg = '翻页排版已完成全向归正！';
        if (totalVerticalDrift > 0 && Math.abs(offsetDelta) > 1) {
            msg = `翻页排版已归正！(复原顶出: ${totalVerticalDrift}px，修正偏移: ${absDelta}px)`;
        } else if (totalVerticalDrift > 0) {
            msg = `上下顶出已复原！(清理纵向位移: ${totalVerticalDrift}px)`;
        } else {
            msg = `翻页网格已完成归正！(偏移偏差: ${offsetDelta > 0 ? '+' : ''}${absDelta}px → 0.00px)`;
        }
        toastr.success(msg, '翻页归正');
    }

    return report;
}

// ============================================================
// resetPaginationBinding：切换聊天时重置并重绑定
// ============================================================
import { invalidateMuluStoreCache } from '../mulu/mulu.js';

export function resetPaginationBinding(getSettings) {
    // ① 切换前：抓取并保存旧聊天的阅读位置
    const oldPage = lastUserPage;
    if (oldPage > 0) {
        savePaginationPosition(oldPage);
    }
    invalidateMuluStoreCache();

    // 中止旧事件
    if (scrollEventsAbortController) {
        scrollEventsAbortController.abort();
        scrollEventsAbortController = null;
    }

    lastUserPage = 0;
    stableColWidth = 0;
    lastKnownScrollWidth = 0;
    clearTimeout(stableColWidthTimer);
    isScrolling  = false;

    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    disconnectMutationObserver();

    if (!document.body.classList.contains('twt-reading-mode')) return;

    function tryBind(retries) {
        const chat = getChat();
        if (chat) {
            lockChatScrollTop(chat);
            initResizeObserver();
            bindScrollEvents(getSettings);
            // ② 切换后：列宽稳定时会触发位置恢复（见 updateColWidthWhenReady）
            updateColWidthWhenReady();
            initMutationObserver();
        } else if (retries > 0) {
            setTimeout(() => tryBind(retries - 1), 100);
        }
    }
    tryBind(20);
}

// ============================================================
// initPaginationEvent：全局一次性初始化（不随聊天切换重建）
// ============================================================
export function initPaginationEvent(getSettings) {

    // ---- 点击翻页（委托到 document，不随 #chat 重建而失效）----
    document.addEventListener('click', e => {
        const settings = getSettings();
        if (!settings?.enabled) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (document.body.classList.contains('twt-excerpt-active')) return;

        // 自定义菜单显示中，不翻页
        const menu = document.getElementById('twt-custom-menu');
        if (menu && getComputedStyle(menu).display !== 'none') return;

        const chat = getChat();
        if (!chat?.contains(e.target)) return;

        // 专门处理点击加载更多历史消息按钮
        const showMoreClicked = e.target.closest('#show_more_messages');
        if (showMoreClicked) {
            e.preventDefault();
            e.stopPropagation();
            triggerLoadMoreMessages(false);
            return;
        }

        // 装饰层穿透修复：若 e.target 的 pointer-events 计算值为 none，
        // 说明它是美化主题中的装饰性容器（如 .mesAvatarWrapper），
        // 其伪元素（::before/::after）虽拦截了点击，但父容器声明不接受事件，
        // 此类点击应视为对空白区域的翻页意图，跳过交互元素检测。
        let skipInteractiveCheck = false;
        try {
            if (getComputedStyle(e.target).pointerEvents === 'none') skipInteractiveCheck = true;
        } catch { /* ignore */ }

        if (!skipInteractiveCheck) {
            // Tool Call 区域防误触
            if (settings?.toolCallPreventFlip !== false) {
                const tcSel = settings?.toolCallSelector?.trim() || '.mes.toolCall, .mes[is_system="true"].toolCall';
                try {
                    if (e.target.closest(tcSel) || e.target.closest('.twt-toolcall-mes')) return;
                } catch {
                    if (e.target.closest('.mes.toolCall') || e.target.closest('.twt-toolcall-mes')) return;
                }
            }

            // 交互元素判断
            const baseSelector = 'button, a, input, textarea, select, label, summary, [onclick], [role="button"], [tabindex], .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon';
            let interactive = false;
            if (settings.customWhitelist?.trim()) {
                try { interactive = !!e.target.closest(settings.customWhitelist.trim()); }
                catch { /* 无效选择器忽略 */ }
            }
            if (!interactive) interactive = !!e.target.closest(baseSelector);
            if (!interactive) {
                try { interactive = getComputedStyle(e.target).cursor === 'pointer'; } catch { /* ignore */ }
            }
            if (interactive) return;
        }

        // 有文字选区时不翻页
        if (window.getSelection().toString().length > 0) return;

        const cw = getColWidth(chat);
        if (cw <= 0) return;

        const ratio = e.clientX / window.innerWidth;
        if (ratio < 0.3) {
            unlockReadingPosition();
            if (lastUserPage <= 0 && document.getElementById('show_more_messages')) {
                triggerLoadMoreMessages(true);
                return;
            }
            scrollToPage(chat, lastUserPage - 1, cw);
        } else if (ratio > 0.7) {
            unlockReadingPosition();
            scrollToPage(chat, lastUserPage + 1, cw);
        }
    });

    // 初次绑定 #chat 上的 scroll / touch 事件
    bindScrollEvents(getSettings);
}

// ============================================================
// bindScrollEvents：绑定 #chat 的 scroll / touch 事件
// ============================================================
function bindScrollEvents(getSettings) {
    const chat = getChat();
    if (!chat) return;

    if (scrollEventsAbortController) scrollEventsAbortController.abort();
    scrollEventsAbortController = new AbortController();
    const signal = scrollEventsAbortController.signal;

    // ---- Scroll snap 校正 ----
    // 优先使用 scrollend；不支持时降级为 scroll + debounce
    const supportsScrollend = 'onscrollend' in window;

    if (supportsScrollend) {
        chat.addEventListener('scrollend', () => {
            if (isTouching) return;
            doSnap(chat);
        }, { signal });
    }

    chat.addEventListener('scroll', () => {
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isInputFocused()) return;
        if (isReadingPositionLocked) return;

        // Update lastUserPage whenever scrollLeft changes (prevents page-number deadlock).
        // Prefer the stable step cache to avoid wrong rounding during streaming.
        const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
        if (cw > 0) {
            lastUserPage = Math.round(chat.scrollLeft / cw);
        }

        clearTimeout(snapTimer);
        // 防抖 snap：不管浏览器是否触发 scrollend，100ms 无滚动动作后强制进行 doSnap 检查
        snapTimer = setTimeout(() => {
            if (!isTouching && !isScrolling) {
                doSnap(chat);
            }
        }, 100);
    }, { signal });

    // ---- 触摸滑动翻页 ----
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartLeft = 0;
    let touchStartTime = 0;
    let touchIsHorizontal = null; // null=未判定, true=横, false=纵
    let touchStartPage = 0;
    let touchMaxScroll = 0;

    chat.addEventListener('touchstart', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (document.body.classList.contains('twt-excerpt-active')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        clearTimeout(snapTimer);
        unlockReadingPosition();
        isTouching = true;
        isScrolling = false;

        touchStartX    = e.touches[0].clientX;
        touchStartY    = e.touches[0].clientY;
        touchStartLeft = chat.scrollLeft;
        touchStartTime = Date.now();
        touchIsHorizontal = null;

        const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
        touchStartPage = cw > 0 ? Math.round(touchStartLeft / cw) : 0;
        touchMaxScroll = Math.max(0, chat.scrollWidth - (cw > 0 ? cw : (chat.clientWidth || 100)));
    }, { passive: true, signal });

    chat.addEventListener('touchmove', e => {
        if (!isTouching) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-excerpt-active')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        const adx = Math.abs(e.touches[0].clientX - touchStartX);
        const ady = Math.abs(e.touches[0].clientY - touchStartY);

        // 方向判定（首次移动 8px 以上才判定）
        if (touchIsHorizontal === null) {
            if (adx > 8 || ady > 8) touchIsHorizontal = adx >= ady;
            return;
        }
        if (!touchIsHorizontal) return;

        const dx = e.touches[0].clientX - touchStartX;
        chat.scrollLeft = Math.max(0, Math.min(touchMaxScroll, touchStartLeft - dx));
    }, { passive: true, signal });

    chat.addEventListener('touchend', e => {
        if (!isTouching) return;

        const wasHorizontal = touchIsHorizontal;
        touchIsHorizontal = null;

        if (!document.body.classList.contains('twt-reading-mode')) {
            isTouching = false; return;
        }
        if (document.body.classList.contains('twt-paragraph-editing')) {
            isTouching = false; return;
        }
        if (document.body.classList.contains('twt-excerpt-active')) {
            isTouching = false; return;
        }
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) {
            isTouching = false; return;
        }

        if (!wasHorizontal) {
            isTouching = false;
            return;
        }

        const cw = getColWidth(chat);
        if (cw <= 0) { isTouching = false; return; }

        const dx        = e.changedTouches[0].clientX - touchStartX;
        const dt        = Date.now() - touchStartTime;
        const fastSwipe = dt < 300 && Math.abs(dx) > 30;
        const longSwipe = Math.abs(dx) > cw * 0.25;

        let targetPage;
        if (fastSwipe || longSwipe) {
            targetPage = dx > 0 ? touchStartPage - 1 : touchStartPage + 1;
        } else {
            // 未超阈值：吸附到最近整页（但限制在 startPage ± 1）
            const nearest = Math.round(chat.scrollLeft / cw);
            targetPage = Math.max(touchStartPage - 1, Math.min(touchStartPage + 1, nearest));
        }

        if (targetPage < 0) {
            if (document.getElementById('show_more_messages')) {
                isTouching = false;
                isScrolling = false;
                triggerLoadMoreMessages(true);
                return;
            }
        }

        scrollToPage(chat, targetPage, cw);

        // 双重保险解除 isTouching：scrollend 事件（优先）+ 600ms 超时兜底（唯一，不重复）
        const cleanup = () => {
            isTouching  = false;
            isScrolling = false;
            clearTimeout(fallback);
            updateActiveReadingAnchor();
        };
        const fallback = setTimeout(cleanup, 600);
        // 无论是否支持 scrollend，fallback 始终兜底；支持时 scrollend 可提前触发
        if (supportsScrollend) chat.addEventListener('scrollend', cleanup, { once: true, signal });
    }, { passive: true, signal });

    chat.addEventListener('touchcancel', () => {
        isTouching    = false;
        isScrolling   = false;
        touchIsHorizontal = null;
    }, { passive: true, signal });
}
