// @ts-nocheck
import { extension_settings } from '../../../../../extensions.js';

function getWin() {
    try {
        if (window.parent && window.parent.document) return window.parent;
    } catch {}
    return window;
}

function getDoc() {
    try {
        if (window.parent && window.parent.document) return window.parent.document;
    } catch {}
    return document;
}

const QR_BTN_ID = 'twt-qr-html-app-btn';
const MODAL_ID = 'twt-html-app-modal';
const POS_KEY = 'twt_html_popup_saved_pos';

/**
 * 新 Iframe 被捕捉未读状态标志与更新器
 */
let hasUnreadApp = false;

function updateQrBadge(show) {
    hasUnreadApp = show;
    const doc = getDoc();
    const btn = doc.getElementById(QR_BTN_ID);
    if (btn) {
        btn.classList.toggle('has-unread', show);
    }
}

/**
 * 动态 ResizeObserver 句柄与 Iframe 内部 MutationObserver
 */
let activeResizeObserver = null;
let activeIframeObserver = null;

function stopAppResizeObserver() {
    if (activeResizeObserver) {
        activeResizeObserver.disconnect();
        activeResizeObserver = null;
    }
    if (activeIframeObserver) {
        activeIframeObserver.disconnect();
        activeIframeObserver = null;
    }
}

/**
 * 节流/防抖函数 (Debounce)
 */
function debounce(fn, delay = 200) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
            timer = null;
        }, delay);
    };
}

/**
 * LRU 机制：限制 localStorage 中保存的 HTML 展开状态最多为 MAX_STORED_STATES 个
 */
const MAX_STORED_STATES = 30;

function cleanOldAppHtmlStates() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('twt_app_saved_html_')) {
                keys.push(k);
            }
        }
        if (keys.length > MAX_STORED_STATES) {
            const toRemoveCount = keys.length - MAX_STORED_STATES;
            for (let i = 0; i < toRemoveCount; i++) {
                localStorage.removeItem(keys[i]);
            }
            console.log(`[TwT HtmlPopup] 自动执行 LRU 清理，已清除 ${toRemoveCount} 条较旧的 HTML 展开状态缓存`);
        }
    } catch (e) {
        console.warn('[TwT HtmlPopup] LRU 清理失败:', e);
    }
}

/**
 * 追踪当前移入 Modal 的真实 DOM 节点与其正文占位符
 */
let currentlyMovedEl = null;

function returnMovedElementBack() {
    stopAppResizeObserver();
    if (currentlyMovedEl && currentlyMovedEl.__twt_placeholder__) {
        const ph = currentlyMovedEl.__twt_placeholder__;
        if (ph && ph.parentNode && getDoc().body.contains(ph)) {
            ph.parentNode.insertBefore(currentlyMovedEl, ph);
            ph.remove();
            currentlyMovedEl.classList.add('twt-app-hidden');
            currentlyMovedEl.style.display = '';
            currentlyMovedEl.style.visibility = '';
        } else {
            console.log('[TwT HtmlPopup] 占位节点已被酒馆 Swipe/重构替换，释放旧 DOM 引用');
        }
        delete currentlyMovedEl.__twt_placeholder__;
    }
    currentlyMovedEl = null;
}

/**
 * 读取与保存弹窗的持久化位置信息
 */
function getSavedPosition() {
    try {
        const data = localStorage.getItem(POS_KEY);
        if (data) return JSON.parse(data);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 读取本地保存的位置数据失败:', e);
    }
    return null;
}

function saveSavedPosition(left, top) {
    try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
        console.log(`[TwT HtmlPopup] 弹窗位置已持久化记忆: Left=${left}px, Top=${top}px`);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 保存位置到 localStorage 失败:', e);
    }
}

/**
 * 读取与保存消息关联的已选应用索引
 */
function getSavedAppIndex(mesIndexInfo) {
    try {
        if (mesIndexInfo) {
            const val = localStorage.getItem(`twt_html_popup_index_mes_${mesIndexInfo}`);
            if (val !== null && !isNaN(parseInt(val, 10))) return parseInt(val, 10);
        }
        const globalVal = localStorage.getItem('twt_html_popup_last_index');
        if (globalVal !== null && !isNaN(parseInt(globalVal, 10))) return parseInt(globalVal, 10);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 读取记忆的应用索引失败:', e);
    }
    return 0;
}

function saveSavedAppIndex(mesIndexInfo, index) {
    try {
        if (mesIndexInfo) {
            localStorage.setItem(`twt_html_popup_index_mes_${mesIndexInfo}`, index);
        }
        localStorage.setItem('twt_html_popup_last_index', index);
        console.log(`[TwT HtmlPopup] 消息 #${mesIndexInfo} 的当前应用索引 [${index}] 已保存记忆`);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 保存应用索引失败:', e);
    }
}

/**
 * 物理精确测算并自适应调整 Iframe 及其内部 DOM 内容尺寸
 */
function fitIframeToContent(iframeEl, dialogEl) {
    if (!iframeEl || iframeEl.tagName !== 'IFRAME') return;
    try {
        const iDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
        if (!iDoc || !iDoc.body) return;

        const children = Array.from(iDoc.body.children).filter(
            c => c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && c.tagName !== 'LINK'
        );

        let realWidth = 0;
        let realHeight = 0;

        const oldBodyWidth = iDoc.body.style.width;
        const oldBodyDisplay = iDoc.body.style.display;

        iDoc.body.style.width = 'fit-content';
        iDoc.body.style.display = 'inline-block';

        if (children.length > 0) {
            let maxChildW = 0;
            children.forEach(child => {
                const r = child.getBoundingClientRect();
                if (r.width > maxChildW) maxChildW = r.width;
            });
            realWidth = maxChildW || iDoc.body.offsetWidth;
        } else {
            realWidth = iDoc.body.offsetWidth;
        }

        iDoc.body.style.width = oldBodyWidth;
        iDoc.body.style.display = oldBodyDisplay;

        realHeight = Math.max(iDoc.documentElement.scrollHeight, iDoc.body.scrollHeight);

        const win = getWin();
        const maxW = win.innerWidth * 0.96;
        const maxH = win.innerHeight * 0.92;

        if (realWidth > 40 && realWidth < maxW) {
            const finalW = Math.ceil(realWidth);
            iframeEl.style.width = `${finalW}px`;
            if (dialogEl) dialogEl.style.width = `${finalW}px`;
        }

        if (realHeight > 30) {
            const finalH = Math.min(Math.ceil(realHeight), maxH);
            iframeEl.style.height = `${finalH}px`;
        }

        console.log(`[TwT HtmlPopup] [Iframe 自适应成功] 真实宽度: ${realWidth}px, 高度: ${realHeight}px`);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 测算 Iframe 内容尺寸失败:', e);
    }
}

/**
 * 实时监测并响应 Iframe / DOM 内部尺寸变化，自适应动态调整
 */
function observeAppDynamicResizing(appEl, dialogEl) {
    stopAppResizeObserver();
    const win = getWin();

    const updateDialogBounds = () => {
        if (!appEl || !dialogEl) return;
        try {
            if (appEl.tagName === 'IFRAME') {
                fitIframeToContent(appEl, dialogEl);
            } else {
                const innerNode = appEl.firstElementChild || appEl;
                const rect = innerNode.getBoundingClientRect();
                const curW = rect.width || appEl.offsetWidth;
                if (curW > 50 && curW < win.innerWidth * 0.98) {
                    dialogEl.style.width = `${Math.ceil(curW)}px`;
                    appEl.style.width = '100%';
                }
            }
        } catch (e) {}
    };

    updateDialogBounds();

    if (window.ResizeObserver) {
        activeResizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updateDialogBounds);
        });
        activeResizeObserver.observe(appEl);
        if (appEl.firstElementChild) activeResizeObserver.observe(appEl.firstElementChild);
    }

    if (appEl.tagName === 'IFRAME') {
        const bindIframeMutation = () => {
            try {
                const iDoc = appEl.contentDocument || appEl.contentWindow?.document;
                if (iDoc && iDoc.body) {
                    fitIframeToContent(appEl, dialogEl);
                    const MutationClass = win.MutationObserver || window.MutationObserver;
                    if (MutationClass) {
                        activeIframeObserver = new MutationClass(debounce(() => {
                            fitIframeToContent(appEl, dialogEl);
                        }, 100));
                        activeIframeObserver.observe(iDoc.body, { childList: true, subtree: true, attributes: true, characterData: true });
                    }
                }
            } catch (e) {}
        };

        appEl.addEventListener('load', () => {
            bindIframeMutation();
            try {
                const iWin = appEl.contentWindow;
                if (iWin) {
                    iWin.addEventListener('resize', updateDialogBounds);
                    iWin.addEventListener('click', () => setTimeout(updateDialogBounds, 120));
                }
            } catch (e) {}
        });

        bindIframeMutation();
    }
}

/**
 * 监听并防抖保存 Iframe 内部展开/折叠 DOM 状态
 */
function attachIframeStateTracker(iframeEl, mesIndexInfo, appIndex) {
    const rawSave = () => {
        try {
            const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            if (doc && doc.documentElement) {
                const fullHtml = doc.documentElement.outerHTML;
                if (fullHtml && fullHtml.length > 20) {
                    iframeEl.srcdoc = fullHtml;
                    cleanOldAppHtmlStates();
                    localStorage.setItem(`twt_app_saved_html_${mesIndexInfo}_${appIndex}`, fullHtml);
                    console.log(`[TwT HtmlPopup] 防抖保存 Iframe 展开状态 (Msg #${mesIndexInfo}, App #${appIndex})`);
                }
            }
        } catch (e) {
            console.warn('[TwT HtmlPopup] 无法跨域或读取 Iframe 内部 Document:', e);
        }
    };

    const debouncedSave = debounce(rawSave, 200);

    const tryBind = () => {
        try {
            const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            if (doc) {
                doc.addEventListener('click', debouncedSave, true);
                doc.addEventListener('toggle', debouncedSave, true);
                doc.addEventListener('change', debouncedSave, true);
                doc.addEventListener('input', debouncedSave, true);
            }
        } catch (e) {}
    };

    iframeEl.addEventListener('load', tryBind);
    tryBind();
}

/**
 * 监听并防抖保存 普通 DOM 节点展开/折叠状态
 */
function attachDomStateTracker(domEl, mesIndexInfo, appIndex) {
    const rawSave = () => {
        try {
            domEl.querySelectorAll('details').forEach((d) => {
                if (d.open) d.setAttribute('open', '');
                else d.removeAttribute('open');
            });
            domEl.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((inp) => {
                if (inp.checked) inp.setAttribute('checked', '');
                else inp.removeAttribute('checked');
            });

            const currentHtml = domEl.innerHTML;
            cleanOldAppHtmlStates();
            localStorage.setItem(`twt_app_saved_html_${mesIndexInfo}_${appIndex}`, currentHtml);
            console.log(`[TwT HtmlPopup] 防抖保存 DOM 节点展开状态 (Msg #${mesIndexInfo}, App #${appIndex})`);
        } catch (e) {
            console.warn('[TwT HtmlPopup] 保存 DOM 节点状态失败:', e);
        }
    };

    const debouncedSave = debounce(rawSave, 200);

    domEl.addEventListener('click', debouncedSave, true);
    domEl.addEventListener('toggle', debouncedSave, true);
    domEl.addEventListener('change', debouncedSave, true);
}

/**
 * 解析用户自定义标题映射规则
 */
function resolveAppTitle(el, index) {
    const rawMapStr = extension_settings?.twt?.htmlPopupTitleMap || '';
    const rules = [];

    if (rawMapStr.trim()) {
        const lines = rawMapStr.split('\n');
        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let parts = trimmed.split('=');
            if (parts.length < 2) parts = trimmed.split(':');
            if (parts.length >= 2) {
                const pattern = parts[0].trim();
                const replacement = parts.slice(1).join('=').trim();
                if (pattern && replacement) {
                    rules.push({ pattern, replacement });
                }
            }
        });
    }

    const elId = el.id || '';
    const elClass = el.className || '';
    const dataTitle = el.getAttribute('data-title') || el.getAttribute('title') || el.getAttribute('name') || '';

    for (const rule of rules) {
        if (
            (elId && elId.includes(rule.pattern)) ||
            (elClass && elClass.includes(rule.pattern)) ||
            (dataTitle && dataTitle.includes(rule.pattern)) ||
            (el.outerHTML && el.outerHTML.includes(rule.pattern))
        ) {
            return rule.replacement;
        }
    }

    if (dataTitle) {
        let cleanTitle = dataTitle.replace(/\s+/g, ' ').trim();
        if (cleanTitle.length > 14) cleanTitle = cleanTitle.substring(0, 14) + '…';
        return cleanTitle;
    }

    if (el.querySelector) {
        const titleEl = el.querySelector('h1, h2, h3, h4, header, .title, [data-title]');
        if (titleEl && titleEl.textContent) {
            let t = titleEl.textContent.trim().replace(/\s+/g, ' ');
            if (t && t.length < 16) return t;
        }
    }

    return `部件 #${index + 1}`;
}

/**
 * 获取默认设置
 */
export function getHtmlPopupDefaultSettings() {
    return {
        htmlPopupEnabled: true,
        htmlPopupSelector: 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app',
        htmlPopupTitleMap: 'TH-message=剧情摘要\napp-stat=角色状态',
        htmlPopupHideInStream: true,
    };
}

/**
 * 样式注入 (彻底消除黑底、无框线、纯透明顶栏，包含 QR 栏左上角高亮主题色圆点提示)
 */
function injectStyles() {
    const doc = getDoc();
    let style = doc.getElementById('twt-html-popup-style');
    if (!style) {
        style = doc.createElement('style');
        style.id = 'twt-html-popup-style';
        doc.head.appendChild(style);
    }

    style.textContent = `
        /* 正文中隐藏应用 DOM 节点 */
        .twt-app-hidden {
            display: none !important;
        }

        /* QR 栏按钮与左上角高亮主题色点 */
        #twt-qr-html-app-btn {
            position: relative;
        }

        #twt-qr-html-app-btn .twt-qr-badge {
            display: none;
            position: absolute;
            top: 1px;
            left: 1px;
            width: 7px;
            height: 7px;
            background-color: var(--SmartThemeQuoteColor, #f38ba8); /* 跟着酒馆主题高亮色走，默认鲜艳高亮粉红 */
            border-radius: 50%;
            box-shadow: 0 0 7px var(--SmartThemeQuoteColor, rgba(243, 139, 168, 0.95));
            pointer-events: none;
            z-index: 2;
            animation: twtBadgePulse 1.8s infinite ease-in-out;
        }

        #twt-qr-html-app-btn.has-unread .twt-qr-badge {
            display: block;
        }

        @keyframes twtBadgePulse {
            0% {
                transform: scale(0.9);
                box-shadow: 0 0 4px var(--SmartThemeQuoteColor, rgba(243, 139, 168, 0.7));
            }
            50% {
                transform: scale(1.3);
                box-shadow: 0 0 9px var(--SmartThemeQuoteColor, rgba(243, 139, 168, 1));
            }
            100% {
                transform: scale(0.9);
                box-shadow: 0 0 4px var(--SmartThemeQuoteColor, rgba(243, 139, 168, 0.7));
            }
        }

        /* 弹窗顶层遮罩（允许穿透到底图，仅弹窗主体响应鼠标） */
        #twt-html-app-modal {
            position: fixed;
            left: 0;
            top: 0;
            width: 100vw;
            height: 100vh;
            z-index: 999999;
            pointer-events: none;
            box-sizing: border-box;
        }

        .twt-modal-dialog {
            pointer-events: auto;
            position: absolute;
            width: fit-content !important;
            height: fit-content !important;
            max-width: 98vw;
            max-height: 98vh;
            background: transparent !important; /* 彻底移除黑底背景 */
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            display: flex;
            flex-direction: column;
            overflow: visible;
            border-radius: 8px;
            transition: opacity 0.15s ease-out;
            box-sizing: border-box;
        }

        .twt-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 2px 6px;
            background: transparent !important; /* 顶栏彻底透明，无黑底 */
            border: none !important;
            outline: none !important;
            color: #cdd6f4;
            font-size: 12px;
            font-weight: 500;
            user-select: none;
            cursor: move;
            width: 100%;
            box-sizing: border-box;
            gap: 6px;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        }

        .twt-modal-drag-handle {
            display: flex;
            align-items: center;
            opacity: 0.85;
            font-size: 11px;
            padding: 0 2px;
            flex-shrink: 0;
            gap: 4px;
        }

        .twt-modal-floor-badge {
            font-size: 10px;
            opacity: 0.85;
            background: rgba(0, 0, 0, 0.4);
            padding: 1px 5px;
            border-radius: 4px;
            white-space: nowrap;
            backdrop-filter: blur(4px);
        }

        .twt-modal-controls {
            display: flex;
            align-items: center;
            gap: 3px;
            flex-shrink: 0;
            margin-left: auto;
        }

        .twt-modal-switcher {
            display: flex;
            align-items: center;
            gap: 3px;
            margin-right: 4px;
            padding-right: 4px;
            border-right: 1px solid rgba(255, 255, 255, 0.2);
            font-size: 11px;
            opacity: 0.95;
        }

        .twt-modal-select {
            background: rgba(0, 0, 0, 0.45);
            color: #cdd6f4;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 11px;
            cursor: pointer;
            outline: none;
            max-width: 130px;
            text-overflow: ellipsis;
            white-space: nowrap;
            backdrop-filter: blur(4px);
        }

        .twt-modal-select:hover {
            border-color: rgba(255, 255, 255, 0.5);
            background: rgba(0, 0, 0, 0.65);
        }

        .twt-modal-select option {
            background: #181825;
            color: #cdd6f4;
            padding: 4px;
        }

        .twt-modal-btn {
            background: transparent;
            border: none !important;
            outline: none !important;
            color: currentColor;
            opacity: 0.85;
            cursor: pointer;
            padding: 2px 5px;
            border-radius: 4px;
            font-size: 12px;
            transition: all 0.15s ease;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        }

        .twt-modal-btn:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.2);
        }

        .twt-modal-btn.close-btn:hover {
            background: #f38ba8;
            color: #11111b;
            text-shadow: none;
        }

        .twt-modal-body {
            width: fit-content !important;
            height: fit-content !important;
            max-width: 98vw;
            max-height: 95vh;
            overflow: auto;
            position: relative;
            background: transparent !important; /* 完全无框无黑底 */
            border: none !important;
            outline: none !important;
            box-sizing: border-box;
        }

        .twt-modal-body > iframe {
            border: none !important;
            outline: none !important;
            display: block;
            background: transparent !important;
        }

        .twt-modal-body > .twt-app-content-wrapper {
            width: fit-content !important;
            height: fit-content !important;
            box-sizing: border-box;
            background: transparent !important;
            border: none !important;
            outline: none !important;
        }
    `;
}

/**
 * 提取并隐藏正文中的匹配元素
 */
let hideScheduled = false;

export function hideMessageHtmlApps() {
    const settings = extension_settings?.twt;
    if (!settings || settings.htmlPopupEnabled === false) return;

    if (hideScheduled) return;
    hideScheduled = true;

    requestAnimationFrame(() => {
        hideScheduled = false;
        const selector = settings.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';
        const doc = getDoc();
        const chat = doc.getElementById('chat');
        if (!chat) return;

        try {
            const matchingElements = chat.querySelectorAll(`.mes_text ${selector}`);
            let count = 0;

            matchingElements.forEach((el) => {
                if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return;
                if (currentlyMovedEl === el) return;

                if (!el.classList.contains('twt-app-hidden')) {
                    el.classList.add('twt-app-hidden');
                    count++;
                }
            });

            if (count > 0) {
                console.log(`[TwT HtmlPopup] [性能优化] 增量隐藏了 ${count} 个匹配选择器 [${selector}] 的 HTML 应用节点`);
                const modal = doc.getElementById(MODAL_ID);
                if (!modal) {
                    updateQrBadge(true);
                }
            }
        } catch (err) {
            console.error(`[TwT HtmlPopup] 隐藏匹配元素失败:`, err);
        }
    });
}

/**
 * 定位当前翻页/阅读模式下视口聚焦的消息 Element
 */
export function getCurrentFocusedMessage() {
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    if (!chat) return null;

    const messages = Array.from(chat.querySelectorAll('.mes'));
    if (messages.length === 0) return null;

    if (doc.body.classList.contains('twt-reading-mode')) {
        const chatRect = chat.getBoundingClientRect();
        const chatCenterLeft = chatRect.left + chatRect.width / 2;

        let closestMes = null;
        let minDist = Infinity;

        messages.forEach((mes) => {
            const rect = mes.getBoundingClientRect();
            const mesCenterLeft = rect.left + rect.width / 2;
            const dist = Math.abs(mesCenterLeft - chatCenterLeft);
            if (dist < minDist) {
                minDist = dist;
                closestMes = mes;
            }
        });

        if (closestMes) {
            console.log('[TwT HtmlPopup] 阅读模式下捕获聚焦消息 ID:', closestMes.getAttribute('mesid') || closestMes.id);
            return closestMes;
        }
    }

    const winH = getWin().innerHeight;
    let targetMes = null;
    let minCenterDiff = Infinity;

    messages.forEach((mes) => {
        const rect = mes.getBoundingClientRect();
        const mesCenterY = rect.top + rect.height / 2;
        const diff = Math.abs(mesCenterY - winH / 2);
        if (diff < minCenterDiff) {
            minCenterDiff = diff;
            targetMes = mes;
        }
    });

    return targetMes || messages[messages.length - 1];
}

/**
 * 提取指定消息内的所有有效 HTML 应用节点
 */
function getMessageAppElements(mesEl, selector) {
    if (!mesEl) return [];
    return Array.from(mesEl.querySelectorAll(selector)).filter(
        el => !el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')
    );
}

/**
 * 回退寻找前几楼包含应用的消息
 */
function fallbackToPreviousFloors(focusedMes, selector) {
    const doc = getDoc();
    const allMessages = Array.from(doc.querySelectorAll('#chat .mes'));
    const focusedMesIndex = allMessages.indexOf(focusedMes);

    let targetMes = null;
    let targetAppEls = [];
    let targetMesIndex = -1;

    const startIdx = focusedMesIndex >= 0 ? focusedMesIndex - 1 : allMessages.length - 1;
    for (let i = startIdx; i >= 0; i--) {
        const mes = allMessages[i];
        const matchingInMes = getMessageAppElements(mes, selector);
        if (matchingInMes.length > 0) {
            targetMes = mes;
            targetAppEls = matchingInMes;
            targetMesIndex = i;
            break;
        }
    }

    if (targetAppEls.length === 0) {
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const mes = allMessages[i];
            const matchingInMes = getMessageAppElements(mes, selector);
            if (matchingInMes.length > 0) {
                targetMes = mes;
                targetAppEls = matchingInMes;
                targetMesIndex = i;
                break;
            }
        }
    }

    if (targetAppEls.length > 0 && targetMes) {
        const fallbackMesId = targetMes.getAttribute('mesid') || targetMes.id || '';
        const fallbackMesIndex = targetMes.getAttribute('data-index') || (parseInt(fallbackMesId) + 1) || '';
        const diffFloors = (focusedMesIndex >= 0 && targetMesIndex >= 0) ? Math.abs(focusedMesIndex - targetMesIndex) : 1;

        console.log(`[TwT HtmlPopup] 定位跨楼层应用消息 (#${fallbackMesIndex})，相差 ${diffFloors} 层`);
        openHtmlAppModal(targetAppEls, fallbackMesIndex, null, diffFloors);
        return;
    }

    console.warn(`[TwT HtmlPopup] 聊天记录中未找到任何匹配的 HTML 应用 (选择器: ${selector})`);
}

/**
 * 展开 Modal 弹窗（彻底移除黑底与框线，完美顺应 Iframe 真实尺寸自适应）
 */
export function openHtmlAppModal(appEls, mesIndexInfo, initialIndex = null, diffFloors = 0) {
    const doc = getDoc();
    closeHtmlAppModal();
    updateQrBadge(false);

    const appElsList = Array.isArray(appEls) ? appEls : [appEls];
    if (appElsList.length === 0) return;

    let targetIndex = initialIndex !== null ? initialIndex : getSavedAppIndex(mesIndexInfo);
    let currentIndex = Math.max(0, Math.min(targetIndex, appElsList.length - 1));

    console.log(`[TwT HtmlPopup] 准备展开弹窗，共有 ${appElsList.length} 个应用，恢复历史索引: ${currentIndex}，相差楼层: ${diffFloors}`);

    const modal = doc.createElement('div');
    modal.id = MODAL_ID;

    const dialog = doc.createElement('div');
    dialog.className = 'twt-modal-dialog';

    // 恢复持久化记忆的位置
    const savedPos = getSavedPosition();
    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        dialog.style.left = `${savedPos.left}px`;
        dialog.style.top = `${savedPos.top}px`;
        dialog.style.transform = 'none';
    } else {
        dialog.style.left = '50%';
        dialog.style.top = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
    }

    // 头部控制栏
    const header = doc.createElement('div');
    header.className = 'twt-modal-header';

    const dragHandle = doc.createElement('div');
    dragHandle.className = 'twt-modal-drag-handle';
    dragHandle.title = '按住拖拽移动弹窗';

    if (diffFloors > 0) {
        dragHandle.innerHTML = `<i class="fa-solid fa-grip-lines"></i> <span class="twt-modal-floor-badge" title="当前消息无应用，已自动展示前 ${diffFloors} 层的应用">#${mesIndexInfo} (-${diffFloors}层)</span>`;
    } else {
        dragHandle.innerHTML = `<i class="fa-solid fa-grip-lines"></i>`;
    }
    header.appendChild(dragHandle);

    const controls = doc.createElement('div');
    controls.className = 'twt-modal-controls';

    if (appElsList.length > 1) {
        const switcher = doc.createElement('div');
        switcher.className = 'twt-modal-switcher';

        const prevBtn = doc.createElement('button');
        prevBtn.className = 'twt-modal-btn';
        prevBtn.title = '上一个应用';
        prevBtn.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;

        const selectEl = doc.createElement('select');
        selectEl.className = 'twt-modal-select';
        selectEl.title = '下拉选择要查看的 HTML 部件';
        selectEl.onclick = (e) => e.stopPropagation();

        const populateOptions = () => {
            selectEl.innerHTML = '';
            appElsList.forEach((el, idx) => {
                const opt = doc.createElement('option');
                opt.value = String(idx);
                const customTitle = resolveAppTitle(el, idx);
                opt.textContent = `${idx + 1}. ${customTitle}`;
                selectEl.appendChild(opt);
            });
            selectEl.value = String(currentIndex);
        };

        populateOptions();

        selectEl.onchange = (e) => {
            e.stopPropagation();
            currentIndex = parseInt(selectEl.value, 10);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            renderBodyContent();
        };

        prevBtn.onclick = (e) => {
            e.stopPropagation();
            currentIndex = (currentIndex - 1 + appElsList.length) % appElsList.length;
            selectEl.value = String(currentIndex);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            renderBodyContent();
        };

        const nextBtn = doc.createElement('button');
        nextBtn.className = 'twt-modal-btn';
        nextBtn.title = '下一个应用';
        nextBtn.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            currentIndex = (currentIndex + 1) % appElsList.length;
            selectEl.value = String(currentIndex);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            renderBodyContent();
        };

        switcher.appendChild(prevBtn);
        switcher.appendChild(selectEl);
        switcher.appendChild(nextBtn);
        controls.appendChild(switcher);
    }

    // 按钮：刷新
    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'twt-modal-btn';
    refreshBtn.title = '刷新 / 重新渲染';
    refreshBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i>`;
    refreshBtn.onclick = (e) => {
        e.stopPropagation();
        console.log('[TwT HtmlPopup] 刷新弹窗内容...');
        renderBodyContent();
    };

    // 按钮：关闭
    const closeBtn = doc.createElement('button');
    closeBtn.className = 'twt-modal-btn close-btn';
    closeBtn.title = '关闭弹窗 (Esc)';
    closeBtn.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeHtmlAppModal();
    };

    controls.appendChild(refreshBtn);
    controls.appendChild(closeBtn);

    header.appendChild(controls);

    // 绑定拖拽功能
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const startDrag = (clientX, clientY) => {
        isDragging = true;
        startX = clientX;
        startY = clientY;
        const rect = dialog.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        dialog.style.left = `${initialLeft}px`;
        dialog.style.top = `${initialTop}px`;
        dialog.style.transform = 'none';
    };

    const moveDrag = (clientX, clientY) => {
        if (!isDragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const win = getWin();
        const maxLeft = win.innerWidth - 60;
        const maxTop = win.innerHeight - 30;

        const newLeft = Math.max(0, Math.min(maxLeft, initialLeft + dx));
        const newTop = Math.max(0, Math.min(maxTop, initialTop + dy));

        dialog.style.left = `${newLeft}px`;
        dialog.style.top = `${newTop}px`;
    };

    const endDrag = () => {
        if (isDragging) {
            isDragging = false;
            const currentLeft = parseInt(dialog.style.left) || 0;
            const currentTop = parseInt(dialog.style.top) || 0;
            saveSavedPosition(currentLeft, currentTop);
        }
    };

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.twt-modal-btn, .twt-modal-select')) return;
        startDrag(e.clientX, e.clientY);

        const onMouseMove = (moveEv) => moveDrag(moveEv.clientX, moveEv.clientY);
        const onMouseUp = () => {
            endDrag();
            doc.removeEventListener('mousemove', onMouseMove);
            doc.removeEventListener('mouseup', onMouseUp);
        };

        doc.addEventListener('mousemove', onMouseMove);
        doc.addEventListener('mouseup', onMouseUp);
    });

    header.addEventListener('touchstart', (e) => {
        if (e.target.closest('.twt-modal-btn, .twt-modal-select')) return;
        const touch = e.touches[0];
        if (!touch) return;
        startDrag(touch.clientX, touch.clientY);

        const onTouchMove = (moveEv) => {
            const t = moveEv.touches[0];
            if (t) moveDrag(t.clientX, t.clientY);
        };
        const onTouchEnd = () => {
            endDrag();
            doc.removeEventListener('touchmove', onTouchMove);
            doc.removeEventListener('touchend', onTouchEnd);
        };

        doc.addEventListener('touchmove', onTouchMove, { passive: true });
        doc.addEventListener('touchend', onTouchEnd);
    }, { passive: true });

    // 弹窗主体
    const body = doc.createElement('div');
    body.className = 'twt-modal-body';

    function renderBodyContent() {
        returnMovedElementBack();

        body.innerHTML = '';
        const currentAppEl = appElsList[currentIndex];
        if (!currentAppEl) return;

        // 优先从 localStorage 恢复已保存的 HTML 展开/折叠状态
        const savedHtml = localStorage.getItem(`twt_app_saved_html_${mesIndexInfo}_${currentIndex}`);
        if (savedHtml) {
            if (currentAppEl.tagName === 'IFRAME') {
                currentAppEl.srcdoc = savedHtml;
            } else {
                currentAppEl.innerHTML = savedHtml;
            }
        }

        // 创建占位符并实施 DOM 物理移入 (DOM Reparenting)
        const doc = getDoc();
        const placeholder = doc.createElement('div');
        placeholder.className = 'twt-app-placeholder';
        placeholder.style.display = 'none';

        if (currentAppEl.parentNode) {
            currentAppEl.parentNode.insertBefore(placeholder, currentAppEl);
            currentAppEl.__twt_placeholder__ = placeholder;
        }

        currentAppEl.classList.remove('twt-app-hidden');
        currentAppEl.style.display = '';
        currentAppEl.style.visibility = '';
        currentAppEl.style.backgroundColor = 'transparent';

        if (currentAppEl.tagName === 'IFRAME') {
            currentAppEl.setAttribute('allowtransparency', 'true');
            attachIframeStateTracker(currentAppEl, mesIndexInfo, currentIndex);
        } else {
            attachDomStateTracker(currentAppEl, mesIndexInfo, currentIndex);
        }

        const wrapper = doc.createElement('div');
        wrapper.className = 'twt-app-content-wrapper';
        wrapper.appendChild(currentAppEl);
        body.appendChild(wrapper);

        currentlyMovedEl = currentAppEl;

        // 开启精确的物理自适应测算与动态 DOM/Iframe 监听
        observeAppDynamicResizing(currentAppEl, dialog);

        console.log('[TwT HtmlPopup] 真实 DOM 节点及其精确尺寸自适应机制已直接挂载至 Modal');
    }

    renderBodyContent();

    dialog.appendChild(header);
    dialog.appendChild(body);
    modal.appendChild(dialog);

    // Esc 键关闭监听
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeHtmlAppModal();
            doc.removeEventListener('keydown', escHandler);
        }
    };
    doc.addEventListener('keydown', escHandler);

    doc.body.appendChild(modal);
    console.log('[TwT HtmlPopup] Modal 弹窗已展开');
}

/**
 * 关闭 Modal 弹窗（物理归还真实 DOM 节点）
 */
export function closeHtmlAppModal() {
    returnMovedElementBack();

    const doc = getDoc();
    const old = doc.getElementById(MODAL_ID);
    if (old) {
        old.remove();
        console.log('[TwT HtmlPopup] Modal 弹窗已关闭，真实 DOM 已归位');
    }
}

/**
 * 处理 QR 栏按钮点击召出逻辑 (防竞态智能等待版)
 */
function handleQrBtnClick() {
    console.log('[TwT HtmlPopup] 点击了 QR 栏 HTML 应用召出按钮');
    updateQrBadge(false);

    const settings = extension_settings?.twt;
    const selector = settings?.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';

    const focusedMes = getCurrentFocusedMessage();
    if (!focusedMes) return;

    const mesId = focusedMes.getAttribute('mesid') || focusedMes.id || '';
    const mesIndex = focusedMes.getAttribute('data-index') || (parseInt(mesId) + 1) || '';

    // 1. 尝试直接获取已渲染完成的应用节点
    let appEls = getMessageAppElements(focusedMes, selector);

    if (appEls.length > 0) {
        console.log(`[TwT HtmlPopup] 提取到聚焦消息 (#${mesIndex}) 中的 ${appEls.length} 个应用节点`);
        openHtmlAppModal(appEls, mesIndex, null, 0);
        return;
    }

    // 2. 防竞态处理：检测文本是否包含待渲染的代码/标签，若有则开启毫秒级轻量智能等待
    const rawText = focusedMes.textContent || '';
    const hasUnrenderedCode = rawText.includes('<iframe') || rawText.includes('```html') || rawText.includes('```xml') || rawText.includes('data-app');

    if (hasUnrenderedCode) {
        console.log(`[TwT HtmlPopup] [防竞态开启] 检测到未完成渲染的标签，智能等待前置插件渲染...`);
        let retries = 0;
        const maxRetries = 10;

        const pollCheck = () => {
            appEls = getMessageAppElements(focusedMes, selector);
            if (appEls.length > 0) {
                console.log(`[TwT HtmlPopup] [防竞态成功] 前置插件渲染完成，已于 ${retries * 100}ms 内捕获应用节点`);
                hideMessageHtmlApps();
                openHtmlAppModal(appEls, mesIndex, null, 0);
                return;
            }
            retries++;
            if (retries < maxRetries) {
                setTimeout(pollCheck, 100);
            } else {
                fallbackToPreviousFloors(focusedMes, selector);
            }
        };

        setTimeout(pollCheck, 50);
        return;
    }

    // 3. 当前消息无待渲染代码，正常回退寻找前几楼
    fallbackToPreviousFloors(focusedMes, selector);
}

/**
 * 监听酒馆全套生命周期事件，实现即时响应与弹窗自动刷新
 */
export function registerHtmlPopupEvents(context) {
    if (!context || !context.eventSource || !context.eventTypes) return;

    const { eventSource, eventTypes } = context;

    const onChatResetOrSwitched = (reason) => {
        console.log(`[TwT HtmlPopup] [对话状态重置] 原因: ${reason}`);
        closeHtmlAppModal();
        updateQrBadge(false);

        hideMessageHtmlApps();
        setTimeout(hideMessageHtmlApps, 100);
        setTimeout(hideMessageHtmlApps, 350);
        setTimeout(hideMessageHtmlApps, 800);
    };

    const onMessageChangedOrSwiped = (mesId) => {
        console.log(`[TwT HtmlPopup] [即时响应] 捕获到消息重roll / Swipe / 更新事件 (mesId: ${mesId})`);

        returnMovedElementBack();

        hideMessageHtmlApps();
        setTimeout(hideMessageHtmlApps, 100);
        setTimeout(hideMessageHtmlApps, 350);

        const doc = getDoc();
        const modal = doc.getElementById(MODAL_ID);
        if (modal) {
            setTimeout(() => {
                const focusedMes = getCurrentFocusedMessage();
                if (focusedMes) {
                    const settings = extension_settings?.twt;
                    const selector = settings?.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';
                    const newAppEls = getMessageAppElements(focusedMes, selector);
                    if (newAppEls.length > 0) {
                        const mId = focusedMes.getAttribute('mesid') || focusedMes.id || '';
                        const mIndex = focusedMes.getAttribute('data-index') || (parseInt(mId) + 1) || '';
                        console.log(`[TwT HtmlPopup] [自动刷新] 实时加载 Swipe/重roll 后的新 Iframe 应用 (Index: #${mIndex})`);
                        openHtmlAppModal(newAppEls, mIndex, 0);
                    }
                }
            }, 180);
        }
    };

    if (eventTypes.MESSAGE_SWIPED) eventSource.on(eventTypes.MESSAGE_SWIPED, onMessageChangedOrSwiped);
    if (eventTypes.MESSAGE_UPDATED) eventSource.on(eventTypes.MESSAGE_UPDATED, onMessageChangedOrSwiped);
    if (eventTypes.CHARACTER_MESSAGE_RENDERED) eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, onMessageChangedOrSwiped);

    if (eventTypes.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, () => onChatResetOrSwitched('CHAT_CHANGED'));
    if (eventTypes.MORE_MESSAGES_LOADED) eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => onChatResetOrSwitched('MORE_MESSAGES_LOADED'));
    if (eventTypes.MESSAGE_DELETED) eventSource.on(eventTypes.MESSAGE_DELETED, () => onChatResetOrSwitched('MESSAGE_DELETED'));
}

/**
 * 注入与更新 QR 栏按钮
 */
export function applyHtmlPopupSettings() {
    injectStyles();
    const settings = extension_settings?.twt;
    const enabled = settings?.htmlPopupEnabled !== false;
    const doc = getDoc();

    let btn = doc.getElementById(QR_BTN_ID);
    if (enabled) {
        if (!btn) {
            btn = doc.createElement('div');
            btn.id = QR_BTN_ID;
            btn.className = 'qr--button menu_button interactable';
            btn.tabIndex = 0;
            btn.role = 'button';
            btn.title = '召出当前消息 HTML 应用';
            btn.innerHTML = `<i class="fa-solid fa-window-maximize"></i><span class="twt-qr-badge"></span>`;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleQrBtnClick();
            });

            const btnContainer = doc.querySelector('#qr--bar .qr--buttons') || doc.getElementById('qr--bar');
            if (btnContainer) {
                btnContainer.prepend(btn);
                console.log('[TwT HtmlPopup] 成功注入 QR 栏召出按钮（含未读高亮主题色点提示）');
            } else {
                console.warn('[TwT HtmlPopup] 未能找到 #qr--bar 容器，稍后重试注入');
            }
        }
        if (hasUnreadApp) {
            btn.classList.add('has-unread');
        }
        hideMessageHtmlApps();
    } else {
        if (btn) {
            btn.remove();
            console.log('[TwT HtmlPopup] 功能已禁用，已移除 QR 栏按钮');
        }
        doc.querySelectorAll('.twt-app-hidden').forEach(el => el.classList.remove('twt-app-hidden'));
    }
}

/**
 * 初始化 HTML Popup 模块
 */
export function initHtmlPopup() {
    console.log('[TwT HtmlPopup] 正在初始化 HTML 应用弹窗模块...');
    injectStyles();

    const doc = getDoc();
    const win = getWin();
    const MutationObserverClass = win.MutationObserver || win.parent?.MutationObserver || window.MutationObserver;

    const observer = new MutationObserverClass(() => {
        if (doc.querySelector('#qr--bar')) {
            applyHtmlPopupSettings();
        }
    });

    observer.observe(doc.body, { childList: true, subtree: true });

    setTimeout(applyHtmlPopupSettings, 1000);
}
