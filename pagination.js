// @ts-nocheck
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        if (settings) {
            document.body.classList.toggle('twt-swipe-disabled', !settings.swipeEnabled);
            document.body.classList.toggle('twt-message-page', !!settings.messagePageEnabled);
        }
        updateColWidth();
        window.addEventListener('resize', updateColWidth);
        initResizeObserver();
        patchScrollIntoView();
    } else {
        document.body.classList.remove('twt-reading-mode', 'twt-swipe-disabled', 'twt-message-page');
        window.removeEventListener('resize', updateColWidth);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
    }
}

function updateColWidth() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;
    const width = chatContainer.clientWidth;
    if (width > 0) {
        chatContainer.style.setProperty('--twt-col-width', `${width}px`, 'important');
    }
}

/**
 * 消息内容变化后（如段落编辑保存），从外部调用此函数
 * 重新计算列宽并跳转到最后一页（或指定页）
 */
export function refreshPagination(targetPage = null) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;
    updateColWidth();
    const cw = chatContainer.clientWidth;
    if (cw <= 0) return;
    const totalPages = Math.round(chatContainer.scrollWidth / cw);
    const page = targetPage !== null ? Math.max(0, Math.min(targetPage, totalPages - 1)) : totalPages - 1;
    // 用 requestAnimationFrame 确保 DOM 已经刷新完毕
    requestAnimationFrame(() => {
        chatContainer.scrollTo({ left: page * cw, behavior: 'smooth' });
        lastUserPage = page;
    });
}


function initResizeObserver() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || resizeObserver) return;
    resizeObserver = new ResizeObserver(updateColWidth);
    resizeObserver.observe(chatContainer);
}

let isScrollIntoViewPatched = false;
function patchScrollIntoView() {
    if (isScrollIntoViewPatched) return;
    isScrollIntoViewPatched = true;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(...args) {
        if (document.body.classList.contains('twt-reading-mode') && this.closest('#chat')) return;
        original.apply(this, args);
    };
}

// 统一翻页动画：所有翻页（点击 / 滑动松手）都走这个函数
function scrollToPage(chatContainer, targetPage, cw) {
    isProgrammaticScrolling = true;
    lastUserPage = targetPage;
    chatContainer.scrollTo({ left: targetPage * cw, behavior: 'smooth' });
}

// 供段落编辑器工具栏按钮调用的翻页函数
export function scrollPageLeft() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    const cw = chatContainer.clientWidth;
    if (cw <= 0) return;
    const currentPage = Math.round(chatContainer.scrollLeft / cw);
    scrollToPage(chatContainer, Math.max(0, currentPage - 1), cw);
}

export function scrollPageRight() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    const cw = chatContainer.clientWidth;
    if (cw <= 0) return;
    const currentPage = Math.round(chatContainer.scrollLeft / cw);
    const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / cw) - 1);
    scrollToPage(chatContainer, Math.min(maxPage, currentPage + 1), cw);
}

let isScrollEventsBound = false;

export function initPaginationEvent(getSettings) {
    // 点击翻页
    document.addEventListener('click', function(e) {
        const settings = getSettings();
        if (!settings?.enabled) return;

        // 如果界面上存在自定义消息操作菜单且处于可见状态，点击时不触发翻页（该点击会仅用于隐藏菜单）
        const customMenu = document.getElementById('twt-custom-menu');
        if (customMenu && window.getComputedStyle(customMenu).display !== 'none') {
            return;
        }

        // 段落编辑模式激活时，屏蔽所有翻页，让点按专门用于段落勾选
        if (document.body.classList.contains('twt-paragraph-editing')) {
            return;
        }

        const chatContainer = document.getElementById('chat');
        if (!chatContainer?.contains(e.target)) return;

        const baseSelector = 'button, a, input, textarea, select, .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon';
        let isInteractive = false;
        if (settings.customWhitelist?.trim()) {
            try { isInteractive = !!e.target.closest(settings.customWhitelist.trim()); }
            catch (err) { console.warn('[TwT] Invalid custom whitelist selector:', err); }
        }
        if (!isInteractive) isInteractive = !!e.target.closest(baseSelector);
        if (isInteractive) return;
        if (window.getSelection().toString().length > 0) return;

        const cw = chatContainer.clientWidth;
        if (cw <= 0) return;

        const currentPage = Math.round(chatContainer.scrollLeft / cw);
        const clickX = e.clientX;
        const sw = window.innerWidth;

        if (clickX < sw * 0.3) {
            scrollToPage(chatContainer, Math.max(0, currentPage - 1), cw);
            const onEnd = () => { isProgrammaticScrolling = false; chatContainer.removeEventListener('scrollend', onEnd); };
            chatContainer.addEventListener('scrollend', onEnd);
            setTimeout(() => { isProgrammaticScrolling = false; }, 600);
        } else if (clickX > sw * 0.7) {
            scrollToPage(chatContainer, currentPage + 1, cw);
            const onEnd = () => { isProgrammaticScrolling = false; chatContainer.removeEventListener('scrollend', onEnd); };
            chatContainer.addEventListener('scrollend', onEnd);
            setTimeout(() => { isProgrammaticScrolling = false; }, 600);
        }
    });

    if (isScrollEventsBound) return;
    isScrollEventsBound = true;

    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    // 后备 snap 校正：鼠标拖动 / 键盘等非 touch 方式导致页未对齐时修正
    let snapDebounce = null;
    let isTouching = false; // 滑动冷却期内为 true，封锁后备 snap

    const handleScrollSnap = () => {
        if (isProgrammaticScrolling || isTouching) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        const cw = chatContainer.clientWidth;
        if (cw <= 0) return;
        const cur = chatContainer.scrollLeft;
        const expected = Math.round(cur / cw) * cw;
        if (Math.abs(cur - expected) > 5) {
            isProgrammaticScrolling = true;
            chatContainer.scrollTo({ left: expected, behavior: 'instant' });
            isProgrammaticScrolling = false;
        }
        lastUserPage = Math.round(chatContainer.scrollLeft / cw);
    };

    chatContainer.addEventListener('scroll', () => {
        if (isProgrammaticScrolling || isTouching) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        clearTimeout(snapDebounce);
        snapDebounce = setTimeout(handleScrollSnap, 100);
    });

    chatContainer.addEventListener('scrollend', () => {
        if (isTouching) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        clearTimeout(snapDebounce);
        if (!isProgrammaticScrolling) handleScrollSnap();
        isProgrammaticScrolling = false;
    });

    // ---- 滑动翻页 ----
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollLeft = 0;
    let touchStartTime = 0;
    let isTouchTracking = false;
    let touchIsHorizontal = null; // null=未判断, true=横向, false=纵向
    let touchCooldownTimer = null;

    chatContainer.addEventListener('touchstart', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        clearTimeout(touchCooldownTimer);
        isTouching = true;
        clearTimeout(snapDebounce);

        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartScrollLeft = chatContainer.scrollLeft;
        touchStartTime = Date.now();
        isTouchTracking = true;
        touchIsHorizontal = null;
        isProgrammaticScrolling = false;
    }, { passive: true });

    chatContainer.addEventListener('touchmove', (e) => {
        if (!isTouchTracking) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        const dx = e.touches[0].clientX - touchStartX;

        // 用第一帧 >8px 位移判定方向
        if (touchIsHorizontal === null) {
            const adx = Math.abs(e.touches[0].clientX - touchStartX);
            const ady = Math.abs(e.touches[0].clientY - touchStartY);
            if (adx > 8 || ady > 8) touchIsHorizontal = adx >= ady;
            return;
        }
        if (!touchIsHorizontal) return;

        // touch-action:pan-y 已阻断浏览器横向惯性，无需 preventDefault
        const max = chatContainer.scrollWidth - chatContainer.clientWidth;
        isProgrammaticScrolling = true;
        chatContainer.scrollLeft = Math.max(0, Math.min(max, touchStartScrollLeft - dx));
    }, { passive: true });

    chatContainer.addEventListener('touchend', (e) => {
        if (!isTouchTracking) return;
        isTouchTracking = false;

        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        // 纵向或未判定方向：直接放行
        if (!touchIsHorizontal) {
            isProgrammaticScrolling = false;
            touchCooldownTimer = setTimeout(() => { isTouching = false; }, 150);
            return;
        }

        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaTime = Date.now() - touchStartTime;
        const cw = chatContainer.clientWidth;
        if (cw <= 0) { isProgrammaticScrolling = false; isTouching = false; return; }

        // 目标页：基于 touchStart 时的页，严格限制 ±1 页
        const startPage = Math.round(touchStartScrollLeft / cw);
        let targetPage = startPage;

        const isFastSwipe = deltaTime < 300 && Math.abs(deltaX) > 30;
        const isLongSwipe = Math.abs(deltaX) > cw * 0.25;

        if (isFastSwipe || isLongSwipe) {
            targetPage = deltaX > 0
                ? Math.max(0, startPage - 1)
                : Math.min(Math.max(0, Math.ceil(chatContainer.scrollWidth / cw) - 1), startPage + 1);
        } else {
            // 未达阈值：就近吸附，但限制在 ±1 页内
            const nearest = Math.round(chatContainer.scrollLeft / cw);
            targetPage = Math.max(startPage - 1, Math.min(startPage + 1, Math.max(0, nearest)));
        }

        // 使用 smooth，与点击翻页动画保持一致
        scrollToPage(chatContainer, targetPage, cw);

        // isTouching 冷却：等 scrollend 后释放，确保 handleScrollSnap 不在动画中途介入
        const onSnapEnd = () => {
            isTouching = false;
            isProgrammaticScrolling = false;
            chatContainer.removeEventListener('scrollend', onSnapEnd);
            clearTimeout(touchCooldownTimer);
        };
        chatContainer.addEventListener('scrollend', onSnapEnd);
        // 安全兜底：scrollend 若未触发则 600ms 后强制释放
        touchCooldownTimer = setTimeout(() => {
            isTouching = false;
            isProgrammaticScrolling = false;
            chatContainer.removeEventListener('scrollend', onSnapEnd);
        }, 600);
    }, { passive: true });

    chatContainer.addEventListener('touchcancel', () => {
        isTouchTracking = false;
        touchIsHorizontal = null;
        isProgrammaticScrolling = false;
        clearTimeout(touchCooldownTimer);
        isTouching = false;
    }, { passive: true });

    // 焦点跳转防护：输入框获焦时回到当前页
    chatContainer.addEventListener('focusin', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (e.target && (e.target.classList.contains('twt-p-textarea') || e.target.closest('.twt-p-editor'))) return;
        setTimeout(() => {
            const cw = chatContainer.clientWidth;
            if (cw > 0) chatContainer.scrollTo({ left: lastUserPage * cw });
        }, 10);
    });
}
