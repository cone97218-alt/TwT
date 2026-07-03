// @ts-nocheck
import { extension_settings } from '../../../extensions.js';

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
let frozenHeight  = 0;
let stableHeight  = 0; // 稳定状态下持续更新的 #chat 高度，供 freezeHeight 使用

/**
 * 更新稳定高度参考值（仅在非键盘/非焦点保护状态下调用）
 */
function saveStableHeight() {
    if (isKeyboardOpen || isFocusGuarding) return;
    const chat = getChat();
    if (!chat) return;
    const h = chat.getBoundingClientRect().height;
    if (h > 100) stableHeight = h;
}

/**
 * 冻结 #chat 高度。
 * 优先使用 stableHeight（键盘弹出前保存的正确高度），
 * 避免在键盘已经缩小视口后才调用时冻结到错误的缩小值。
 */
function freezeHeight(chat) {
    const h = stableHeight > 0 ? stableHeight : chat.getBoundingClientRect().height;
    if (h > 0) {
        frozenHeight = h;
        chat.style.setProperty('height',     `${h}px`, 'important');
        chat.style.setProperty('max-height', `${h}px`, 'important');
        chat.style.setProperty('min-height', `${h}px`, 'important');
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
    // 快照调用时的页码——锁定期间 lastUserPage 可能被浏览器原生 focus-scroll 污染，
    // 所以每帧不仅修正 scrollLeft，还把 lastUserPage 写回快照值，防止后续 doSnap 读到脏值
    const lockedPage = lastUserPage;
    const expected   = Math.round(lockedPage * cw); // Math.round 将浮点误差消除，防止轻微横向偏移
    function lock() {
        if (!isKeyboardOpen && !isFocusGuarding) { positionLockRaf = null; return; }
        if (Math.abs(chat.scrollLeft - expected) > 2) {
            chat.scrollLeft = expected;
        }
        lastUserPage = lockedPage; // 持续写回，防止漂移
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

    // 越界校正
    if (!isTouching) {
        const cw = chat.getBoundingClientRect().width;
        if (cw > 0) {
            const total = Math.ceil(chat.scrollWidth / cw);
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

function scrollToPage(chat, page, cw) {
    if (!chat) return;
    const total = Math.ceil(chat.scrollWidth / cw);
    page = Math.max(0, Math.min(page, total - 1));
    lastUserPage = page;
    isScrolling = true;
    chat.scrollTo({ left: page * cw, behavior: 'smooth' });
}

// ============================================================
// snap 校正（scroll 结束后对齐到最近整页）
// ============================================================
function doSnap(chat) {
    if (isTouching || isKeyboardOpen || isFocusGuarding) return;
    if (!document.body.classList.contains('twt-reading-mode')) return;
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    const cw = chat.getBoundingClientRect().width;
    if (cw <= 0) return;

    const nearest = Math.round(chat.scrollLeft / cw);
    const expected = nearest * cw;

    if (Math.abs(chat.scrollLeft - expected) > 2) {
        chat.scrollLeft = expected;
    }
    lastUserPage = Math.round(chat.scrollLeft / cw);
    isScrolling = false;
}

// ============================================================
// 屏幕调试条（临时，用于诊断 App 端键盘跳页问题）
// ============================================================
let _dbgBar = null;
let _dbgTimer = null;

function initDebugBar() {
    if (_dbgBar) return;
    _dbgBar = document.createElement('div');
    _dbgBar.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'background:rgba(0,0,0,0.85)', 'color:#0f0', 'font:11px monospace',
        'padding:4px 6px', 'pointer-events:none', 'white-space:pre',
        'line-height:1.4',
    ].join(';');
    document.body.appendChild(_dbgBar);
    _dbgTimer = setInterval(() => {
        const chat = getChat();
        if (!chat) return;
        const r = chat.getBoundingClientRect();
        _dbgBar.textContent = [
            `page=${lastUserPage} sl=${Math.round(chat.scrollLeft)} cw=${Math.round(r.width)}`,
            `chatH=${Math.round(r.height)} stable=${Math.round(stableHeight)} frozen=${Math.round(frozenHeight)}`,
            `winH=${window.innerHeight} kbd=${isKeyboardOpen} guard=${isFocusGuarding}`,
            `sw=${chat.scrollWidth}`,
        ].join('\n');
    }, 300);
}

function destroyDebugBar() {
    clearInterval(_dbgTimer);
    _dbgBar?.remove();
    _dbgBar = null;
}

// ============================================================
// 列宽初始化：等待 scrollWidth 稳定
// ============================================================
function updateColWidth() {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    const w = chat.getBoundingClientRect().width;
    if (w > 0) {
        chat.style.setProperty('--twt-col-width', `${w}px`, 'important');
        saveStableHeight(); // 在稳定状态下记录当前高度，供 freezeHeight 使用
        containOversizedElements();
    }
}

function updateColWidthWhenReady(retries = 20, interval = 150) {
    clearTimeout(colWidthRetryTimer);
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    const w = chat.getBoundingClientRect().width;
    if (w <= 0) {
        if (retries > 0) colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
        return;
    }

    // 等待 scrollWidth 两帧稳定
    const sw1 = chat.scrollWidth;
    requestAnimationFrame(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const sw2 = chat.scrollWidth;
        if (Math.abs(sw2 - sw1) > 1 && retries > 0) {
            colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
            return;
        }
        chat.style.setProperty('--twt-col-width', `${w}px`, 'important');
        containOversizedElements();
        requestAnimationFrame(() => {
            chat.scrollLeft = lastUserPage * w;
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

    mutationObserver = new MutationObserver(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isFocusGuarding) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (isTouching) {
                // 滑动中推迟
                debounceTimer = setTimeout(() => containOversizedElements(), 200);
                return;
            }
            // 暂停观察 → 处理 → 恢复（防止修改 class/style 触发无限递归）
            mutationObserver.disconnect();
            containOversizedElements();
            mutationObserver.observe(chat, MUT_OPTS);
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
    resizeObserver = new ResizeObserver(entries => {
        if (isFocusGuarding) return;
        if (isKeyboardOpen) return; // 已处理，跳过（冻结导致的二次触发）

        // 键盘检测：#chat 高度骤降超过 100px
        // ResizeObserver 在《重排后、绘制前》触发，
        // 在此冻结高度可以在用户看到画面之前就把列宽恢复正确，实现真正的《无闪烁》防跟页。
        // 这也是覆盖 App 端 window.resize 不触发场景的关键触发源。
        const entry = entries[entries.length - 1];
        if (entry && stableHeight > 0) {
            const currentH = entry.contentRect.height;
            if (stableHeight - currentH > 100) {
                isKeyboardOpen = true;
                clearTimeout(keyboardRestoreTimer);
                isFocusGuarding = false;
                clearTimeout(focusGuardTimer);
                freezeHeight(chat); // 使用 stableHeight，加内联样式将高度击回键盘弹出前的正确值
                const cw = chat.getBoundingClientRect().width;
                if (cw > 0) chat.scrollLeft = Math.round(lastUserPage * cw);
                startPositionLock(chat);
                return;
            }
        }

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
        const cw = chat.getBoundingClientRect().width;

        // ① 先标记保护，阻止 doSnap / scroll 处理器更新 lastUserPage
        isFocusGuarding = true;
        clearTimeout(focusGuardTimer);

        // ② 同步冻结高度（在浏览器键盘动画开始之前）
        if (!isKeyboardOpen) freezeHeight(chat);

        // ③ 同步修正 scrollLeft：浏览器可能在 focusin 之前已经把焦点元素滚动入视，
        //    这里立即拨回正确位置，然后再交给 rAF 锁持续看守
        if (cw > 0) chat.scrollLeft = lastUserPage * cw;

        // ④ 启动 rAF 位置锁（内部会快照 lastUserPage，每帧写回防漂移）
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
                // 先清键盘标记，再调 updateColWidth，
                // 这样 saveStableHeight 才能正确记录恢复后的真实高度
                isKeyboardOpen = false;
                stopPositionLock();
                updateColWidth();

                requestAnimationFrame(() => {
                    const cw = chat?.getBoundingClientRect().width;
                    if (cw > 0) chat.scrollLeft = Math.round(lastUserPage * cw);
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
        initDebugBar(); // 临时调试条，确认原因后移除
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
        stableHeight = 0;
        clearTimeout(keyboardRestoreTimer);
        clearTimeout(focusGuardTimer);
        stopPositionLock();
        destroyDebugBar(); // 临时调试条

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
    if (isFocusGuarding) return;

    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    if (!isKeyboardOpen) {
        // 检测键盘弹出：#chat 高度骤降超过 100px（且我们有稳定参考值）
        // 注意：window.resize 触发时 chatH 已经是缩小后的值，
        // 所以必须用 stableHeight（键盘弹出前保存的值）来比较，而不是当前值
        const currentH = chat.getBoundingClientRect().height;
        if (stableHeight > 0 && stableHeight - currentH > 100) {
            // 判定为键盘弹出：立即用稳定高度冻结，防止多列因高度变化而重排
            isKeyboardOpen = true;
            clearTimeout(keyboardRestoreTimer);
            freezeHeight(chat);  // 内部使用 stableHeight，冻结到键盘弹出前的正确高度
            const cw = chat.getBoundingClientRect().width;
            if (cw > 0) chat.scrollLeft = lastUserPage * cw;
            startPositionLock(chat);
            return;
        }
        // 正常 resize（旋转屏幕等），更新列宽
        updateColWidth();
    }
    // isKeyboardOpen 期间不做任何列宽/高度操作（键盘收起由 vv.resize 或 updateColWidthWhenReady 处理）
}

export function refreshPagination(targetPage = null) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    updateColWidth();
    const cw = chat.getBoundingClientRect().width;
    if (cw <= 0) return;
    const total = Math.ceil(chat.scrollWidth / cw);
    const page = targetPage !== null ? Math.max(0, Math.min(targetPage, total - 1)) : total - 1;
    requestAnimationFrame(() => {
        scrollToPage(chat, page, cw);
    });
}

export function scrollPageLeft() {
    const chat = getChat();
    if (!chat) return;
    const cw = chat.getBoundingClientRect().width;
    if (cw <= 0) return;
    scrollToPage(chat, lastUserPage - 1, cw);
}

export function scrollPageRight() {
    const chat = getChat();
    if (!chat) return;
    const cw = chat.getBoundingClientRect().width;
    if (cw <= 0) return;
    scrollToPage(chat, lastUserPage + 1, cw);
}

export function setLastUserPage(page) {
    lastUserPage = page;
}

// ============================================================
// resetPaginationBinding：切换聊天时重置并重绑定
// ============================================================
export function resetPaginationBinding(getSettings) {
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

        const cw = chat.getBoundingClientRect().width;
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
        // 键盘或焦点保护期间：如果 scrollLeft 被浏览器自动滚动行为拨动，立即拨回
        if (isKeyboardOpen || isFocusGuarding) {
            const cw = chat.getBoundingClientRect().width;
            if (cw > 0) {
                const expected = Math.round(lastUserPage * cw);
                if (Math.abs(chat.scrollLeft - expected) > 5) {
                    chat.scrollLeft = expected;
                }
            }
            return;
        }
        if (isScrolling || isTouching) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;

        clearTimeout(snapTimer);
        if (!supportsScrollend) {
            snapTimer = setTimeout(() => doSnap(chat), 120);
        } else {
            // scrollend 存在时，scroll 事件只用于更新 lastUserPage（不做 snap）
            snapTimer = setTimeout(() => {
                const cw = chat.getBoundingClientRect().width;
                if (cw > 0) lastUserPage = Math.round(chat.scrollLeft / cw);
            }, 50);
        }
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

        const cw = chat.getBoundingClientRect().width;
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
        const max = chat.scrollWidth - chat.getBoundingClientRect().width;
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

        const cw = chat.getBoundingClientRect().width;
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

        // scrollend / timeout 双重保险：解除 isTouching
        const cleanup = () => {
            isTouching = false;
            isScrolling = false;
            chat.removeEventListener('scrollend', cleanup);
            clearTimeout(fallback);
        };
        const fallback = setTimeout(cleanup, 600);
        if (supportsScrollend) chat.addEventListener('scrollend', cleanup, { once: true, signal });
        else setTimeout(cleanup, 600);  // 不支持 scrollend 时直接靠 timeout
    }, { passive: true, signal });

    chat.addEventListener('touchcancel', () => {
        isTouching    = false;
        isScrolling   = false;
        touchIsHorizontal = null;
    }, { passive: true, signal });
}
