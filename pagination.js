// @ts-nocheck
import { extension_settings } from '../../../extensions.js';
let resizeObserver = null;
let lastUserPage = 0;
let isProgrammaticScrolling = false;

// ---- 翻页模式优化变量 ----
let chatMutationObserver = null;
let lastInteractedElement = null;
let lastInteractedMessage = null;
let lastInteractedMessagePageOffset = 0;
let reflowNavigationTimer = null;
let isUserTouchActive = false; // 用于告知 containOversizedElements 当前是否正在滑动

// ---- 焦点保护窗口（防止键盘弹出时 ResizeObserver 抢先重排导致跳页）----
let preKeyboardPage = -1;
let focusGuardTimer = null;
let isFocusGuardActive = false;
let positionLockRaf = null; // rAF 滚动位置锁
// WeakMap 缓存上次测量到的元素高度，用于检测未知折叠组件的高度突变
const elementPrevHeights = new WeakMap();
// 高度突变阈值（px）：超过此值视为折叠展开事件，强制断页保护
const HEIGHT_SURGE_THRESHOLD = 80;

/**
 * 根据元素在当前页面的起始 top 偏移，自适应地计算当前页面剩下空间的高度限制
 */
function getAdaptiveMaxHeight(el, chat, colHeight, isPageBreakEnabled) {
    if (isPageBreakEnabled) {
        return colHeight - 20;
    }
    const chatRect = chat.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offsetTop = elRect.top - chatRect.top;
    if (offsetTop > 0 && offsetTop < colHeight) {
        const remaining = colHeight - offsetTop;
        // 如果页面下半部分所剩空间大于 150px，我们就限制其 max-height 缩进到剩余空间内滚动；
        // 否则如果太靠近页尾了（所剩太少），允许它占有微量跨页流动（最少 150px 高度限制），防止缩得太小无法阅读。
        return remaining > 150 ? (remaining - 20) : Math.max(150, Math.min(200, colHeight - 20));
    }
    return colHeight - 20;
}

function containOversizedElements() {
    const chat = document.getElementById('chat');
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    
    const colHeight = chat.clientHeight;
    if (colHeight <= 0) return;
    const isPageBreakEnabled = extension_settings?.twt?.htmlPageBreakEnabled !== false;
    
    const toScrollable = [];  // 需要被收容为内部滚动的新超大容器，存储为 { el, maxHeight } 结构
    const toBreak = [];       // 需要强制断页（但不一定收容）的元素
    const excludedTags = new Set(['P', 'SPAN', 'BLOCKQUOTE', 'PRE', 'OL', 'UL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'CODE', 'EM', 'STRONG', 'I', 'B']);
    
    // 读相位 - 扫描并标记 HTML 容器
    chat.querySelectorAll('.mes_text > *').forEach(el => {
        const isReasoning = el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body');
        const isContainerTag = el.tagName === 'DIV' || 
                               el.tagName === 'TABLE' || 
                               el.tagName === 'SECTION' || 
                               el.tagName === 'FORM' || 
                               el.tagName === 'ARTICLE' || 
                               el.tagName === 'DETAILS' ||
                               el.tagName === 'IFRAME';
        
        if (isContainerTag && !isReasoning) {
            el.classList.add('twt-html-container');
        } else {
            el.classList.remove('twt-html-container');
            el.classList.remove('twt-html-needs-break');
        }

        // 优化：已标记为收容的元素，直接保留并计算自适应的高度限制，无需临时清除样式和测量
        if (el.classList.contains('twt-pagination-scrollable')) {
            const maxHeight = getAdaptiveMaxHeight(el, chat, colHeight, isPageBreakEnabled);
            toScrollable.push({ el, maxHeight });
            if (isPageBreakEnabled) {
                toBreak.push(el);
            }
            return;
        }

        // 跳过已经决定要收容的元素的子元素
        if (toScrollable.some(item => item.el.contains(el))) return;
        
        // 排除普通文本类标签，它们可以跨列自然流动
        if (excludedTags.has(el.tagName)) return;
        
        // 排除思维链/深度思考块，它们是特化组件，应该垂直自然断页而不是收容为内部滚动
        if (isReasoning) return;

        const currentHeight = el.scrollHeight;

        // 计算当前位置的剩余空间
        const chatRect = chat.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offsetTop = elRect.top - chatRect.top;
        const remainingSpace = (offsetTop > 0 && offsetTop < colHeight) ? (colHeight - offsetTop) : colHeight;

        // ---- 第一级：原生折叠元素 ----
        if (el.tagName === 'DETAILS') {
            const wasOpen = el.open;
            if (!wasOpen) {
                el.open = true;
            }
            let estimatedExpandedHeight = 0;
            for (const child of el.children) {
                estimatedExpandedHeight += child.scrollHeight;
            }
            if (!wasOpen) {
                el.open = false;
            }
            
            if (estimatedExpandedHeight > remainingSpace) {
                if (isPageBreakEnabled) {
                    toBreak.push(el);
                    if (estimatedExpandedHeight > colHeight) {
                        toScrollable.push({ el, maxHeight: colHeight - 20 });
                    }
                } else {
                    const maxHeight = remainingSpace > 150 ? (remainingSpace - 20) : Math.max(150, Math.min(200, colHeight - 20));
                    toScrollable.push({ el, maxHeight });
                }
            }
            elementPrevHeights.set(el, el.scrollHeight);
            return;
        }

        // ---- 检测未知折叠组件：高度突变检测 ----
        // 如果缓存中有上次高度，且本次高度增加超过阈值，视为折叠组件展开
        const prevHeight = elementPrevHeights.get(el);
        const hasSurged = prevHeight !== undefined && (currentHeight - prevHeight) > HEIGHT_SURGE_THRESHOLD;

        // 更新高度缓存
        elementPrevHeights.set(el, currentHeight);

        // ---- 第二级：超高容器 或 刚刚高度突变的未知折叠组件 ----
        if (currentHeight > remainingSpace || hasSurged) {
            // 快速检查是否是创建 BFC 的真实容器或已知容器标签
            const cs = window.getComputedStyle(el);
            const createsBFC = (
                (cs.overflow !== 'visible' && cs.overflow !== '') ||
                cs.display === 'flex' || cs.display === 'inline-flex' ||
                cs.display === 'grid' || cs.display === 'inline-grid' ||
                cs.position === 'absolute' || cs.position === 'fixed' ||
                cs.display === 'flow-root'
            );
            
            if (createsBFC || isContainerTag) {
                if (isPageBreakEnabled) {
                    toBreak.push(el);
                    if (currentHeight > colHeight || hasSurged) {
                        toScrollable.push({ el, maxHeight: colHeight - 20 });
                    }
                } else {
                    const maxHeight = remainingSpace > 150 ? (remainingSpace - 20) : Math.max(150, Math.min(200, colHeight - 20));
                    toScrollable.push({ el, maxHeight });
                }
            }
            return;
        }
    });

    // 写相位 - 应用断页标记（先清除所有不在 toBreak 中的断页标记）
    chat.querySelectorAll('.twt-html-needs-break').forEach(el => {
        if (!toBreak.includes(el)) {
            el.classList.remove('twt-html-needs-break');
        }
    });
    toBreak.forEach(el => {
        el.classList.add('twt-html-needs-break');
    });

    // 写相位 - 应用收容样式
    if (toScrollable.length > 0) {
        toScrollable.forEach(({ el, maxHeight }) => {
            el.style.setProperty('max-height', `${maxHeight}px`, 'important');
            el.style.setProperty('overflow-y', 'auto', 'important');
            el.classList.add('twt-pagination-scrollable');
        });
    }
    
    // 6. 校验当前页面，如果超出则重置（但滑动期间跳过，避免因重排短暂导致 scrollWidth 变化而引发误跳页）
    if (!isUserTouchActive) {
        const cw = chat.getBoundingClientRect().width;
        if (cw > 0) {
            const totalPages = Math.ceil(chat.scrollWidth / cw);
            if (lastUserPage >= totalPages) {
                lastUserPage = Math.max(0, totalPages - 1);
                chat.scrollTo({ left: lastUserPage * cw, behavior: 'instant' });
            }
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
        
        const runCheck = () => {
            if (isUserTouchActive) {
                // 如果用户正在滑动，推迟到滑动结束后执行，避免滑动中重排引起跳页
                debounceTimer = setTimeout(runCheck, 150);
                return;
            }
            
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
        };
        
        debounceTimer = setTimeout(runCheck, 150);
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

/**
 * 精确冻结 #chat 高度，考虑 box-sizing 确保冻结后高度与冻结前像素级一致。
 * 高度不一致会导致 CSS 多列重排，引发页码跳变。
 */
function freezeChatHeight(chatContainer) {
    const cs = getComputedStyle(chatContainer);
    // 使用 computedStyle.height 直接获取浏览器已计算好的高度值，
    // 它已经根据当前 box-sizing 模式给出了正确的 CSS height 属性值。
    const computedHeight = cs.height;
    if (computedHeight && computedHeight !== 'auto' && parseFloat(computedHeight) > 0) {
        frozenChatHeight = parseFloat(computedHeight);
        chatContainer.style.setProperty('height', computedHeight, 'important');
        chatContainer.style.setProperty('max-height', computedHeight, 'important');
        chatContainer.style.setProperty('min-height', computedHeight, 'important');
    }
}

function unfreezeChatHeight(chatContainer) {
    frozenChatHeight = 0;
    if (chatContainer) {
        chatContainer.style.removeProperty('height');
        chatContainer.style.removeProperty('max-height');
        chatContainer.style.removeProperty('min-height');
    }
}

/**
 * 启动 rAF 滚动位置锁：每帧检查并修正 scrollLeft。
 * 比 scroll 事件更可靠，因为浏览器原生焦点滚动可能不触发 scroll 事件，
 * 或者在 scroll 事件之前就完成了布局。
 */
function startPositionLock(chatContainer, targetPage) {
    stopPositionLock();
    // 缓存列宽：键盘打开期间列宽不变，无需每帧读取
    const cw = chatContainer.getBoundingClientRect().width;
    if (cw <= 0) return;
    const expectedLeft = targetPage * cw;
    function lock() {
        if (!isFocusGuardActive && !isKeyboardOpen) {
            positionLockRaf = null;
            return;
        }
        if (Math.abs(chatContainer.scrollLeft - expectedLeft) > 2) {
            chatContainer.scrollTo({ left: expectedLeft, behavior: 'instant' });
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

function initVirtualKeyboardGuard() {
    if (isKeyboardGuardInit) return;
    isKeyboardGuardInit = true;

    // ---- 文档级焦点监听：任何输入框获获焦时立即冻结 #chat 高度 ----
    // 注意：此监听器注册不依赖 window.visualViewport，确保所有浏览器都能冻结高度
    document.addEventListener('focusin', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const target = e.target;
        if (!target) return;

        // 只对可能触发虚拟键盘的元素响应
        const isInputLike = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (!isInputLike) return;

        // 跳过段落编辑器内的输入（它有自己的处理）
        if (target.classList.contains('twt-p-textarea') || target.closest('.twt-p-editor')) return;

        const chatContainer = document.getElementById('chat');
        if (!chatContainer) return;

        console.log('[TwT] focusin 触发, 当前页:', lastUserPage, '目标:', target.tagName, target.id || target.className);

        // 立即保存当前正确页码
        preKeyboardPage = lastUserPage;
        isFocusGuardActive = true;
        clearTimeout(focusGuardTimer);

        // 立即冻结 #chat 高度（在键盘动画开始之前！）
        if (!isKeyboardOpen) {
            freezeChatHeight(chatContainer);
            console.log('[TwT] 高度已冻结:', frozenChatHeight);
        }

        // 启动 rAF 滚动位置锁
        startPositionLock(chatContainer, lastUserPage);

        focusGuardTimer = setTimeout(() => {
            isFocusGuardActive = false;
            // 800ms 内键盘没弹出，说明不是键盘场景，解冻
            if (!isKeyboardOpen) {
                console.log('[TwT] 焦点保护超时，解冻');
                preKeyboardPage = -1;
                unfreezeChatHeight(chatContainer);
                stopPositionLock();
            }
        }, 800);
    });

    // ---- visualViewport 检测（可选，不是所有浏览器都支持）----
    if (!window.visualViewport) return;

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

            console.log('[TwT] 键盘弹出确认, preKeyboardPage:', preKeyboardPage, 'lastUserPage:', lastUserPage);

            // 恢复被截断的页码
            if (preKeyboardPage >= 0) {
                lastUserPage = preKeyboardPage;
                preKeyboardPage = -1;
            }
            // 关闭焦点保护窗口（但保留 rAF 锁直到键盘关闭）
            isFocusGuardActive = false;
            clearTimeout(focusGuardTimer);

            const chatContainer = document.getElementById('chat');
            if (chatContainer) {
                // 高度已经在 focusin 时冻结，这里只需确认
                if (frozenChatHeight <= 0) {
                    freezeChatHeight(chatContainer);
                }
                // 最终修正滚动位置
                const cw = chatContainer.getBoundingClientRect().width;
                if (cw > 0) {
                    chatContainer.scrollTo({ left: lastUserPage * cw, behavior: 'instant' });
                }
                // 保持 rAF 锁运行（isKeyboardOpen=true 会让它继续）
                startPositionLock(chatContainer, lastUserPage);
            }
        }
        // 高度明显增大（>100px）视为键盘收起
        else if (heightDiff < -100 && isKeyboardOpen) {
            clearTimeout(keyboardRestoreTimer);
            keyboardRestoreTimer = setTimeout(() => {
                console.log('[TwT] 键盘收起, 恢复页:', lastUserPage);
                const chatContainer = document.getElementById('chat');
                
                // 1. 先对焦点输入框执行 blur()，切断原生焦点滚动行为，防止重排时 scrollLeft 漂移
                const activeEl = document.activeElement;
                if (activeEl && chatContainer?.contains(activeEl)) {
                    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable) {
                        activeEl.blur();
                    }
                }
                
                // 2. 解冻高度并更新列宽（此时 isKeyboardOpen 仍为 true，rAF 锁继续保持正确位置）
                unfreezeChatHeight(chatContainer);
                updateColWidth();
                
                // 3. 在下一帧（重排完成）将页面定位至 lastUserPage，然后安全释放键盘锁定
                requestAnimationFrame(() => {
                    const cw = chatContainer?.getBoundingClientRect().width;
                    if (cw > 0) {
                        chatContainer.scrollTo({ left: lastUserPage * cw, behavior: 'instant' });
                    }
                    isKeyboardOpen = false;
                    stopPositionLock();
                });
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
            document.body.classList.toggle('twt-avatar-theme-layout', settings.avatarLayoutMode === 'theme');
        }
        // 延迟+重试等待 DOM 稳定后再初始化列宽
        updateColWidthWhenReady();
        window.addEventListener('resize', handleWindowResize);
        initResizeObserver();
        patchScrollIntoView();
        initVirtualKeyboardGuard();
        initChatMutationObserver();
    } else {
        document.body.classList.remove('twt-reading-mode', 'twt-swipe-disabled', 'twt-message-page', 'twt-avatar-theme-layout');
        window.removeEventListener('resize', handleWindowResize);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        disconnectChatMutationObserver();
        // 退出翻页模式时解冻高度并清除滚动收容样式
        isKeyboardOpen = false;
        clearTimeout(keyboardRestoreTimer);
        // 清理焦点保护状态
        isFocusGuardActive = false;
        preKeyboardPage = -1;
        clearTimeout(focusGuardTimer);
        stopPositionLock();
        const chatContainer = document.getElementById('chat');
        unfreezeChatHeight(chatContainer);
        if (chatContainer) {
            chatContainer.querySelectorAll('.twt-pagination-scrollable').forEach(el => {
                el.style.removeProperty('max-height');
                el.style.removeProperty('overflow-y');
                el.classList.remove('twt-pagination-scrollable');
            });
            chatContainer.querySelectorAll('.twt-html-container').forEach(el => {
                el.classList.remove('twt-html-container');
            });
            chatContainer.querySelectorAll('.twt-html-needs-break').forEach(el => {
                el.classList.remove('twt-html-needs-break');
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
    // ---- <summary> 点击捕获拦截器 ----
    // 在事件捕获阶段（浏览器处理 <details> 展开之前）同步设置 max-height。
    // 这是消灭时序漏洞的最后防线：即使新消息刚到、containOversizedElements
    // 还在 150ms 防抖等待中，点击展开也不会触发列重排跳页。
    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const summary = e.target.closest('summary');
        if (!summary) return;
        const details = summary.closest('details');
        if (!details) return;
        // 只处理 #chat 内的 <details>
        const chat = document.getElementById('chat');
        if (!chat || !chat.contains(details)) return;
        
        if (details.open) {
            // 正在折叠收起：立即同步移除高度限制与滚动样式，防止收起瞬间有布局残留和二次重排
            details.style.removeProperty('max-height');
            details.style.removeProperty('overflow-y');
            details.classList.remove('twt-pagination-scrollable');
        } else {
            // 正在展开：立即同步计算并应用自适应高度限制，消灭时序漏洞，防止展开瞬间触发列重排跳页
            const colHeight = chat.clientHeight;
            if (colHeight > 0) {
                const isPageBreakEnabled = extension_settings?.twt?.htmlPageBreakEnabled !== false;
                const maxHeight = getAdaptiveMaxHeight(details, chat, colHeight, isPageBreakEnabled);
                details.style.setProperty('max-height', `${maxHeight}px`, 'important');
                details.style.setProperty('overflow-y', 'auto', 'important');
                details.classList.add('twt-pagination-scrollable');
            }
        }
    }, true); // capture: true — 在浏览器默认行为之前执行

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

        if (document.body.classList.contains('twt-excerpt-active')) {
            return;
        }

        const chatContainer = document.getElementById('chat');
        if (!chatContainer?.contains(e.target)) return;

        // 移除 details 以避免将点击 details 内容区域误判为点击了交互元素（summary 仍保留以保护折叠/展开区域）
        const baseSelector = 'button, a, input, textarea, select, label, summary, [onclick], [role="button"], [tabindex], .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon';
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
 * 每次聊天切换后都需要重新调用，以重新绑定 to 新的 #chat 元素。
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
        if (isFocusGuardActive || isKeyboardOpen) return; // 键盘/焦点保护期内不更新 lastUserPage
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
        if (document.body.classList.contains('twt-excerpt-active')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        clearTimeout(touchCooldownTimer);
        isTouching = true;
        isUserTouchActive = true; // 开启触摸滑动标记
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
        if (document.body.classList.contains('twt-excerpt-active')) return;
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
        if (document.body.classList.contains('twt-excerpt-active')) return;
        const settings = getSettings();
        if (!settings?.enabled || !settings.swipeEnabled) return;

        if (!touchIsHorizontal) {
            isProgrammaticScrolling = false;
            touchCooldownTimer = setTimeout(() => { 
                isTouching = false; 
                isUserTouchActive = false; // 清理滑动标记
            }, 150);
            return;
        }

        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaTime = Date.now() - touchStartTime;
        const cw = chatContainer.getBoundingClientRect().width;
        if (cw <= 0) { 
            isProgrammaticScrolling = false; 
            isTouching = false; 
            isUserTouchActive = false; // 清理滑动标记
            return; 
        }

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
            isUserTouchActive = false; // 清理滑动标记
            isProgrammaticScrolling = false;
            chatContainer.removeEventListener('scrollend', onSnapEnd);
            clearTimeout(touchCooldownTimer);
        };
        chatContainer.addEventListener('scrollend', onSnapEnd);
        touchCooldownTimer = setTimeout(() => {
            isTouching = false;
            isUserTouchActive = false; // 清理滑动标记
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
        isUserTouchActive = false; // 清理滑动标记
    }, { passive: true, signal });
}
