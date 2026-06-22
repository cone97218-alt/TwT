// @ts-nocheck
import { getContext } from '../../../extensions.js';
import { hideChatMessageRange } from '../../../chats.js';
import { openParagraphEditor } from './paragraph.js';

let longpressTimeout = null;
let touchStartX = 0;
let touchStartY = 0;
let toggleExcerptCallback = null;

export function applyMenuMode(enabled, settings) {
    // Handles runtime state updates if any
}

export function initMenu(getSettings, onToggleExcerpt) {
    toggleExcerptCallback = onToggleExcerpt;
    const chatContainer = $('#chat');
    if (!chatContainer.length) return;

    // Block default context menu when the extension menu is enabled
    chatContainer.on('contextmenu', (e) => {
        const settings = getSettings();
        if (settings && settings.menuEnabled) {
            e.preventDefault();
        }
    });

    const handleStart = (e, clientX, clientY) => {
        const settings = getSettings();
        if (!settings || !settings.menuEnabled || settings.menuInvokeMethod !== 'longpress') return;

        const target = e.target;
        // Avoid launching menu when interacting with already interactive controls
        if ($(target).closest('button, a, input, textarea, select, .mes_button, .swipe-button, .ch_name, .avatar, img, .svg-icon').length) {
            return;
        }

        const $mes = $(target).closest('.mes');
        if (!$mes.length) return;

        touchStartX = clientX;
        touchStartY = clientY;

        clearTimeout(longpressTimeout);
        longpressTimeout = setTimeout(() => {
            showContextMenu(e, $mes, clientX, clientY, settings);
        }, settings.menuLongpressDelay || 500);
    };

    const handleMove = (clientX, clientY) => {
        if (longpressTimeout) {
            const dist = Math.hypot(clientX - touchStartX, clientY - touchStartY);
            if (dist > 10) {
                clearTimeout(longpressTimeout);
                longpressTimeout = null;
            }
        }
    };

    const handleEnd = () => {
        clearTimeout(longpressTimeout);
        longpressTimeout = null;
    };

    // Bind touch gestures
    chatContainer.on('touchstart', (e) => {
        if (e.touches.length === 1) {
            handleStart(e, e.touches[0].clientX, e.touches[0].clientY);
        }
    });

    chatContainer.on('touchmove', (e) => {
        if (e.touches.length === 1) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    });

    chatContainer.on('touchend touchcancel', () => {
        handleEnd();
    });

    // Bind mouse events
    chatContainer.on('mousedown', (e) => {
        if (e.button === 0) { // Left click only
            handleStart(e, e.clientX, e.clientY);
        }
    });

    chatContainer.on('mousemove', (e) => {
        handleMove(e.clientX, e.clientY);
    });

    chatContainer.on('mouseup mouseleave', () => {
        handleEnd();
    });

    // Close menu when clicking outside
    $(document).on('click.twt-menu touchstart.twt-menu', function() {
        const $menu = $('#twt-custom-menu');
        if ($menu.is(':visible')) {
            setTimeout(() => {
                $menu.hide();
            }, 0);
        }
    });
}

function showContextMenu(e, $mes, clientX, clientY, settings) {
    if (e.cancelable) e.preventDefault();

    const mesId = Number($mes.attr('mesid'));
    const isLatest = $mes.hasClass('last_mes');
    const isUser = $mes.attr('is_user') === 'true';
    const isLatestAi = isLatest && !isUser;

    let $menu = $('#twt-custom-menu');
    if (!$menu.length) {
        $menu = $('<div id="twt-custom-menu"></div>').appendTo('body');
    }
    $menu.empty();

    let hasItems = false;

    // Add Regenerate
    if (settings.menuOptRegenerate && isLatestAi) {
        const $item = $('<div class="twt-menu-item"><i class="fa-solid fa-rotate-right"></i><span>重新生成</span></div>');
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            $('#option_regenerate').trigger('click');
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add Swipe
    if (settings.menuOptSwipe && isLatestAi) {
        const $item = $('<div class="twt-menu-item"><i class="fa-solid fa-chevron-right"></i><span>滑动</span></div>');
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            $('.last_mes .swipe_right').trigger('click');
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add Paragraph Comment (小说段评) -> 段评
    if (settings.commentsEnabled) {
        const $item = $('<div class="twt-menu-item"><i class="fa-regular fa-comment-dots"></i><span>段评</span></div>');
        $item.on('click', async (evt) => {
            evt.stopPropagation();
            $menu.hide();
            const { triggerBatchCommentsForMessage } = await import('./paragraph.js');
            await triggerBatchCommentsForMessage(mesId);
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add Paragraph Edit (分段编辑) -> 编辑
    if (settings.menuOptEdit) {
        const $item = $('<div class="twt-menu-item"><i class="fa-regular fa-pen-to-square"></i><span>编辑</span></div>');
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            openParagraphEditor(mesId, clientX, clientY);
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add Excerpt (摘抄) -> 摘抄
    if (settings.menuOptExcerpt) {
        const $item = $('<div class="twt-menu-item"><i class="fa-regular fa-bookmark"></i><span>摘抄</span></div>');
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            startExcerptLinkage();
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add Fullscreen (全屏模式) -> 全屏 / 退出
    if (settings.menuOptFullscreen) {
        const isCurrentlyFullscreen = settings.isFullscreen;
        const label = isCurrentlyFullscreen ? '退出' : '全屏';
        const icon = isCurrentlyFullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        const $item = $(`<div class="twt-menu-item"><i class="${icon}"></i><span>${label}</span></div>`);
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            settings.isFullscreen = !isCurrentlyFullscreen;
            applyFullscreenMode(settings.isFullscreen);
            getContext().saveSettingsDebounced();
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add Manage Messages (管理消息) -> 管理
    if (settings.menuOptManage) {
        const $item = $('<div class="twt-menu-item"><i class="fa-solid fa-list-check"></i><span>管理</span></div>');
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            openMessageManagerModal(mesId);
        });
        $menu.append($item);
        hasItems = true;

        // Add Hide Current Message (隐藏/显示本条) Shortcut -> 隐藏 / 显示
        const currentMsg = getContext().chat[mesId];
        const isCurrentHidden = currentMsg ? (currentMsg.is_system || currentMsg.extra?.is_system) : false;
        const hideLabel = isCurrentHidden ? '显示' : '隐藏';
        const hideIcon = isCurrentHidden ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
        
        const $hideItem = $(`<div class="twt-menu-item"><i class="${hideIcon}"></i><span>${hideLabel}</span></div>`);
        $hideItem.on('click', async (evt) => {
            evt.stopPropagation();
            $menu.hide();
            await hideChatMessageRange(mesId, mesId, isCurrentHidden);
        });
        $menu.append($hideItem);

        // Add Delete Current Message (删除本条消息) Shortcut -> 删除
        const $deleteItem = $('<div class="twt-menu-item" style="color: #ff4444;"><i class="fa-regular fa-trash-can"></i><span>删除</span></div>');
        $deleteItem.on('click', async (evt) => {
            evt.stopPropagation();
            $menu.hide();
            if (confirm('确定要删除这条消息吗？')) {
                await getContext().deleteMessage(mesId, undefined, false);
            }
        });
        $menu.append($deleteItem);
    }



    if (!hasItems) return;

    // Show menu offscreen first to measure dimensions
    $menu.css({
        visibility: 'hidden',
        display: 'block',
        left: '0px',
        top: '0px'
    });

    const menuWidth = $menu.outerWidth() || 130;
    const menuHeight = $menu.outerHeight() || 100;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    const direction = settings.menuDirection || 'bottom-right';
    let posX = clientX;
    let posY = clientY;

    if (direction === 'top-left') {
        posX = clientX - menuWidth;
        posY = clientY - menuHeight;
    } else if (direction === 'top-right') {
        posX = clientX;
        posY = clientY - menuHeight;
    } else if (direction === 'bottom-left') {
        posX = clientX - menuWidth;
        posY = clientY;
    } else { // 'bottom-right'
        posX = clientX;
        posY = clientY;
    }

    // Clamp to screen boundaries (with scroll offset)
    posX = Math.max(10, Math.min(posX, screenWidth - menuWidth - 10)) + window.scrollX;
    posY = Math.max(10, Math.min(posY, screenHeight - menuHeight - 10)) + window.scrollY;

    $menu.css({
        left: posX + 'px',
        top: posY + 'px',
        visibility: 'visible'
    });

    // Stop propagation inside menu to prevent close trigger
    $menu.off('mousedown mouseup click touchstart').on('mousedown mouseup click touchstart', (evt) => {
        evt.stopPropagation();
    });
}

export function applyFullscreenMode(enabled) {
    let docs = [document];
    try {
        if (window.parent && window.parent.document) {
            docs.push(window.parent.document);
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document for applyFullscreenMode.", e);
    }
    
    docs.forEach(doc => {
        if (enabled) {
            $(doc.body).addClass('twt-fullscreen-mode');
        } else {
            $(doc.body).removeClass('twt-fullscreen-mode');
        }
    });
}

export function openMessageManagerModal(mesId) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || !chat.length) return;

    const currentMsg = chat[mesId];
    if (!currentMsg) return;

    // Sync theme variables from parent to iframe if applicable
    try {
        if (window.parent && window.parent.document) {
            document.documentElement.setAttribute('style',
                window.parent.document.documentElement.getAttribute('style')
            );
        }
    } catch (e) {
        console.warn("TwT: Cannot sync style attribute from parent.", e);
    }

    // Resolve opaque background color based on SmartThemeBlurTintColor
    let opaqueBgColor = '';
    try {
        const temp = document.createElement('div');
        temp.style.color = 'var(--SmartThemeBlurTintColor)';
        document.body.appendChild(temp);
        const style = window.getComputedStyle(temp).color;
        document.body.removeChild(temp);
        const match = style.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
        if (match) {
            opaqueBgColor = `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
        }
    } catch (e) {
        console.error("TwT: Failed to resolve opaque background color", e);
    }

    let docs = [document];
    try {
        if (window.parent && window.parent.document) {
            docs.push(window.parent.document);
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document for modal creation.", e);
    }
    const parentDoc = docs[docs.length - 1];

    const oldModal = parentDoc.getElementById('twt-range-modal');
    if (oldModal) oldModal.remove();

    const modalEl = parentDoc.createElement('div');
    modalEl.id = 'twt-range-modal';
    modalEl.className = 'twt-range-modal-overlay';
    
    function getVisibleCenter() {
        let top = 0;
        let height = window.innerHeight;
        let isIframeCentering = false;
        try {
            if (window.parent && window.parent !== window && window.parent.document) {
                const iframe = window.frameElement;
                if (iframe) {
                    const rect = iframe.getBoundingClientRect();
                    const parentHeight = window.parent.innerHeight;
                    const visibleTop = Math.max(0, -rect.top);
                    const visibleBottom = Math.min(rect.height || document.documentElement.scrollHeight, parentHeight - rect.top);
                    top = visibleTop;
                    height = visibleBottom - visibleTop;
                    isIframeCentering = true;
                }
            }
        } catch (e) {}
        if (!isIframeCentering) {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
            top = scrollTop;
            height = window.innerHeight || document.documentElement.clientHeight;
        }
        return { centerY: top + height / 2, visibleHeight: height };
    }

    modalEl.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; z-index: 999999; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);';

    const buildListHtml = () => {
        let html = '';
        const currentChat = context.chat || [];
        currentChat.forEach((msg, idx) => {
            const name = msg.name || (msg.is_user ? 'User' : 'AI');
            const mes = msg.mes || '';
            const clean = mes.replace(/[\r\n]+/g, ' ').trim();
            const excerpt = clean.substring(0, 30);
            const preview = `${name}: ${excerpt}${clean.length > 30 ? '...' : ''}`;
            const isHidden = msg.is_system || msg.extra?.is_system;
            const statusText = isHidden ? ' [已隐藏]' : '';
            const itemClass = isHidden ? 'twt-range-item twt-item-hidden' : 'twt-range-item';
            
            html += `
                <div class="${itemClass}" data-id="${idx}">
                    <input type="checkbox" class="twt-range-item-checkbox" data-id="${idx}" />
                    <span class="twt-range-item-label">#${idx}${statusText} - ${preview}</span>
                </div>
            `;
        });
        return html;
    };

    const listItemsHtml = buildListHtml();

    const boxStyle = opaqueBgColor ? `background-color: ${opaqueBgColor} !important;` : '';

    modalEl.innerHTML = `
        <div class="twt-range-modal-box" style="${boxStyle}">
            <div class="twt-range-modal-header">管理消息</div>
            
            <div class="twt-range-list-container">
                <div class="twt-range-list-actions">
                    <button class="twt-range-list-btn" id="twt-select-all" type="button" title="全选"><i class="fa-solid fa-check-double"></i></button>
                    <button class="twt-range-list-btn" id="twt-invert-select" type="button" title="反选"><i class="fa-solid fa-repeat"></i></button>
                    <button class="twt-range-list-btn" id="twt-clear-select" type="button" title="清空"><i class="fa-solid fa-eraser"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-range" type="button" title="连选"><i class="fa-solid fa-arrows-up-down"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-current" type="button" title="仅选当前"><i class="fa-solid fa-bullseye"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-current-to-end" type="button" title="选当前及以后"><i class="fa-solid fa-angles-down"></i></button>
                </div>
                <div class="twt-range-list" id="twt-range-list-scroll">
                    ${listItemsHtml}
                </div>
            </div>
            
            <div class="twt-range-modal-actions">
                <button class="twt-range-btn cancel">取消</button>
                <button class="twt-range-btn btn-show confirm-show" title="显示">
                    <i class="fa-regular fa-eye"></i>
                </button>
                <button class="twt-range-btn btn-hide confirm-hide" title="隐藏">
                    <i class="fa-regular fa-eye-slash"></i>
                </button>
                <button class="twt-range-btn btn-delete confirm-delete" title="删除">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
        </div>
    `;

    parentDoc.body.appendChild(modalEl);

    const $modal = $(modalEl);
    
    const $scrollContainer = $modal.find('#twt-range-list-scroll');
    const $targetItem = $scrollContainer.find(`.twt-range-item[data-id="${mesId}"]`);
    if ($targetItem.length) {
        $targetItem.find('.twt-range-item-checkbox').prop('checked', true);
        setTimeout(() => {
            $scrollContainer.scrollTop($targetItem.position().top + $scrollContainer.scrollTop() - 60);
        }, 50);
    }

    const repositionModal = () => {
        const { centerY } = getVisibleCenter();
        const docHeight = Math.max(
            parentDoc.documentElement.scrollHeight,
            parentDoc.body.scrollHeight,
            window.innerHeight
        );
        modalEl.style.height = docHeight + 'px';
        
        const $box = $modal.find('.twt-range-modal-box');
        $box.css({
            position: 'absolute',
            top: centerY + 'px',
            left: '50%',
            transform: 'translate(-50%, -50%)'
        });
    };
    
    repositionModal();
    const refreshList = () => {
        const scrollTop = $scrollContainer.scrollTop();
        $scrollContainer.html(buildListHtml());
        $scrollContainer.scrollTop(scrollTop);
    };

    window.addEventListener('resize', repositionModal);
    window.addEventListener('scroll', repositionModal);
    try {
        if (window.parent && window.parent !== window) {
            window.parent.addEventListener('resize', repositionModal);
            window.parent.addEventListener('scroll', repositionModal);
        }
    } catch (e) {}

    const closeModal = () => {
        window.removeEventListener('resize', repositionModal);
        window.removeEventListener('scroll', repositionModal);
        try {
            if (window.parent && window.parent !== window) {
                window.parent.removeEventListener('resize', repositionModal);
                window.parent.removeEventListener('scroll', repositionModal);
            }
        } catch (e) {}
        $modal.remove();
    };

    $modal.on('click', function(ev) {
        if (ev.target === this) closeModal();
    });

    $modal.find('.cancel').on('click', (e) => {
        e.stopPropagation();
        closeModal();
    });

    $modal.find('#twt-select-all').on('click', (e) => {
        e.stopPropagation();
        $modal.find('.twt-range-item-checkbox').prop('checked', true);
    });

    $modal.find('#twt-clear-select').on('click', (e) => {
        e.stopPropagation();
        $modal.find('.twt-range-item-checkbox').prop('checked', false);
    });

    $modal.find('#twt-invert-select').on('click', (e) => {
        e.stopPropagation();
        $modal.find('.twt-range-item-checkbox').each(function() {
            $(this).prop('checked', !$(this).prop('checked'));
        });
    });

    $modal.find('#twt-select-current').on('click', (e) => {
        e.stopPropagation();
        $modal.find('.twt-range-item-checkbox').prop('checked', false);
        $modal.find(`.twt-range-item-checkbox[data-id="${mesId}"]`).prop('checked', true);
    });

    $modal.find('#twt-select-current-to-end').on('click', (e) => {
        e.stopPropagation();
        $modal.find('.twt-range-item-checkbox').each(function() {
            const id = Number($(this).attr('data-id'));
            $(this).prop('checked', id >= mesId);
        });
    });

    let rangeSelectMode = false;
    let rangeSelectStartIdx = null;

    $modal.find('#twt-select-range').on('click', function(e) {
        e.stopPropagation();
        rangeSelectMode = !rangeSelectMode;
        $(this).toggleClass('active', rangeSelectMode);
        
        if (rangeSelectMode) {
            rangeSelectStartIdx = null;
            $modal.find('.twt-range-item').removeClass('range-start-selected');
        } else {
            $modal.find('.twt-range-item').removeClass('range-start-selected');
        }
    });

    let lastCheckedIdx = mesId;

    function handleRangeSelectInteraction(currentIdx, $itemEl) {
        if (rangeSelectStartIdx === null) {
            rangeSelectStartIdx = currentIdx;
            $modal.find('.twt-range-item').removeClass('range-start-selected');
            $itemEl.addClass('range-start-selected');
        } else {
            const start = Math.min(rangeSelectStartIdx, currentIdx);
            const end = Math.max(rangeSelectStartIdx, currentIdx);
            
            // Check all messages in the range
            $modal.find('.twt-range-item-checkbox').each(function() {
                const id = Number($(this).attr('data-id'));
                if (id >= start && id <= end) {
                    $(this).prop('checked', true);
                }
            });
            
            // Exit range select mode
            rangeSelectMode = false;
            rangeSelectStartIdx = null;
            $modal.find('.twt-range-item').removeClass('range-start-selected');
            $modal.find('#twt-select-range').removeClass('active');
        }
    }

    function performShiftClickSelection(currentIdx, isChecked, isShiftPressed) {
        if (isShiftPressed && lastCheckedIdx !== null) {
            const start = Math.min(lastCheckedIdx, currentIdx);
            const end = Math.max(lastCheckedIdx, currentIdx);
            $modal.find('.twt-range-item-checkbox').each(function() {
                const id = Number($(this).attr('data-id'));
                if (id >= start && id <= end) {
                    $(this).prop('checked', isChecked);
                }
            });
        }
        lastCheckedIdx = currentIdx;
    }

    $scrollContainer.on('click', '.twt-range-item', function(e) {
        const $chk = $(this).find('.twt-range-item-checkbox');
        const currentIdx = Number($chk.attr('data-id'));
        
        if (e.target.tagName !== 'INPUT') {
            if (rangeSelectMode) {
                handleRangeSelectInteraction(currentIdx, $(this));
            } else {
                const isChecked = !$chk.prop('checked');
                $chk.prop('checked', isChecked);
                performShiftClickSelection(currentIdx, isChecked, e.shiftKey);
            }
        }
    });

    $scrollContainer.on('click', '.twt-range-item-checkbox', function(e) {
        e.stopPropagation();
        const currentIdx = Number($(this).attr('data-id'));
        const isChecked = $(this).prop('checked');
        
        if (rangeSelectMode) {
            // Revert default checkbox check so range selection logic handles it
            $(this).prop('checked', !isChecked);
            handleRangeSelectInteraction(currentIdx, $(this).closest('.twt-range-item'));
        } else {
            performShiftClickSelection(currentIdx, isChecked, e.shiftKey);
        }
    });

    const getSelectedIds = () => {
        const targetIds = [];
        $modal.find('.twt-range-item-checkbox:checked').each(function() {
            targetIds.push(Number($(this).attr('data-id')));
        });
        return targetIds;
    };

    // Helper to hide/unhide target IDs efficiently by grouping into contiguous ranges
    const setHideStateForIds = async (targetIds, unhide) => {
        if (targetIds.length === 0) return;
        targetIds.sort((a, b) => a - b);
        let ranges = [];
        let start = targetIds[0];
        let end = targetIds[0];
        for (let i = 1; i < targetIds.length; i++) {
            if (targetIds[i] === end + 1) {
                end = targetIds[i];
            } else {
                ranges.push({ start, end });
                start = targetIds[i];
                end = targetIds[i];
            }
        }
        ranges.push({ start, end });

        for (const range of ranges) {
            await hideChatMessageRange(range.start, range.end, unhide);
        }
    };

    $modal.find('.confirm-show').on('click', async (e) => {
        e.stopPropagation();
        const targetIds = getSelectedIds();
        if (targetIds.length === 0) {
            alert('请先选择目标消息！');
            return;
        }
        await setHideStateForIds(targetIds, true);
        refreshList();
        repositionModal();
    });

    $modal.find('.confirm-hide').on('click', async (e) => {
        e.stopPropagation();
        const targetIds = getSelectedIds();
        if (targetIds.length === 0) {
            alert('请先选择目标消息！');
            return;
        }
        await setHideStateForIds(targetIds, false);
        refreshList();
        repositionModal();
    });

    $modal.find('.confirm-delete').on('click', async (e) => {
        e.stopPropagation();
        const targetIds = getSelectedIds();
        if (targetIds.length === 0) {
            alert('请先选择目标消息！');
            return;
        }
        
        const confirmMsg = targetIds.length === 1 
            ? '确定要删除这条消息吗？' 
            : `确定要删除选中的 ${targetIds.length} 条消息吗？(此操作不可逆！)`;
            
        if (confirm(confirmMsg)) {
            const sortedIds = targetIds.sort((a, b) => b - a);
            for (const id of sortedIds) {
                await context.deleteMessage(id, undefined, false);
            }
            refreshList();
            repositionModal();
        }
    });
}

function getParentDoc() {
    let doc = document;
    try {
        if (window.parent && window.parent.document) {
            doc = window.parent.document;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document", e);
    }
    return doc;
}

function startExcerptLinkage() {
    const parentDoc = getParentDoc();
    const oldBar = parentDoc.getElementById('twt-excerpt-float-bar');
    if (oldBar) oldBar.remove();

    const bar = parentDoc.createElement('div');
    bar.id = 'twt-excerpt-float-bar';
    
    const textSpan = parentDoc.createElement('span');
    textSpan.className = 'twt-excerpt-text';
    textSpan.innerHTML = '摘抄模式已开启';
    bar.appendChild(textSpan);

    const closeBtn = parentDoc.createElement('button');
    closeBtn.className = 'twt-excerpt-close-btn';
    closeBtn.innerText = '关闭';
    closeBtn.addEventListener('click', () => {
        bar.remove();
        if (toggleExcerptCallback) {
            toggleExcerptCallback(false);
        }
    });
    bar.appendChild(closeBtn);

    parentDoc.body.appendChild(bar);

    if (toggleExcerptCallback) {
        toggleExcerptCallback(true);
    }
}
