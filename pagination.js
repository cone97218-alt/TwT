// @ts-nocheck
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;

// ---- 翻页模式优化变量 ----
let chatMutationObserver = null;
let lastInteractedElement = null;
let lastInteractedMessage = null;
let lastInteractedMessagePageOffset = 0;
let reflowNavigationTimer = null;

// ---- 焦点保护窗口（防止键盘弹出时 ResizeObserver 抢先重排导致跳页）----
let preKeyboardPage = -1;
let focusGuardTimer = null;
let isFocusGuardActive = false;

function containOversizedElements() {
    const chat = document.getElementById('chat');
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    
    const colHeight = chat.clientHeight;
    if (colHeight <= 0) return;
    
    // 1. 读相位 - 收集需要清理的元素
    const toRemove = [];
    chat.querySelectorAll('.twt-pagination-scrollable').forEach(el => {
        toRemove.push(el);
    });

    // 2. 写相位 - 临时清除样式，以便准确测量
    if (toRemove.length > 0) {
        toRemove.forEach(el => {
            el.style.removeProperty('max-height');
            el.style.removeProperty('overflow-y');
            el.classList.remove('twt-pagination-scrollable');
        });
        // 强制回流一次，确保后续测量准确
        // eslint-disable-next-line no-unused-expressions
        chat.scrollHeight; 
    }

    const toContain = [];
    const excludedTags = new Set(['P', 'SPAN', 'BLOCKQUOTE', 'PRE', 'OL', 'UL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'CODE', 'EM', 'STRONG', 'I', 'B']);
    
    // 3. 读相位 - 扫描超尺寸元素（为了移动端性能，仅扫描消息文本的直属一级子元素）
    chat.querySelectorAll('.mes_text > *').forEach(el => {
        // 跳过已经决定要收容的元素的子元素
        if (toContain.some(parent => parent.contains(el))) return;
        
        // 排除普通文本类标签，它们可以跨列自然流动
        if (excludedTags.has(el.tagName)) return;
        
        // 排除思维链/深度思考块，它们是特化组件，应该垂直自然断页而不是收容为内部滚动
        if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return;
        
        // 快速高度检查
        if (el.scrollHeight <= colHeight) return;
        
        // 检查是否创建 BFC 或者是常见的自定义容器标签
        const cs = window.getComputedStyle(el);
        const createsBFC = (
            (cs.overflow !== 'visible' && cs.overflow !== '') ||
            cs.display === 'flex' || cs.display === 'inline-flex' ||
            cs.display === 'grid' || cs.display === 'inline-grid' ||
            cs.position === 'absolute' || cs.position === 'fixed' ||
            cs.display === 'flow-root'
        );
        
        const isCommonContainer = el.tagName === 'DIV' || 
                                  el.tagName === 'TABLE' || 
                                  el.tagName === 'SECTION' || 
                                  el.tagName === 'FORM' || 
                                  el.tagName === 'ARTICLE' || 
                                  el.tagName === 'DETAILS';
        
        if (createsBFC || isCommonContainer) {
            toContain.push(el);
        }
    });

    // 4. 写相位 - 应用收容样式
    if (toContain.length > 0) {
        toContain.forEach(el => {
            el.style.setProperty('max-height', `${colHeight - 20}px`, 'important');
            el.style.setProperty('overflow-y', 'auto', 'important');
            el.classList.add('twt-pagination-scrollable');
        });
    }
    
    // 5. 校验当前页面，如果超出则重置
    const cw = chat.getBoundingClientRect().width;
    if (cw > 0) {
        const totalPages = Math.ceil(chat.scrollWidth / cw);
        if (lastUserPage >= totalPages) {
            lastUserPage = Math.max(0, totalPages - 1);
            chat.scrollTo({ left: lastUserPage * cw, behavior: 'instant' });
        }
    }
}

function trackInteractedElement(el) {
    lastInteractedElement = el;
    lastInteractedMessage = el.closest('.mes');
    
    const chat = document.getElementById('chat');
    if (chat && lastInteractedMessage) {
        const cw = chat.getBoundingClientRect().width;
        if (cw > 0) {
            const chatRect = chat.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const msgRect = lastInteractedMessage.getBoundingClientRect();
            
            const elAbsLeft = elRect.left - chatRect.left + chat.scrollLeft;
            const msgAbsLeft = msgRect.left - chatRect.left + chat.scrollLeft;
            
            // 点击点相对于消息起点的页面偏移量
            lastInteractedMessagePageOffset = Math.floor((elAbsLeft - msgAbsLeft) / cw);
        }
    }
    
    clearTimeout(reflowNavigationTimer);
    reflowNavigationTimer = setTimeout(() => {
        navigateToInteractedElement();
    }, 300);
}

function navigateToInteractedElement() {
    clearTimeout(reflowNavigationTimer);
    if (!document.body.classList.contains('twt-reading-mode')) return;
    const chat = document.getElementById('chat');
    if (!chat) return;
    
    const cw = chat.getBoundingClientRect().width;
    if (cw <= 0) return;
    
    let targetPage = -1;
    
    // 优先使用具体的元素定位
    if (lastInteractedElement && chat.contains(lastInteractedElement)) {
        const chatRect = chat.getBoundingClientRect();
        const elRect = lastInteractedElement.getBoundingClientRect();
        const absoluteLeft = elRect.left - chatRect.left + chat.scrollLeft;
        targetPage = Math.floor(absoluteLeft / cw);
    } 
    // 如果具体元素没了，使用消息块加偏移量兜底
    else if (lastInteractedMessage && chat.contains(lastInteractedMessage)) {
        const chatRect = chat.getBoundingClientRect();
        const msgRect = lastInteractedMessage.getBoundingClientRect();
        const msgAbsLeft = msgRect.left - chatRect.left + chat.scrollLeft;
        const msgStartPage = Math.floor(msgAbsLeft / cw);
        targetPage = msgStartPage + lastInteractedMessagePageOffset;
    }
    
    if (targetPage >= 0) {
        const totalPages = Math.ceil(chat.scrollWidth / cw);
        const validPage = Math.max(0, Math.min(targetPage, totalPages - 1));
        if (validPage !== lastUserPage) {
            scrollToPage(chat, validPage, cw);
        }
    }
    
    lastInteractedElement = null;
    lastInteractedMessage = null;
}

function initChatMutationObserver() {
    const chat = document.getElementById('chat');
    if (!chat || chatMutationObserver) return;
    
    let debounceTimer = null;
    chatMutationObserver = new MutationObserver(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isFocusGuardActive) return; // 焦点保护期内跳过，防止键盘弹出时重排
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            // 临时断开 Observer 避免 containOversizedElements 修改样式引起无限循环
            if (chatMutationObserver) {
                chatMutationObserver.disconnect();
            }
            
            containOversizedElements();
            if (lastInteractedElement || lastInteractedMessage) {
                navigateToInteractedElement();
            }
            
            // 重新开始监听
            if (chatMutationObserver) {
                chatMutationObserver.observe(chat, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['open', 'style', 'class']
                });
            }
        }, 150);
    });
    
    chatMutationObserver.observe(chat, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'style', 'class']
    });
}

function disconnectChatMutationObserver() {
    if (chatMutationObserver) {
        chatMutationObserver.disconnect();
        chatMutationObserver = null;
    }
}


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

            // 恢复被截断的页码（焦点保护可能没完全挡住）
            if (preKeyboardPage >= 0) {
                lastUserPage = preKeyboardPage;
                preKeyboardPage = -1;
            }
            // 关闭焦点保护窗口
            isFocusGuardActive = false;
            clearTimeout(focusGuardTimer);

            const chatContainer = document.getElementById('chat');
            if (chatContainer) {
                frozenChatHeight = chatContainer.getBoundingClientRect().height;
                if (frozenChatHeight > 0) {
                    chatContainer.style.setProperty('height', `${frozenChatHeight}px`, 'important');
                    chatContainer.style.setProperty('max-height', `${frozenChatHeight}px`, 'important');
                    chatContainer.style.setProperty('min-height', `${frozenChatHeight}px`, 'important');
                }
                // 确保滚动位置留在正确页
                const cw = chatContainer.getBoundingClientRect().width;
                if (cw > 0) {
                    chatContainer.scrollTo({ left: lastUserPage * cw, behavior: 'instant' });
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
        initChatMutationObserver();
    } else {
        document.body.classList.remove('twt-reading-mode', 'twt-swipe-disabled', 'twt-message-page');
        window.removeEventListener('resize', handleWindowResize);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        disconnectChatMutationObserver();
        // 退出翻页模式时解冻高度并清除滚动收容样式
        isKeyboardOpen = false;
        frozenChatHeight = 0;
        clearTimeout(keyboardRestoreTimer);
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            chatContainer.querySelectorAll('.twt-pagination-scrollable').forEach(el => {
                el.style.removeProperty('max-height');
                el.style.removeProperty('overflow-y');
                el.classList.remove('twt-pagination-scrollable');
            });
            chatContainer.style.removeProperty('height');
            chatContainer.style.removeProperty('max-height');
            chatContainer.style.removeProperty('min-height');
        }
    }
}

// 包装 resize 事件处理：键盘弹出期间跳过 updateColWidth
function handleWindowResize() {
    if (isKeyboardOpen || isFocusGuardActive) return;
    updateColWidth();
}

function updateColWidth() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || !document.body.classList.contains('twt-reading-mode')) return;
    const width = chatContainer.getBoundingClientRect().width;
    if (width > 0) {
        chatContainer.style.setProperty('--twt-col-width', `${width}px`, 'important');
        containOversizedElements();
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
        containOversizedElements();
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
    containOversizedElements();
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
        if (isKeyboardOpen || isFocusGuardActive) return; // 键盘或焦点保护期内忽略
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

    // 重置 MutationObserver
    disconnectChatMutationObserver();

    if (!document.body.classList.contains('twt-reading-mode')) return;

    // 4. 等待新 #chat 就绪后再绑定（CHAT_CHANGED 时 #chat 可能尚未重建）
    function tryBind(retries) {
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            initResizeObserver();
            bindScrollEvents(getSettings);
            updateColWidthWhenReady();
            initChatMutationObserver();
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

        const baseSelector = 'button, a, input, textarea, select, label, details, summary, [onclick], [role="button"], [tabindex], .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon';
        let isInteractive = false;
        if (settings.customWhitelist?.trim()) {
            try { isInteractive = !!e.target.closest(settings.customWhitelist.trim()); }
            catch (err) { console.warn('[TwT] Invalid custom whitelist selector:', err); }
        }
        if (!isInteractive) isInteractive = !!e.target.closest(baseSelector);
        
        // 启发式检测 cursor: pointer 样式，这通常表示可点击元素
        if (!isInteractive) {
            try {
                isInteractive = window.getComputedStyle(e.target).cursor === 'pointer';
            } catch (err) { /* ignore */ }
        }

        if (isInteractive) {
            trackInteractedElement(e.target);
            return;
        }
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

    // 焦点保护：输入框获焦时预锚定页码，防止键盘弹出引起的 resize 截断页码
    chatContainer.addEventListener('focusin', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (e.target && (e.target.classList.contains('twt-p-textarea') || e.target.closest('.twt-p-editor'))) return;

        // 立即保存当前正确页码
        preKeyboardPage = lastUserPage;
        isFocusGuardActive = true;
        clearTimeout(focusGuardTimer);
        focusGuardTimer = setTimeout(() => {
            isFocusGuardActive = false;
            // 500ms 内键盘没弹出，说明不是键盘场景，清除预锚定
            if (!isKeyboardOpen) {
                preKeyboardPage = -1;
            }
        }, 500);

        // 延迟回到当前页（使用预锚定页码，防止已被截断）
        setTimeout(() => {
            const cw = chatContainer.getBoundingClientRect().width;
            if (cw > 0) {
                const page = preKeyboardPage >= 0 ? preKeyboardPage : lastUserPage;
                chatContainer.scrollTo({ left: page * cw });
            }
        }, 10);
    }, { signal });
}
