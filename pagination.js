// @ts-nocheck
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;

export function applyPaginationMode(enabled) {
    if (enabled) {
        document.body.classList.add('twt-reading-mode');
        updateColWidth();
        window.addEventListener('resize', updateColWidth);
        initResizeObserver();
        patchScrollIntoView();
    } else {
        document.body.classList.remove('twt-reading-mode');
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

        const isInteractive = target.closest('button, a, input, textarea, select, .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon');
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
            chatContainer.scrollTo({ left: expectedScroll, behavior: 'smooth' });
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
        handleScrollSnap();
    });

    chatContainer.addEventListener('focusin', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        setTimeout(() => {
            const cw = chatContainer.clientWidth;
            if (cw <= 0) return;
            chatContainer.scrollTo({ left: lastUserPage * cw });
        }, 10);
    });
}
