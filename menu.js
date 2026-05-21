// @ts-nocheck
import { openParagraphEditor } from './paragraph.js';

let longpressTimeout = null;
let touchStartX = 0;
let touchStartY = 0;

export function applyMenuMode(enabled, settings) {
    // Handles runtime state updates if any
}

export function initMenu(getSettings) {
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

    // Add Paragraph Edit (分段编辑)
    if (settings.menuOptEdit) {
        const $item = $('<div class="twt-menu-item"><i class="fa-regular fa-pen-to-square"></i><span>分段编辑</span></div>');
        $item.on('click', (evt) => {
            evt.stopPropagation();
            $menu.hide();
            openParagraphEditor(mesId);
        });
        $menu.append($item);
        hasItems = true;
    }

    // Add placeholders
    const placeholders = [
        { key: 'menuOptHide', label: '隐藏', icon: 'fa-regular fa-eye-slash' },
        { key: 'menuOptExcerpt', label: '摘抄', icon: 'fa-regular fa-bookmark' },
        { key: 'menuOptDelete', label: '删除', icon: 'fa-regular fa-trash-can' }
    ];

    placeholders.forEach(opt => {
        if (settings[opt.key]) {
            const $item = $(`<div class="twt-menu-item twt-menu-disabled"><i class="${opt.icon}"></i><span>${opt.label}</span></div>`);
            $item.on('click', (evt) => {
                evt.stopPropagation();
                $menu.hide();
            });
            $menu.append($item);
            hasItems = true;
        }
    });

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
