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

    const handleScrollSnap = () => {
        if (isProgrammaticScrolling) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;

        const cw = chatContainer.clientWidth;
        if (cw <= 0) return;
        const currentScroll = chatContainer.scrollLeft;
        const targetPage = Math.round(currentScroll / cw);
        const expectedScroll = targetPage * cw;
        
        if (Math.abs(currentScroll - expectedScroll) > 5) {
            isProgrammaticScrolling = true;
            chatContainer.scrollTo({ left: expectedScroll, behavior: 'smooth' });
            
            const onScrollEnd = () => {
                isProgrammaticScrolling = false;
                chatContainer.removeEventListener('scrollend', onScrollEnd);
            };
            chatContainer.addEventListener('scrollend', onScrollEnd);
            
            setTimeout(() => {
                isProgrammaticScrolling = false;
            }, 500);
        }
        lastUserPage = targetPage;
    };

    chatContainer.addEventListener('scroll', () => {
        if (isProgrammaticScrolling) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        
        clearTimeout(scrollSnapTimeout);
        scrollSnapTimeout = setTimeout(() => {
            handleScrollSnap();
        }, 200); 
    });

    chatContainer.addEventListener('scrollend', () => {
        clearTimeout(scrollSnapTimeout);
        handleScrollSnap();
    });

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollLeft = 0;
    let touchStartTime = 0;

    chatContainer.addEventListener('touchstart', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const settings = getSettings();
        if (!settings || !settings.enabled || !settings.swipeEnabled) return;

        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartScrollLeft = chatContainer.scrollLeft;
        touchStartTime = Date.now();
    }, { passive: true });

    chatContainer.addEventListener('touchend', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const settings = getSettings();
        if (!settings || !settings.enabled || !settings.swipeEnabled) return;

        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;
        
        const cw = chatContainer.clientWidth;
        if (cw <= 0) return;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 30) {
            const currentPage = Math.round(touchStartScrollLeft / cw);
            let targetPage = currentPage;
            
            const isFastSwipe = deltaTime < 250 && Math.abs(deltaX) > cw * 0.05;
            const isLongSwipe = Math.abs(deltaX) > cw * 0.2;
            
            if (isFastSwipe || isLongSwipe) {
                if (deltaX > 0) {
                    targetPage = Math.max(0, currentPage - 1);
                } else {
                    const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / cw) - 1);
                    targetPage = Math.min(maxPage, currentPage + 1);
                }
            }
            
            isProgrammaticScrolling = true;
            // Lock touch scroll interaction temporarily to cancel browser native momentum
            document.body.classList.add('twt-swipe-disabled');
            chatContainer.scrollTo({ left: targetPage * cw, behavior: 'smooth' });
            lastUserPage = targetPage;
            
            setTimeout(() => {
                isProgrammaticScrolling = false;
                const currentSettings = getSettings();
                if (currentSettings && currentSettings.swipeEnabled) {
                    document.body.classList.remove('twt-swipe-disabled');
                }
            }, 400);
        } else if (Math.abs(deltaX) > Math.abs(deltaY)) {
            const currentPage = Math.round(chatContainer.scrollLeft / cw);
            isProgrammaticScrolling = true;
            document.body.classList.add('twt-swipe-disabled');
            chatContainer.scrollTo({ left: currentPage * cw, behavior: 'smooth' });
            lastUserPage = currentPage;
            
            setTimeout(() => {
                isProgrammaticScrolling = false;
                const currentSettings = getSettings();
                if (currentSettings && currentSettings.swipeEnabled) {
                    document.body.classList.remove('twt-swipe-disabled');
                }
            }, 400);
        }
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
