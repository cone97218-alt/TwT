// @ts-nocheck
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        if (settings) {
            if (settings.swipeEnabled) {
                document.body.classList.remove('twt-swipe-disabled');
            } else {
                document.body.classList.add('twt-swipe-disabled');
            }
            if (settings.messagePageEnabled) {
                document.body.classList.add('twt-message-page');
            } else {
                document.body.classList.remove('twt-message-page');
            }
        }
        updateColWidth();
        window.addEventListener('resize', updateColWidth);
        initResizeObserver();
        patchScrollIntoView();
    } else {
        document.body.classList.remove('twt-reading-mode');
        document.body.classList.remove('twt-swipe-disabled');
        document.body.classList.remove('twt-message-page');
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

function initResizeObserver() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
            updateColWidth();
        });
        resizeObserver.observe(chatContainer);
    }
}

let isScrollIntoViewPatched = false;
function patchScrollIntoView() {
    if (isScrollIntoViewPatched) return;
    isScrollIntoViewPatched = true;
    
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(...args) {
        if (document.body.classList.contains('twt-reading-mode') && this.closest('#chat')) {
            return;
        }
        originalScrollIntoView.apply(this, args);
    };
}

let isScrollEventsBound = false;

export function initPaginationEvent(getSettings) {
    document.addEventListener('click', function(e) {
        const settings = getSettings();
        if (!settings || !settings.enabled) return;

        const chatContainer = document.getElementById('chat');
        if (!chatContainer) return;

        const target = e.target;
        if (!target || !(target instanceof Element)) return;

        if (chatContainer && !chatContainer.contains(target)) return;

        const baseSelector = 'button, a, input, textarea, select, .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon';
        let isInteractive = false;
        
        if (settings.customWhitelist && settings.customWhitelist.trim()) {
            try {
                isInteractive = !!target.closest(settings.customWhitelist.trim());
            } catch (err) {
                console.warn('[TwT] Invalid custom whitelist selector:', settings.customWhitelist, err);
            }
        }
        
        if (!isInteractive) {
            isInteractive = !!target.closest(baseSelector);
        }
        
        if (isInteractive) return;

        if (window.getSelection().toString().length > 0) return;

        const clickX = e.clientX;
        const screenWidth = window.innerWidth;
        
        const leftThreshold = screenWidth * 0.3;  
        const rightThreshold = screenWidth * 0.7; 

        const cw = chatContainer.clientWidth;
        if (cw <= 0) return;

        const currentScroll = chatContainer.scrollLeft;
        let currentPage = Math.round(currentScroll / cw);

        if (clickX < leftThreshold) {
            let targetPage = Math.max(0, currentPage - 1);
            isProgrammaticScrolling = true;
            chatContainer.scrollTo({ left: targetPage * cw, behavior: 'smooth' });
            
            const onScrollEnd = () => {
                isProgrammaticScrolling = false;
                lastUserPage = targetPage;
                chatContainer.removeEventListener('scrollend', onScrollEnd);
            };
            chatContainer.addEventListener('scrollend', onScrollEnd);
            
            setTimeout(() => {
                isProgrammaticScrolling = false;
                lastUserPage = targetPage;
            }, 500);
        } else if (clickX > rightThreshold) {
            let targetPage = currentPage + 1;
            isProgrammaticScrolling = true;
            chatContainer.scrollTo({ left: targetPage * cw, behavior: 'smooth' });
            
            const onScrollEnd = () => {
                isProgrammaticScrolling = false;
                lastUserPage = targetPage;
                chatContainer.removeEventListener('scrollend', onScrollEnd);
            };
            chatContainer.addEventListener('scrollend', onScrollEnd);
            
            setTimeout(() => {
                isProgrammaticScrolling = false;
                lastUserPage = targetPage;
            }, 500);
        }
    });

    if (isScrollEventsBound) return;
    isScrollEventsBound = true;

    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    let scrollSnapTimeout = null;

    // isTouching：手指在屏上或 touchend 后 150ms 冷却期内为 true
    // 封锁 handleScrollSnap，防止它用中间动画位置误算目标页
    let isTouching = false;

    const handleScrollSnap = () => {
        if (isProgrammaticScrolling) return;
        if (isTouching) return; // 触摸冷却期内完全封锁
        if (!document.body.classList.contains('twt-reading-mode')) return;

        const cw = chatContainer.clientWidth;
        if (cw <= 0) return;
        const currentScroll = chatContainer.scrollLeft;
        const targetPage = Math.round(currentScroll / cw);
        const expectedScroll = targetPage * cw;

        if (Math.abs(currentScroll - expectedScroll) > 5) {
            isProgrammaticScrolling = true;
            chatContainer.scrollTo({ left: expectedScroll, behavior: 'instant' });
            isProgrammaticScrolling = false;
        }
        lastUserPage = targetPage;
    };

    chatContainer.addEventListener('scroll', () => {
        if (isProgrammaticScrolling) return;
        if (isTouching) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;

        clearTimeout(scrollSnapTimeout);
        scrollSnapTimeout = setTimeout(() => {
            handleScrollSnap();
        }, 100);
    });

    chatContainer.addEventListener('scrollend', () => {
        clearTimeout(scrollSnapTimeout);
        handleScrollSnap();
    });

    // ---- Touch 变量 ----
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollLeft = 0;
    let touchStartTime = 0;
    let isTouchTracking = false;   // 手指正在屏上
    let touchIsHorizontal = null;  // null=未判断, true=横向, false=纵向
    let touchCooldownTimer = null;

    chatContainer.addEventListener('touchstart', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const settings = getSettings();
        if (!settings || !settings.enabled || !settings.swipeEnabled) return;

        // 新手指落下：取消上次冷却，立刻进入触摸态，清除 snap 定时器
        clearTimeout(touchCooldownTimer);
        isTouching = true;
        clearTimeout(scrollSnapTimeout);

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
        if (!settings || !settings.enabled || !settings.swipeEnabled) return;

        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;

        // 首次位移 >8px 时判定方向，之后不再变更
        if (touchIsHorizontal === null) {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                touchIsHorizontal = Math.abs(dx) >= Math.abs(dy);
            }
            return;
        }

        if (!touchIsHorizontal) return; // 纵向，放行给浏览器

        // 横向：实时跟随手指（直接写 scrollLeft，零延迟）
        isProgrammaticScrolling = true;
        chatContainer.scrollLeft = touchStartScrollLeft - dx;
    }, { passive: true });

    chatContainer.addEventListener('touchend', (e) => {
        if (!isTouchTracking) return;
        isTouchTracking = false;

        if (!document.body.classList.contains('twt-reading-mode')) return;
        const settings = getSettings();
        if (!settings || !settings.enabled || !settings.swipeEnabled) return;

        // 纵向或方向未定：放行，保留冷却期
        if (touchIsHorizontal === false || touchIsHorizontal === null) {
            isProgrammaticScrolling = false;
            touchCooldownTimer = setTimeout(() => { isTouching = false; }, 150);
            return;
        }

        const touchEndX = e.changedTouches[0].clientX;
        const deltaX = touchEndX - touchStartX;
        const deltaTime = Date.now() - touchStartTime;

        const cw = chatContainer.clientWidth;
        if (cw <= 0) {
            isProgrammaticScrolling = false;
            isTouching = false;
            return;
        }

        // ---- 目标页计算：严格限制每次最多翻 1 页 ----
        // 基准为 touchStart 时的页，防止 touchmove 跟随超出后被误判为多页
        const startPage = Math.round(touchStartScrollLeft / cw);
        let targetPage = startPage;

        const isFastSwipe = deltaTime < 300 && Math.abs(deltaX) > 30;
        const isLongSwipe = Math.abs(deltaX) > cw * 0.25;

        if (isFastSwipe || isLongSwipe) {
            if (deltaX > 0) {
                // 右划 → 上一页
                targetPage = Math.max(0, startPage - 1);
            } else {
                // 左划 → 下一页
                const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / cw) - 1);
                targetPage = Math.min(maxPage, startPage + 1);
            }
        } else {
            // 距离不够：按当前 scrollLeft 就近吸附，但限制在 startPage ±1 内
            const nearestPage = Math.round(chatContainer.scrollLeft / cw);
            targetPage = Math.max(startPage - 1, Math.min(startPage + 1, nearestPage));
            targetPage = Math.max(0, targetPage);
        }

        lastUserPage = targetPage;

        // ---- 执行定位：统一 instant ----
        // 手指已实时跟随，无需动画；
        // 用 smooth 会导致动画中途 scrollend 触发 handleScrollSnap 用错位置退页
        isProgrammaticScrolling = true;
        chatContainer.scrollTo({ left: targetPage * cw, behavior: 'instant' });

        // 冷却 150ms：封锁 handleScrollSnap，防止 instant 触发的 scrollend 误算
        touchCooldownTimer = setTimeout(() => {
            isTouching = false;
            isProgrammaticScrolling = false;
        }, 150);
    }, { passive: true });

    chatContainer.addEventListener('touchcancel', () => {
        isTouchTracking = false;
        touchIsHorizontal = null;
        isProgrammaticScrolling = false;
        clearTimeout(touchCooldownTimer);
        isTouching = false;
    }, { passive: true });

    chatContainer.addEventListener('focusin', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        setTimeout(() => {
            const cw = chatContainer.clientWidth;
            if (cw <= 0) return;
            chatContainer.scrollTo({ left: lastUserPage * cw });
        }, 10);
    });
}
