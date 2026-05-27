// @ts-nocheck
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;
let lastActiveMessage = null;

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        if (settings) {
            document.body.classList.toggle('twt-swipe-disabled', !settings.swipeEnabled);
            document.body.classList.toggle('twt-message-page', !!settings.messagePageEnabled);
        }
        lockChatHeight();
        updateColWidth();
        window.addEventListener('resize', handleWindowResize);
        initResizeObserver();
        patchScrollIntoView();
    } else {
        document.body.classList.remove('twt-reading-mode', 'twt-swipe-disabled', 'twt-message-page');
        window.removeEventListener('resize', handleWindowResize);
        unlockChatHeight();
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
    }
}

function lockChatHeight() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    
    // 只有在键盘未打开时，才锁死 #chat 的高度为当前视口高度，从而在键盘弹出时避免挤压和重排
    if (!isKeyboardOpen) {
        const height = window.innerHeight;
        chatContainer.style.setProperty('height', `${height}px`, 'important');
        chatContainer.style.setProperty('max-height', `${height}px`, 'important');
    }
}

function unlockChatHeight() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    chatContainer.style.removeProperty('height');
    chatContainer.style.removeProperty('max-height');
}

function handleWindowResize() {
    if (isKeyboardOpen) return;
    lockChatHeight();
    updateColWidth();
}


function updateActiveMessage() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    const chatRect = chatContainer.getBoundingClientRect();
    const messages = Array.from(chatContainer.querySelectorAll('.mes'));
    const aiMessages = messages.filter(m => {
        const isUser = m.classList.contains('user_mes') || m.getAttribute('is_user') === 'true';
        const isSystem = m.classList.contains('system_mes') || m.getAttribute('is_system') === 'true';
        return !isUser && !isSystem;
    });
    if (aiMessages.length === 0) return;

    const pageCenter = chatContainer.scrollLeft + (chatContainer.clientWidth / 2);
    
    let closestMes = null;
    let minDistance = Infinity;
    for (const mes of aiMessages) {
        const rect = mes.getBoundingClientRect();
        const absoluteLeft = rect.left - chatRect.left + chatContainer.scrollLeft;
        const absoluteRight = rect.right - chatRect.left + chatContainer.scrollLeft;
        if (pageCenter >= absoluteLeft && pageCenter <= absoluteRight) {
            lastActiveMessage = mes;
            return;
        }
        const mesCenter = (absoluteLeft + absoluteRight) / 2;
        const dist = Math.abs(mesCenter - pageCenter);
        if (dist < minDistance) {
            minDistance = dist;
            closestMes = mes;
        }
    }
    if (closestMes) {
        lastActiveMessage = closestMes;
    }
}

function updateColWidth() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;
    const width = chatContainer.getBoundingClientRect().width;
    if (width > 0) {
        chatContainer.style.setProperty('--twt-col-width', `${width}px`, 'important');
        
        // 关键定位：在高度改变重新分栏后，将视口对齐到当前阅读的消息，保持阅读内容不跳显
        if (lastActiveMessage) {
            const chatRect = chatContainer.getBoundingClientRect();
            const rect = lastActiveMessage.getBoundingClientRect();
            const currentScrollLeft = chatContainer.scrollLeft;
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const targetPage = Math.floor(absoluteLeft / width);
            
            isProgrammaticScrolling = true;
            chatContainer.scrollLeft = targetPage * width;
            isProgrammaticScrolling = false;
            lastUserPage = targetPage;
        }
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
    const cw = chatContainer.getBoundingClientRect().width;
    if (cw <= 0) return;
    const totalPages = Math.round(chatContainer.scrollWidth / cw);
    const page = targetPage !== null ? Math.max(0, Math.min(targetPage, totalPages - 1)) : totalPages - 1;
    // 用 requestAnimationFrame 确保 DOM 已经刷新完毕
    requestAnimationFrame(() => {
        chatContainer.scrollTo({ left: page * cw, behavior: 'smooth' });
        lastUserPage = page;
        updateActiveMessage();
    });
}


function initResizeObserver(getSettings) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || resizeObserver) return;
    
    resizeObserver = new ResizeObserver(() => {
        const settings = getSettings();
        if (!settings || !settings.enabled) return;

        const width = chatContainer.getBoundingClientRect().width;
        if (width > 0) {
            lockChatHeight();
            updateColWidth();
            
            if (!isScrollEventsBound) {
                bindScrollTouchEvents(chatContainer, getSettings);
            }
        }
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

let isScrollEventsBound = false;
let isClickEventBound = false;
let lastChatContainer = null;
let paginationObserver = null;
let isKeyboardOpen = false;

// 全局监听：通过 focusin 和 focusout 可靠捕捉移动端键盘唤起状态
document.addEventListener('focusin', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true')) {
        const chatContainer = document.getElementById('chat');
        if (chatContainer && !chatContainer.contains(e.target)) {
            isKeyboardOpen = true;
        }
    }
});
document.addEventListener('focusout', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true')) {
        isKeyboardOpen = false;
        // 键盘收起后，延迟更新重置高度，使 #chat 重新恢复满屏高度并保持之前阅读的 AI 消息不动
        setTimeout(() => {
            lockChatHeight();
            updateColWidth();
        }, 100);
    }
});

export function initPaginationObserver(getSettings) {
    if (paginationObserver) return;
    
    const MutationObserverClass = window.MutationObserver;
    if (!MutationObserverClass) return;

    paginationObserver = new MutationObserverClass(() => {
        const settings = getSettings();
        if (!settings?.enabled) return;

        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            // 如果 #chat 容器节点发生了物理替换，重置绑定状态
            if (chatContainer !== lastChatContainer) {
                lastChatContainer = chatContainer;
                isScrollEventsBound = false;
                if (resizeObserver) {
                    resizeObserver.disconnect();
                    resizeObserver = null;
                }
                initResizeObserver(getSettings);
            }
        }
    });

    paginationObserver.observe(document.body, { childList: true, subtree: true });
}

export function initPaginationEvent(getSettings) {
    // 启动 DOM 监听以支持延迟或动态生成的 #chat 绑定
    initPaginationObserver(getSettings);

    // 绑定点击翻页（仅需全局绑定一次，内部动态获取最新 #chat）
    if (!isClickEventBound) {
        isClickEventBound = true;
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
    }

    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    // 尝试初始化 ResizeObserver，这样即使它一开始宽度为 0，也会在变得可见时触发宽度设定和事件绑定
    initResizeObserver(getSettings);
    
    // 如果已经可见，且尚未绑定，直接触发绑定
    const width = chatContainer.getBoundingClientRect().width;
    if (width > 0 && !isScrollEventsBound) {
        lockChatHeight();
        updateColWidth();
        bindScrollTouchEvents(chatContainer, getSettings);
    }
}

export function bindScrollTouchEvents(chatContainer, getSettings) {
    if (isScrollEventsBound) return;
    isScrollEventsBound = true;
    lastChatContainer = chatContainer;

    // 后备 snap 校正：鼠标拖动 / 键盘等非 touch 方式导致页未对齐时修正
    let snapDebounce = null;
    let isTouching = false; // 滑动冷却期内为 true，封锁后备 snap

    const handleScrollSnap = () => {
        if (isProgrammaticScrolling || isTouching) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isKeyboardOpen) return; // 键盘打字时完全忽略对齐 snap

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
        
        // 更新当前阅读的消息
        updateActiveMessage();
    };

    chatContainer.addEventListener('scroll', () => {
        if (isProgrammaticScrolling || isTouching) return;
        if (document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;

        // 关键防护：如果当前已唤起输入法键盘，强制将 #chat 的滚动位置锁死在 lastUserPage，杜绝自动乱翻页
        if (isKeyboardOpen) {
            const cw = chatContainer.getBoundingClientRect().width;
            if (cw > 0) {
                isProgrammaticScrolling = true;
                chatContainer.scrollLeft = lastUserPage * cw;
                isProgrammaticScrolling = false;
            }
            return;
        }

        clearTimeout(snapDebounce);
        snapDebounce = setTimeout(handleScrollSnap, 100);
    });

    chatContainer.addEventListener('scrollend', () => {
        if (isTouching) return;
        if (document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;

        // 同样保护 scrollend，防止键盘弹起/收起时的惯性滚动篡改页面
        if (isKeyboardOpen) {
            const cw = chatContainer.getBoundingClientRect().width;
            if (cw > 0) {
                isProgrammaticScrolling = true;
                chatContainer.scrollLeft = lastUserPage * cw;
                isProgrammaticScrolling = false;
            }
            return;
        }

        clearTimeout(snapDebounce);
        if (!isProgrammaticScrolling) handleScrollSnap();
        isProgrammaticScrolling = false;

        // 关键更新：当任何翻页动作彻底停止时，立刻更新当前阅读中的 AI 消息引用
        updateActiveMessage();
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
        const max = chatContainer.scrollWidth - chatContainer.getBoundingClientRect().width;
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
        const cw = chatContainer.getBoundingClientRect().width;
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
            const cw = chatContainer.getBoundingClientRect().width;
            if (cw > 0) chatContainer.scrollTo({ left: lastUserPage * cw });
        }, 10);
    });
}
