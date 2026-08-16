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
let activeMsgListenerCleanup = null; // iframe postMessage 监听器的清理函数

function stopAppResizeObserver() {
    if (activeResizeObserver) {
        if (typeof activeResizeObserver.disconnect === 'function') {
            activeResizeObserver.disconnect();
        }
        activeResizeObserver = null;
    }
    if (activeIframeObserver) {
        activeIframeObserver.disconnect();
        activeIframeObserver = null;
    }
    // 清理 iframe postMessage 监听器
    if (activeMsgListenerCleanup) {
        activeMsgListenerCleanup();
        activeMsgListenerCleanup = null;
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
            keys.sort(); // 按字典序排序后删除前段，尽量保留较新的键
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
    // 先原子性清空全局引用，防止并发调用（ESC + swipe 同时触发）造成双重归位竞态
    const el = currentlyMovedEl;
    currentlyMovedEl = null;
    if (!el) return;

    const ph = el.__twt_placeholder__;
    if (ph) delete el.__twt_placeholder__;

    if (ph && ph.parentNode && getDoc().body.contains(ph)) {
        // 正常路径：占位符仍在文档树中，将应用节点插回原位
        ph.parentNode.insertBefore(el, ph);
        ph.remove();
    } else if (el.parentNode) {
        // 竞态路径：占位符已随 Swipe/重构重建的 DOM 消失，安全移除避免孤立节点泄漏
        el.parentNode.removeChild(el);
        console.log('[TwT HtmlPopup] 占位节点已消失，应用节点已从当前父节点安全移除（防泄漏）');
    }
    el.classList.add('twt-app-hidden');
    el.style.display = '';
    el.style.visibility = '';
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
 * 向 iframe 注入尺寸监听脚本（非侵入式）
 * 利用 ResizeObserver 监听 documentElement 尺寸变化，通过 postMessage 把真实宽高推给父窗口
 * 完全无副作用 —— 不修改 iframe 内任何样式，不触发重排
 */
const IFRAME_RESIZE_MSG = 'twt-iframe-resize';
const INJECTED_SCRIPT_ATTR = 'data-twt-resize-injected';

function injectIframeResizeScript(iframeEl) {
    if (iframeEl.getAttribute(INJECTED_SCRIPT_ATTR)) return; // 防重复注入
    try {
        const iDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
        if (!iDoc || !iDoc.body) return;

        const script = iDoc.createElement('script');
        script.textContent = `
(function() {
    if (window.__twt_resize_injected__) return;
    window.__twt_resize_injected__ = true;
    var sendSize = function() {
        var w = Math.max(
            document.documentElement.scrollWidth,
            document.documentElement.offsetWidth,
            document.body ? document.body.scrollWidth : 0,
            document.body ? document.body.offsetWidth : 0
        );
        var h = Math.max(
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight,
            document.body ? document.body.scrollHeight : 0,
            document.body ? document.body.offsetHeight : 0
        );
        try { window.parent.postMessage({ type: '${IFRAME_RESIZE_MSG}', w: w, h: h, src: location.href }, '*'); } catch(e) {}
    };
    if (window.ResizeObserver) {
        var ro = new ResizeObserver(function() { sendSize(); });
        ro.observe(document.documentElement);
        if (document.body) ro.observe(document.body);
    } else {
        // 降级：定时轮询
        setInterval(sendSize, 400);
    }
    sendSize();
})();
        `;
        iDoc.head ? iDoc.head.appendChild(script) : iDoc.body.appendChild(script);
        iframeEl.setAttribute(INJECTED_SCRIPT_ATTR, '1');
        console.log('[TwT HtmlPopup] [非侵入式] iframe 尺寸监听脚本注入成功');
    } catch (e) {
        // 跨域 iframe 无法注入，降级处理
        console.warn('[TwT HtmlPopup] [跨域降级] 无法注入监听脚本，将使用 scrollSize 测量:', e.message);
    }
}

/**
 * 降级方案：跨域 / 永远无法注入脚本时，用 scrollWidth/scrollHeight 直接测量
 * 注意：不修改 body 样式，废弃原有的侵入式测量逻辑
 */
function measureIframeFallback(iframeEl, dialogEl) {
    if (!iframeEl || iframeEl.tagName !== 'IFRAME') return;
    try {
        const iDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
        if (!iDoc || !iDoc.body) return;

        // 直接读取 scrollWidth/scrollHeight，不改任何样式
        const realWidth = Math.max(
            iDoc.documentElement.scrollWidth,
            iDoc.documentElement.offsetWidth,
            iDoc.body.scrollWidth,
            iDoc.body.offsetWidth
        );
        const realHeight = Math.max(
            iDoc.documentElement.scrollHeight,
            iDoc.documentElement.offsetHeight,
            iDoc.body.scrollHeight,
            iDoc.body.offsetHeight
        );

        applyIframeSize(iframeEl, dialogEl, realWidth, realHeight);
    } catch (e) {
        // 跨域无法读取，静默失败
    }
}

/**
 * 将测量到的宽高应用到 iframe 和对话框
 */
function applyIframeSize(iframeEl, dialogEl, realWidth, realHeight) {
    const win = getWin();
    const maxW = win.innerWidth * 0.96;
    const maxH = win.innerHeight * 0.92;

    if (realWidth > 40 && realWidth < maxW) {
        const finalW = Math.ceil(realWidth);
        if (iframeEl.style.width !== `${finalW}px`) {
            iframeEl.style.width = `${finalW}px`;
            if (dialogEl) dialogEl.style.width = `${finalW}px`;
        }
    }
    if (realHeight > 30) {
        const finalH = Math.min(Math.ceil(realHeight), maxH);
        if (iframeEl.style.height !== `${finalH}px`) {
            iframeEl.style.height = `${finalH}px`;
        }
    }
}


/**
 * 实时监测并响应 Iframe / DOM 内部尺寸变化，自适应动态调整
 * 核心架构：非侵入 postMessage 方案，不修改 iframe 内任何样式
 */
function observeAppDynamicResizing(appEl, dialogEl) {
    stopAppResizeObserver();
    const win = getWin();

    if (appEl.tagName !== 'IFRAME') {
        // 普通 DOM 元素：用 ResizeObserver 监听自身尺寸
        const updateDomBounds = () => {
            if (!appEl || !dialogEl) return;
            try {
                const innerNode = appEl.firstElementChild || appEl;
                const rect = innerNode.getBoundingClientRect();
                const curW = rect.width || appEl.offsetWidth;
                if (curW > 50 && curW < win.innerWidth * 0.98) {
                    dialogEl.style.width = `${Math.ceil(curW)}px`;
                    appEl.style.width = '100%';
                }
            } catch (e) {}
        };
        updateDomBounds();
        if (window.ResizeObserver) {
            activeResizeObserver = new ResizeObserver(() => requestAnimationFrame(updateDomBounds));
            activeResizeObserver.observe(appEl);
            if (appEl.firstElementChild) activeResizeObserver.observe(appEl.firstElementChild);
        }
        return;
    }

    // ===== iframe 専用路径 =====
    // 创建一个唯一 ID 用于识别本 iframe 发来的 postMessage
    const iframeId = `twt-iframe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    appEl.setAttribute('data-twt-iframe-id', iframeId);

    // 监听父窗口的 postMessage
    let msgListener = null;
    const startMsgListener = () => {
        if (msgListener) return;
        msgListener = (ev) => {
            if (!ev.data || ev.data.type !== IFRAME_RESIZE_MSG) return;
            // 验证来源：必须是当前展示的 iframe
            if (appEl.getAttribute('data-twt-iframe-id') !== iframeId) {
                // 当前 iframe 已经不是活跃状态，移除监听器
                win.removeEventListener('message', msgListener);
                msgListener = null;
                return;
            }
            const { w, h } = ev.data;
            if (w > 0 && h > 0) {
                applyIframeSize(appEl, dialogEl, w, h);
            }
        };
        win.addEventListener('message', msgListener);
        // 将清理逆转到全局可询位置
        activeMsgListenerCleanup = () => {
            if (msgListener) {
                win.removeEventListener('message', msgListener);
                msgListener = null;
            }
            appEl.removeAttribute('data-twt-iframe-id');
        };
    };



    const tryInjectAndListen = () => {
        injectIframeResizeScript(appEl);
        startMsgListener();
        // 尝试注入后立即也进行一次降级测量作为初始尺寸基准
        measureIframeFallback(appEl, dialogEl);
    };

    appEl.addEventListener('load', () => {
        // iframe 重新加载后需重新注入（原有脚本随文档消失）
        appEl.removeAttribute(INJECTED_SCRIPT_ATTR);
        tryInjectAndListen();
        // 同时在 iframe 内部的 window 监听 resize 事件（内部布局变化时）
        try {
            const iWin = appEl.contentWindow;
            if (iWin) {
                iWin.addEventListener('resize', () => measureIframeFallback(appEl, dialogEl));
            }
        } catch (e) { /* 跨域无法监听，忽略 */ }
    });

    tryInjectAndListen();
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
                    // ✂️ 已移除 iframeEl.srcdoc = fullHtml
                    // 该赋值会触发 iframe reload → load 事件 → tryBind 重复注册监听器
                    // 形成指数级堆积：每次交互后监听器数量 ×4
                    cleanOldAppHtmlStates();
                    localStorage.setItem(`twt_app_saved_html_${mesIndexInfo}_${appIndex}`, fullHtml);
                    console.log(`[TwT HtmlPopup] 防抖保存 Iframe 展开状态 (Msg #${mesIndexInfo}, App #${appIndex})`);
                }
            }
        } catch (e) {
            console.warn('[TwT HtmlPopup] 无法跨域或读取 Iframe 内部 Document:', e);
        }
    };

    const debouncedSave = debounce(rawSave, 300);
    let boundDoc = null; // 追踪已绑定监听器的 document，防止 iframe reload 后重复注册

    const tryBind = () => {
        try {
            const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            if (doc && doc !== boundDoc) {
                // 先解绑旧 document 上的监听器（iframe reload 后 contentDocument 会变化）
                if (boundDoc) {
                    try {
                        boundDoc.removeEventListener('click', debouncedSave, true);
                        boundDoc.removeEventListener('toggle', debouncedSave, true);
                        boundDoc.removeEventListener('change', debouncedSave, true);
                        boundDoc.removeEventListener('input', debouncedSave, true);
                    } catch (e) { /* 旧 doc 已失效，忽略 */ }
                }
                doc.addEventListener('click', debouncedSave, true);
                doc.addEventListener('toggle', debouncedSave, true);
                doc.addEventListener('change', debouncedSave, true);
                doc.addEventListener('input', debouncedSave, true);
                boundDoc = doc;
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
 * 样式注入 (彻底消除黑底、无框线、纯透明顶栏，包含平滑过渡手风琴动画)
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

        /* QR 栏按钮与左上角高亮纯色静止圆点 */
        #twt-qr-html-app-btn {
            position: relative;
        }

        #twt-qr-html-app-btn .twt-qr-badge {
            display: none;
            position: absolute;
            top: 2px;
            left: 2px;
            width: 6px;
            height: 6px;
            background-color: var(--SmartThemeQuoteColor, #f38ba8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 2;
        }

        #twt-qr-html-app-btn.has-unread .twt-qr-badge {
            display: block;
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
            box-sizing: border-box;
            transition: width 0.22s cubic-bezier(0.2, 0, 0.2, 1), height 0.22s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.15s ease-out;
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
            transition: width 0.22s cubic-bezier(0.2, 0, 0.2, 1), height 0.22s cubic-bezier(0.2, 0, 0.2, 1);
        }

        .twt-modal-body > .twt-app-content-wrapper {
            width: fit-content !important;
            height: fit-content !important;
            box-sizing: border-box;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            transition: width 0.22s cubic-bezier(0.2, 0, 0.2, 1), height 0.22s cubic-bezier(0.2, 0, 0.2, 1);
        }
    `;
}

/**
 * 提取并隐藏正文中的匹配元素
 */
let hideScheduled = false;

export function hideMessageHtmlApps(forceHide = false) {
    const settings = extension_settings?.twt;
    if (!settings || settings.htmlPopupEnabled === false) return;

    // 流式输出中且用户设置了不在生成时隐藏，跳过（避免 AI 生成时 iframe 闪烁消失）
    if (!forceHide && settings.htmlPopupHideInStream === false) {
        const doc = getDoc();
        if (doc.body.classList.contains('is_send_press') ||
            doc.body.classList.contains('mes_stop')) return;
    }

    if (hideScheduled) return;
    hideScheduled = true;

    requestAnimationFrame(() => {
        hideScheduled = false;
        const selector = settings.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';
        const doc = getDoc();
        const chat = doc.getElementById('chat');
        if (!chat) return;

        const modal = doc.getElementById(MODAL_ID);

        try {
            const matchingElements = chat.querySelectorAll(`.mes_text ${selector}`);
            let count = 0;

            matchingElements.forEach((el) => {
                if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return;
                if (currentlyMovedEl === el) return;
                if (modal && modal.contains(el)) return; // modal 内的活跃节点不隐藏

                if (!el.classList.contains('twt-app-hidden')) {
                    el.classList.add('twt-app-hidden');
                    count++;
                }
            });

            if (count > 0) {
                console.log(`[TwT HtmlPopup] [性能优化] 增量隐藏了 ${count} 个匹配选择器 [${selector}] 的 HTML 应用节点`);
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
        // 翻页模式下用 scrollLeft 计算当前列，再按展示列重叠面积找最匹配的消息
        // 比原中心点距离算法更准确，解决跨列消息被错误选中的问题
        const colW = chat.offsetWidth || 1;
        const currentPage = Math.round(chat.scrollLeft / colW);
        const viewLeft = currentPage * colW;
        const viewRight = viewLeft + colW;
        const chatBoundLeft = chat.getBoundingClientRect().left;

        let bestMes = null;
        let bestOverlap = -1;

        messages.forEach((mes) => {
            // 跳过 display:none 的消息（getBoundingClientRect 全零干扰计算）
            if (getComputedStyle(mes).display === 'none') return;
            const rect = mes.getBoundingClientRect();
            // 将屏幕坐标转换为 chat 内部滚动坐标
            const mesScrollLeft = chat.scrollLeft + rect.left - chatBoundLeft;
            const mesScrollRight = mesScrollLeft + rect.width;
            const overlap = Math.max(0, Math.min(mesScrollRight, viewRight) - Math.max(mesScrollLeft, viewLeft));
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestMes = mes;
            }
        });

        if (bestMes) {
            console.log('[TwT HtmlPopup] 翻页模式下捕获聚焦消息（列重叠检测）ID:', bestMes.getAttribute('mesid') || bestMes.id);
            return bestMes;
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
            const currentLeft = parseFloat(dialog.style.left) || 0;
            const currentTop = parseFloat(dialog.style.top) || 0;
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

    // 2. 防竞态处理：检测 .mes_text 的 innerHTML 是否存在未被渲染的代码块且实际尚无匹配应用节点
    const mesTextEl = focusedMes.querySelector('.mes_text');
    const rawHtml = mesTextEl ? mesTextEl.innerHTML : '';
    // innerHTML 中的展开了的 html/xml 语言代码块，且实际还没有匹配的应用 DOM 节点
    const hasUnrenderedCode = (
        (rawHtml.includes('language-html') || rawHtml.includes('language-xml') || rawHtml.includes('language-iframe')) &&
        !focusedMes.querySelector(selector)
    ) || (
        // 或者 innerHTML 中包含转义的 &lt;iframe（未被渲染为真实 iframe 元素）
        rawHtml.includes('&lt;iframe') && !focusedMes.querySelector('iframe')
    );

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
                        openHtmlAppModal(newAppEls, mIndex, null, 0);
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
                console.log('[TwT HtmlPopup] 成功注入 QR 栏召出按钮（含平滑过渡动画与提示点）');
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

    // 如果 #qr--bar 已经存在，直接注入，无需创建 Observer
    if (doc.querySelector('#qr--bar')) {
        applyHtmlPopupSettings();
        setTimeout(applyHtmlPopupSettings, 1000); // 兆底保证状态同步
        return;
    }

    // #qr--bar 尚未出现，监听等待；注入成功后立即 disconnect，防止内存泄漏
    let initObserver = null;
    initObserver = new MutationObserverClass(() => {
        if (doc.querySelector('#qr--bar')) {
            // 先 disconnect，再注入：防止 applyHtmlPopupSettings 注入 style 节点时再次触发 observer
            initObserver.disconnect();
            initObserver = null;
            console.log('[TwT HtmlPopup] 检测到 #qr--bar，初始化 Observer 已断开');
            applyHtmlPopupSettings();
        }
    });
    initObserver.observe(doc.body, { childList: true, subtree: true });

    // 1s 兆底：强制注入并确保 Observer 已断开
    setTimeout(() => {
        if (initObserver) {
            initObserver.disconnect();
            initObserver = null;
        }
        applyHtmlPopupSettings();
    }, 1000);
}
