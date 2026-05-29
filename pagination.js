// @ts-nocheck
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;

// ---- 虚拟键盘检测（移动端）----
let isKeyboardOpen = false;
let frozenChatHeight = 0;
let keyboardRestoreTimer = null;
let isKeyboardGuardInit = false; // 防止重复注册

function initVirtualKeyboardGuard() {
    if (isKeyboardGuardInit || !window.visualViewport) return;
    isKeyboardGuardInit = true;

    const vv = window.visualViewport;
    let lastVVHeight = vv.height;

    vv.addEventListener('resize', () => {
        if (!document.body.classList.contains('twt-reading-mode')) return;

        const currentVVHeight = vv.height;
        const heightDiff = lastVVHeight - currentVVHeight;

        // 高度明显缩小（>100px）视为键盘弹出
        if (heightDiff > 100 && !isKeyboardOpen) {
            isKeyboardOpen = true;
            clearTimeout(keyboardRestoreTimer);

            const chatContainer = document.getElementById('chat');
            if (chatContainer) {
                frozenChatHeight = chatContainer.getBoundingClientRect().height;
                if (frozenChatHeight > 0) {
                    chatContainer.style.setProperty('height', `${frozenChatHeight}px`, 'important');
                    chatContainer.style.setProperty('max-height', `${frozenChatHeight}px`, 'important');
                    chatContainer.style.setProperty('min-height', `${frozenChatHeight}px`, 'important');
                }
            }
        }
        // 高度明显增大（>100px）视为键盘收起
        else if (heightDiff < -100 && isKeyboardOpen) {
            clearTimeout(keyboardRestoreTimer);
            keyboardRestoreTimer = setTimeout(() => {
                isKeyboardOpen = false;
                frozenChatHeight = 0;
                const chatContainer = document.getElementById('chat');
                if (chatContainer) {
                    chatContainer.style.removeProperty('height');
                    chatContainer.style.removeProperty('max-height');
                    chatContainer.style.removeProperty('min-height');
                }
                // 解冻后重新校正列宽（保持在当前页）
                updateColWidth();
                const cw = chatContainer?.getBoundingClientRect().width;
                if (cw > 0) {
                    chatContainer.scrollTo({ left: lastUserPage * cw, behavior: 'instant' });
                }
            }, 300);
        }

        lastVVHeight = currentVVHeight;
    });
}

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        if (settings) {
            document.body.classList.toggle('twt-swipe-disabled', !settings.swipeEnabled);
            document.body.classList.toggle('twt-message-page', !!settings.messagePageEnabled);
        }
        // 延迟+重试等待 DOM 稳定后再初始化列宽
        updateColWidthWhenReady();
        window.addEventListener('resize', handleWindowResize);
        initResizeObserver();
        patchScrollIntoView();
        initVirtualKeyboardGuard();
    } else {
        document.body.classList.remove('twt-reading-mode', 'twt-swipe-disabled', 'twt-message-page');
        window.removeEventListener('resize', handleWindowResize);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        // 退出翻页模式时解冻高度
        isKeyboardOpen = false;
        frozenChatHeight = 0;
        clearTimeout(keyboardRestoreTimer);
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            chatContainer.style.removeProperty('height');
            chatContainer.style.removeProperty('max-height');
            chatContainer.style.removeProperty('min-height');
        }
    }
}

// 包装 resize 事件处理：键盘弹出期间跳过 updateColWidth
function handleWindowResize() {
    if (isKeyboardOpen) return;
    updateColWidth();
}

function updateColWidth() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;
    const width = chatContainer.getBoundingClientRect().width;
    if (width > 0) {
        chatContainer.style.setProperty('--twt-col-width', `${width}px`, 'important');
    }
}

/**
 * 延迟+重试初始化列宽，解决聊天加载时 DOM 未就绪导致列宽为 0 的竞态问题。
 * 同时等待 scrollWidth 在两帧内稳定，确保 CSS 多列布局已完全展开后再固化列宽。
 * 成功后吸附回 lastUserPage 所在页。
 */
function updateColWidthWhenReady(retries = 20, interval = 150) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;

    const width = chatContainer.getBoundingClientRect().width;
    if (width <= 0) {
        // 容器宽度还没就绪，继续等
        if (retries > 0) setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
        return;
    }

    // 检查 scrollWidth 是否已稳定（两个 rAF 之间变化 < 2px，说明多列排版已完成）
    const sw1 = chatContainer.scrollWidth;
    requestAnimationFrame(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const sw2 = chatContainer.scrollWidth;
        if (Math.abs(sw2 - sw1) > 1 && retries > 0) {
            // scrollWidth 还在变化，再等一轮
            setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
            return;
        }
        // scrollWidth 已稳定，固化列宽并吸附页面
        chatContainer.style.setProperty('--twt-col-width', `${width}px`, 'important');
        requestAnimationFrame(() => {
            chatContainer.scrollTo({ left: lastUserPage * width, behavior: 'instant' });
        });
    });
}

/**
 * 消息内容变化后（如段落编辑保存），从外部调用此函数
 * 重新计算列宽并跳转到最后一页（或指定页）
 */
export function refreshPagination(targetPage = null) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;
    updateColWidth();
    const cw = chatContainer.getBoundingClientRect().width;
    if (cw <= 0) return;
    const totalPages = Math.round(chatContainer.scrollWidth / cw);
    const page = targetPage !== null ? Math.max(0, Math.min(targetPage, totalPages - 1)) : totalPages - 1;
    requestAnimationFrame(() => {
        chatContainer.scrollTo({ left: page * cw, behavior: 'smooth' });
        lastUserPage = page;
    });
}

function initResizeObserver() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || resizeObserver) return;
    resizeObserver = new ResizeObserver(() => {
        if (isKeyboardOpen) return; // 键盘打开时忽略，防止二次分页
        updateColWidth();
    });
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
    const cw = chatContainer.getBoundingClientRect().width;
    if (cw <= 0) return;
    const currentPage = Math.round(chatContainer.scrollLeft / cw);
    scrollToPage(chatContainer, Math.max(0, currentPage - 1), cw);
}

export function scrollPageRight() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    const cw = chatContainer.getBoundingClientRect().width;
    if (cw <= 0) return;
    const currentPage = Math.round(chatContainer.scrollLeft / cw);
    const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / cw) - 1);
    scrollToPage(chatContainer, Math.min(maxPage, currentPage + 1), cw);
}

/**
 * 供外部模块（如 mulu.js）在程序化跳转后同步更新 lastUserPage，
 * 防止 snap 校正逻辑在下次 scroll 时跳回旧页。
 */
export function setLastUserPage(page) {
    lastUserPage = page;
}

// ---- 事件绑定生命周期管理 ----
// 用 AbortController 管理 chatContainer 上的事件，切换聊天时彻底重绑
let scrollEventsAbortController = null;

/**
 * 重置翻页事件绑定，供聊天切换时调用。
 * 会中止旧 #chat 上的所有事件监听，并在新 #chat 就绪后重新绑定。
 * CHAT_CHANGED 事件触发时新 #chat 可能尚未渲染，因此采用重试机制。
 */
export function resetPaginationBinding(getSettings) {
    // 1. 中止旧 chatContainer 上的所有事件
    if (scrollEventsAbortController) {
        scrollEventsAbortController.abort();
        scrollEventsAbortController = null;
    }

    // 2. 重置状态
    lastUserPage = 0;
    isProgrammaticScrolling = false;

    // 3. 重置 ResizeObserver（旧 #chat 可能已销毁）
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }

    if (!document.body.classList.contains('twt-reading-mode')) return;

    // 4. 等待新 #chat 就绪后再绑定（CHAT_CHANGED 时 #chat 可能尚未重建）
    function tryBind(retries) {
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            initResizeObserver();
            bindScrollEvents(getSettings);
            updateColWidthWhenReady();
        } else if (retries > 0) {
            setTimeout(() => tryBind(retries - 1), 100);
        }
    }
    tryBind(20); // 最多等待 2 秒
}

export function initPaginationEvent(getSettings) {
    // 点击翻页（全局委托，无需随 #chat 重建）
    document.addEventListener('click', function(e) {
        const settings = getSettings();
        if (!settings?.enabled) return;

        const customMenu = document.getElementById('twt-custom-menu');
        if (customMenu && window.getComputedStyle(customMenu).display !== 'none') {
            return;
        }

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

        const cw = chatContainer.getBoundingClientRect().width;
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

    // 初次绑定 chatContainer 上的 scroll/touch 事件
    bindScrollEvents(getSettings);
}

/**
 * 绑定 #chat 上的 scroll / touch 事件。
 * 每次聊天切换后都需要重新调用，以重新绑定到新的 #chat 元素。
 * 通过 AbortController 管理事件生命周期，防止在旧元素上积累无效监听器。
 */
function bindScrollEvents(getSettings) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    // 中止上一轮绑定（如果有）
    if (scrollEventsAbortController) {
        scrollEventsAbortController.abort();
    }
    scrollEventsAbortController = new AbortController();
    const signal = scrollEventsAbortController.signal;

    // 后备 snap 校正
    let snapDebounce = null;
    let isTouching = false;

    const handleScrollSnap = () => {
        if (isProgrammaticScrolling || isTouching) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        const cw = chatContainer.getBoundingClientRect().width;
        if (cw <= 0) return;
        const cur = chatContainer.scrollLeft;
        const expected = Math.round(cur / cw) * cw;
        if (Math.abs(cur - expected) > 2) {
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
    }, { signal });

    chatContainer.addEventListener('scrollend', () => {
        if (isTouching) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        clearTimeout(snapDebounce);
        if (!isProgrammaticScrolling) handleScrollSnap();
        isProgrammaticScrolling = false;
    }, { signal });

    // ---- 滑动翻页 ----
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollLeft = 0;
    let touchStartTime = 0;
    let isTouchTracking = false;
    let touchIsHorizontal = null;
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
    }, { passive: true, signal });

    chatContainer.addEventListener('touchmove', (e) => {
        if (!isTouchTracking) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        const dx = e.touches[0].clientX - touchStartX;

        if (touchIsHorizontal === null) {
            const adx = Math.abs(e.touches[0].clientX - touchStartX);
            const ady = Math.abs(e.touches[0].clientY - touchStartY);
            if (adx > 8 || ady > 8) touchIsHorizontal = adx >= ady;
            return;
        }
        if (!touchIsHorizontal) return;

        const max = chatContainer.scrollWidth - chatContainer.getBoundingClientRect().width;
        isProgrammaticScrolling = true;
        chatContainer.scrollLeft = Math.max(0, Math.min(max, touchStartScrollLeft - dx));
    }, { passive: true, signal });

    chatContainer.addEventListener('touchend', (e) => {
        if (!isTouchTracking) return;
        isTouchTracking = false;

        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        if (!touchIsHorizontal) {
            isProgrammaticScrolling = false;
            touchCooldownTimer = setTimeout(() => { isTouching = false; }, 150);
            return;
        }

        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaTime = Date.now() - touchStartTime;
        const cw = chatContainer.getBoundingClientRect().width;
        if (cw <= 0) { isProgrammaticScrolling = false; isTouching = false; return; }

        const startPage = Math.round(touchStartScrollLeft / cw);
        let targetPage = startPage;

        const isFastSwipe = deltaTime < 300 && Math.abs(deltaX) > 30;
        const isLongSwipe = Math.abs(deltaX) > cw * 0.25;

        if (isFastSwipe || isLongSwipe) {
            targetPage = deltaX > 0
                ? Math.max(0, startPage - 1)
                : Math.min(Math.max(0, Math.ceil(chatContainer.scrollWidth / cw) - 1), startPage + 1);
        } else {
            const nearest = Math.round(chatContainer.scrollLeft / cw);
            targetPage = Math.max(startPage - 1, Math.min(startPage + 1, Math.max(0, nearest)));
        }

        scrollToPage(chatContainer, targetPage, cw);

        const onSnapEnd = () => {
            isTouching = false;
            isProgrammaticScrolling = false;
            chatContainer.removeEventListener('scrollend', onSnapEnd);
            clearTimeout(touchCooldownTimer);
        };
        chatContainer.addEventListener('scrollend', onSnapEnd);
        touchCooldownTimer = setTimeout(() => {
            isTouching = false;
            isProgrammaticScrolling = false;
            chatContainer.removeEventListener('scrollend', onSnapEnd);
        }, 600);
    }, { passive: true, signal });

    chatContainer.addEventListener('touchcancel', () => {
        isTouchTracking = false;
        touchIsHorizontal = null;
        isProgrammaticScrolling = false;
        clearTimeout(touchCooldownTimer);
        isTouching = false;
    }, { passive: true, signal });

    // 焦点跳转防护：输入框获焦时回到当前页
    chatContainer.addEventListener('focusin', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (e.target && (e.target.classList.contains('twt-p-textarea') || e.target.closest('.twt-p-editor'))) return;
        setTimeout(() => {
            const cw = chatContainer.getBoundingClientRect().width;
            if (cw > 0) chatContainer.scrollTo({ left: lastUserPage * cw });
        }, 10);
    }, { signal });
}
