// @ts-nocheck
import { extension_settings } from '../../../../../extensions.js';

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
    const pageToSave = targetPage;
    if (pageToSave < 0) return;
    try {
        const handle = await getTTHandle();
        if (!handle) return;
        await handle.metadata.setExtension({
            namespace: TT_NS,
            value: { lastPage: pageToSave, savedAt: Date.now() },
        });
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
 * 从 TauriTavern metadata 恢复阅读位置
 * 在新聊天的列宽稳定后调用，返回恢复的页码（无数据时返回 0）
 */
async function restorePaginationPosition() {
    try {
        const handle = await getTTHandle();
        if (!handle) return 0;
        const meta = await handle.metadata.get();
        const saved = meta?.extensions?.[TT_NS];
        if (!saved || typeof saved.lastPage !== 'number') return 0;
        return Math.max(0, saved.lastPage);
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
let isKeyboardOpen = false;     // 虚拟键盘已弹出
let isFocusGuarding = false;    // 焦点保护窗口（键盘弹出前的短暂保护期）

// ============================================================
// Observer / Timer 句柄
// ============================================================
let resizeObserver = null;
let mutationObserver = null;
let scrollEventsAbortController = null;
let snapTimer = null;
let focusGuardTimer = null;
let keyboardRestoreTimer = null;
let positionLockRaf = null;
let colWidthRetryTimer = null;

// ============================================================
// 键盘保护：冻结 #chat 高度
// ============================================================
let frozenHeight = 0;

function freezeHeight(chat) {
    const h = getComputedStyle(chat).height;
    const n = parseFloat(h);
    if (n > 0) {
        frozenHeight = n;
        chat.style.setProperty('height',     h, 'important');
        chat.style.setProperty('max-height', h, 'important');
        chat.style.setProperty('min-height', h, 'important');
    }
}

function unfreezeHeight(chat) {
    frozenHeight = 0;
    if (!chat) return;
    chat.style.removeProperty('height');
    chat.style.removeProperty('max-height');
    chat.style.removeProperty('min-height');
}

// ============================================================
// rAF 滚动位置锁（键盘弹出期间持续修正 scrollLeft）
// ============================================================
function startPositionLock(chat) {
    stopPositionLock();
    const cw = chat.getBoundingClientRect().width;
    if (cw <= 0) return;
    const expected = lastUserPage * cw;
    function lock() {
        if (!isKeyboardOpen && !isFocusGuarding) { positionLockRaf = null; return; }
        if (Math.abs(chat.scrollLeft - expected) > 2) {
            chat.scrollLeft = expected;
        }
        positionLockRaf = requestAnimationFrame(lock);
    }
    positionLockRaf = requestAnimationFrame(lock);
}

function stopPositionLock() {
    if (positionLockRaf !== null) {
        cancelAnimationFrame(positionLockRaf);
        positionLockRaf = null;
    }
}

// ============================================================
// 超大元素收容（含 scrollable + break-before 两种策略）
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

    const pageBreakEnabled = extension_settings?.twt?.htmlPageBreakEnabled !== false;
    const chatRect = chat.getBoundingClientRect();

    const toScrollable = [];
    const toBreak      = [];

    chat.querySelectorAll('.mes_text > *').forEach(el => {
        // 跳过思维链
        if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return;

        const isContainer = (
            el.tagName === 'DIV' || el.tagName === 'TABLE' ||
            el.tagName === 'SECTION' || el.tagName === 'FORM' ||
            el.tagName === 'ARTICLE' || el.tagName === 'DETAILS' ||
            el.tagName === 'IFRAME'
        );

        // 标记/取消标记 twt-html-container
        if (isContainer) {
            el.classList.add('twt-html-container');
        } else {
            el.classList.remove('twt-html-container', 'twt-html-needs-break');
        }

        // 已经是 scrollable 的，直接沿用并重算高度
        if (el.classList.contains('twt-pagination-scrollable')) {
            const maxH = getAdaptiveMaxHeight(el, chat, colH, pageBreakEnabled);
            toScrollable.push({ el, maxH });
            if (pageBreakEnabled) toBreak.push(el);
            return;
        }

        // 跳过已决定收容的元素的子孙
        if (toScrollable.some(item => item.el.contains(el))) return;

        // 跳过普通文字流标签
        if (EXCLUDED_TAGS.has(el.tagName)) return;

        const elRect = el.getBoundingClientRect();
        const elTop = elRect.top - chatRect.top;
        const remaining = (elTop > 0 && elTop < colH) ? colH - elTop : colH;
        const currentH = el.scrollHeight;

        // DETAILS：展开后估算高度
        if (el.tagName === 'DETAILS') {
            const wasOpen = el.open;
            if (!wasOpen) el.open = true;
            const expandedH = Array.from(el.children).reduce((s, c) => s + c.scrollHeight, 0);
            if (!wasOpen) el.open = false;

            if (expandedH > remaining) {
                if (pageBreakEnabled) {
                    toBreak.push(el);
                    if (expandedH > colH) toScrollable.push({ el, maxH: colH - 20 });
                } else {
                    const maxH = remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
                    toScrollable.push({ el, maxH });
                }
            }
            elementPrevHeights.set(el, el.scrollHeight);
            return;
        }

        // 高度突变检测（未知折叠组件）
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
                    toBreak.push(el);
                    if (currentH > colH || surged) toScrollable.push({ el, maxH: colH - 20 });
                } else {
                    const maxH = remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
                    toScrollable.push({ el, maxH });
                }
            }
        }
    });

    // 写相位：断页标记
    chat.querySelectorAll('.twt-html-needs-break').forEach(el => {
        if (!toBreak.includes(el)) el.classList.remove('twt-html-needs-break');
    });
    toBreak.forEach(el => el.classList.add('twt-html-needs-break'));

    // 写相位：收容样式
    toScrollable.forEach(({ el, maxH }) => {
        el.style.setProperty('max-height', `${maxH}px`, 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
        el.classList.add('twt-pagination-scrollable');
    });

    // 越界校正（使用整数列宽，避免小数误差导致错误判断）
    if (!isTouching) {
        const cw = getColWidth(chat);
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
 * 获取整数列宽（列宽权威来源）
 * TauriTavern 等环境下 getBoundingClientRect().width 可能返回小数，
 * 必须 Math.round() 取整，否则 scrollLeft 目标累积误差会导致跳页混乱。
 */
function getColWidth(chat) {
    return Math.round(chat.getBoundingClientRect().width);
}

let scrollUnlockTimer = null;

function scrollToPage(chat, page, cw) {
    if (!chat) return;
    // 用整数列宽计算总页数，避免浮点误差
    const total = Math.round(chat.scrollWidth / cw);
    page = Math.max(0, Math.min(page, total - 1));
    lastUserPage = page;
    debouncedSavePaginationPosition();
    isScrolling = true;

    clearTimeout(scrollUnlockTimer);
    // 350ms 超时强制解锁，防止 WebView 未抛出 scrollend 导致 isScrolling 永久死锁
    scrollUnlockTimer = setTimeout(() => {
        isScrolling = false;
    }, 350);

    chat.scrollTo({ left: page * cw, behavior: 'smooth' });
}

// ============================================================
// snap 校正（scroll 结束后对齐到最近整页）
// ============================================================
function doSnap(chat) {
    if (isTouching || isKeyboardOpen || isFocusGuarding) return;
    if (!document.body.classList.contains('twt-reading-mode')) return;
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    const cw = getColWidth(chat);
    if (cw <= 0) return;

    const nearest = Math.round(chat.scrollLeft / cw);
    const expected = nearest * cw;

    if (Math.abs(chat.scrollLeft - expected) > 2) {
        chat.scrollLeft = expected;
    }
    lastUserPage = Math.round(chat.scrollLeft / cw);
    isScrolling = false;
    clearTimeout(scrollUnlockTimer);
}

// ============================================================
// 列宽初始化：等待 scrollWidth 稳定
// ============================================================
function updateColWidth() {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    const w = getColWidth(chat);
    if (w > 0) {
        // 始终使用整数列宽，避免小数像素引发的 scrollLeft 累积误差
        chat.style.setProperty('--twt-col-width', `${w}px`, 'important');
        containOversizedElements();
    }
}

function updateColWidthWhenReady(retries = 20, interval = 150) {
    clearTimeout(colWidthRetryTimer);
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    const w = getColWidth(chat);
    if (w <= 0) {
        if (retries > 0) colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
        return;
    }

    // 等待 scrollWidth 两帧稳定（容差放宽到 2，兼容高 DPI / 子像素渲染）
    const sw1 = chat.scrollWidth;
    requestAnimationFrame(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const sw2 = chat.scrollWidth;
        if (Math.abs(sw2 - sw1) > 2 && retries > 0) {
            colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
            return;
        }
        chat.style.setProperty('--twt-col-width', `${w}px`, 'important');
        containOversizedElements();
        // ③ layout 稳定后恢复阅读位置（P1 核心）
        // 先异步读取 metadata，再在下一帧安全跳页
        restorePaginationPosition().then(savedPage => {
            requestAnimationFrame(() => {
                if (!document.body.classList.contains('twt-reading-mode')) return;
                const restoredPage = savedPage > 0 ? savedPage : lastUserPage;
                if (restoredPage > 0) {
                    const cw = getColWidth(chat);
                    const total = Math.round(chat.scrollWidth / cw);
                    const page = Math.min(restoredPage, total - 1);
                    lastUserPage = page;
                    chat.scrollLeft = page * cw;
                } else {
                    chat.scrollLeft = 0;
                }
            });
        });
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

    mutationObserver = new MutationObserver(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isFocusGuarding) return;

        clearTimeout(debounceTimer);
        clearTimeout(pendingDelay);
        debounceTimer = setTimeout(() => {
            if (isTouching) {
                // 滑动中推迟，重新安排而非递归赋值 debounceTimer（防止闭包引用混乱）
                pendingDelay = setTimeout(() => {
                    if (!mutationObserver) return;
                    mutationObserver.disconnect();
                    try { containOversizedElements(); } finally {
                        mutationObserver.observe(chat, MUT_OPTS);
                    }
                }, 200);
                return;
            }
            // 暂停观察 → 处理 → 恢复：用 try/finally 确保 observe 必然执行，避免异常导致 observer 永久失效
            mutationObserver.disconnect();
            try {
                containOversizedElements();
            } finally {
                mutationObserver.observe(chat, MUT_OPTS);
            }
        }, 150);
    });

    mutationObserver.observe(chat, MUT_OPTS);
}

const MUT_OPTS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'style', 'class'],
};

function disconnectMutationObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
}

// ============================================================
// ResizeObserver
// ============================================================
function initResizeObserver() {
    const chat = getChat();
    if (!chat || resizeObserver) return;
    resizeObserver = new ResizeObserver(() => {
        if (isKeyboardOpen || isFocusGuarding) return;
        updateColWidth();
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

    // focusin：立即冻结高度 + 启动位置锁
    document.addEventListener('focusin', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const t = e.target;
        if (!t) return;
        const inputLike = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
        if (!inputLike) return;
        // 跳过段落编辑器自身的输入框
        if (t.classList.contains('twt-p-textarea') || t.closest('.twt-p-editor')) return;

        const chat = getChat();
        if (!chat) return;

        isFocusGuarding = true;
        clearTimeout(focusGuardTimer);
        if (!isKeyboardOpen) freezeHeight(chat);
        startPositionLock(chat);

        // 800ms 内键盘没确认弹出，解除保护
        focusGuardTimer = setTimeout(() => {
            isFocusGuarding = false;
            if (!isKeyboardOpen) {
                unfreezeHeight(chat);
                stopPositionLock();
            }
        }, 800);
    });

    if (!window.visualViewport) return;

    const vv = window.visualViewport;
    let lastVVH = vv.height;

    vv.addEventListener('resize', () => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const curVVH = vv.height;
        const diff = lastVVH - curVVH;

        if (diff > 100 && !isKeyboardOpen) {
            // 键盘弹出
            isKeyboardOpen = true;
            clearTimeout(keyboardRestoreTimer);
            isFocusGuarding = false;
            clearTimeout(focusGuardTimer);

            const chat = getChat();
            if (chat) {
                if (frozenHeight <= 0) freezeHeight(chat);
                chat.scrollLeft = lastUserPage * chat.getBoundingClientRect().width;
                startPositionLock(chat);
            }
        } else if (diff < -100 && isKeyboardOpen) {
            // 键盘收起
            clearTimeout(keyboardRestoreTimer);
            keyboardRestoreTimer = setTimeout(() => {
                const chat = getChat();
                const active = document.activeElement;
                // 先 blur 阻止原生焦点滚动
                if (chat?.contains(active) && (
                    active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
                )) active.blur();

                unfreezeHeight(chat);
                updateColWidth();

                requestAnimationFrame(() => {
                    const cw = chat?.getBoundingClientRect().width;
                    if (cw > 0) chat.scrollLeft = lastUserPage * cw;
                    isKeyboardOpen = false;
                    stopPositionLock();
                });
            }, 300);
        }

        lastVVH = curVVH;
    });
}

// ============================================================
// 公开 API
// ============================================================

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        if (settings) {
            document.body.classList.toggle('twt-swipe-disabled',      !settings.swipeEnabled);
            document.body.classList.toggle('twt-message-page',        !!settings.messagePageEnabled);
            document.body.classList.toggle('twt-avatar-theme-layout', settings.avatarLayoutMode === 'theme');
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
            'twt-message-page', 'twt-avatar-theme-layout'
        );
        window.removeEventListener('resize', onWindowResize);

        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        disconnectMutationObserver();

        isKeyboardOpen = false;
        isFocusGuarding = false;
        clearTimeout(keyboardRestoreTimer);
        clearTimeout(focusGuardTimer);
        stopPositionLock();

        const chat = getChat();
        unfreezeHeight(chat);
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
    if (isKeyboardOpen || isFocusGuarding) return;
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
    const chat = getChat();
    if (!chat) return;
    const cw = getColWidth(chat);
    if (cw <= 0) return;
    scrollToPage(chat, lastUserPage - 1, cw);
}

export function scrollPageRight() {
    const chat = getChat();
    if (!chat) return;
    const cw = getColWidth(chat);
    if (cw <= 0) return;
    scrollToPage(chat, lastUserPage + 1, cw);
}

export function setLastUserPage(page) {
    lastUserPage = page;
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
    isScrolling  = false;

    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    disconnectMutationObserver();

    if (!document.body.classList.contains('twt-reading-mode')) return;

    function tryBind(retries) {
        const chat = getChat();
        if (chat) {
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
    // ---- <details> 展开/折叠前置高度处理（capture 阶段）----
    document.addEventListener('click', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const summary = e.target.closest('summary');
        if (!summary) return;
        const details = summary.closest('details');
        if (!details) return;
        const chat = getChat();
        if (!chat || !chat.contains(details)) return;

        if (details.open) {
            // 折叠：移除收容样式
            details.style.removeProperty('max-height');
            details.style.removeProperty('overflow-y');
            details.classList.remove('twt-pagination-scrollable');
        } else {
            // 展开：立即加高度限制防止跳页
            const colH = chat.clientHeight;
            if (colH > 0) {
                const pageBreakEnabled = extension_settings?.twt?.htmlPageBreakEnabled !== false;
                const maxH = getAdaptiveMaxHeight(details, chat, colH, pageBreakEnabled);
                details.style.setProperty('max-height', `${maxH}px`, 'important');
                details.style.setProperty('overflow-y', 'auto', 'important');
                details.classList.add('twt-pagination-scrollable');
            }
        }
    }, true);

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

        // 有文字选区时不翻页
        if (window.getSelection().toString().length > 0) return;

        const cw = getColWidth(chat);
        if (cw <= 0) return;

        const ratio = e.clientX / window.innerWidth;
        if (ratio < 0.3) {
            scrollToPage(chat, lastUserPage - 1, cw);
        } else if (ratio > 0.7) {
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
        if (isFocusGuarding || isKeyboardOpen) return;

        // 无论是否程序滚动，只要滚动位置变化就随时更新 lastUserPage，防止页码死锁
        const cw = getColWidth(chat);
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

    chat.addEventListener('touchstart', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (document.body.classList.contains('twt-excerpt-active')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        clearTimeout(snapTimer);
        isTouching = true;
        isScrolling = false;

        touchStartX    = e.touches[0].clientX;
        touchStartY    = e.touches[0].clientY;
        touchStartLeft = chat.scrollLeft;
        touchStartTime = Date.now();
        touchIsHorizontal = null;

        const cw = getColWidth(chat);
        touchStartPage = cw > 0 ? Math.round(touchStartLeft / cw) : 0;
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

        const dx  = e.touches[0].clientX - touchStartX;
        // 使用整数列宽计算最大滚动值，与其他地方保持一致，避免小数累积误差
        const max = chat.scrollWidth - getColWidth(chat);
        chat.scrollLeft = Math.max(0, Math.min(max, touchStartLeft - dx));
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

        scrollToPage(chat, targetPage, cw);

        // 双重保险解除 isTouching：scrollend 事件（优先）+ 600ms 超时兜底（唯一，不重复）
        const cleanup = () => {
            isTouching  = false;
            isScrolling = false;
            clearTimeout(fallback);
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
