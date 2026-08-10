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

/**
 * 获取默认设置
 */
export function getHtmlPopupDefaultSettings() {
    return {
        htmlPopupEnabled: true,
        htmlPopupSelector: 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app',
        htmlPopupHideInStream: true,
    };
}

/**
 * 样式注入（确保在正文中隐藏 DOM，在 Modal 中原样高层级展现）
 */
function injectStyles() {
    const doc = getDoc();
    if (doc.getElementById('twt-html-popup-style')) return;

    const style = doc.createElement('style');
    style.id = 'twt-html-popup-style';
    style.textContent = `
        /* 正文中隐藏应用 DOM 节点 */
        .twt-app-hidden {
            display: none !important;
        }

        /* 弹窗遮罩与容器 */
        #twt-html-app-modal {
            position: fixed;
            left: 0;
            top: 0;
            width: 100vw;
            height: 100vh;
            z-index: 999999;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            animation: twtFadeIn 0.2s ease-out;
            box-sizing: border-box;
            padding: 20px;
        }

        @keyframes twtFadeIn {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
        }

        .twt-modal-dialog {
            width: 90vw;
            height: 88vh;
            max-width: 1400px;
            max-height: 900px;
            background: var(--SmartThemeBlurBg, #1e1e2e);
            color: var(--SmartThemeBodyColor, #cdd6f4);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .twt-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: rgba(0, 0, 0, 0.25);
            border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            font-size: 14px;
            font-weight: 600;
            user-select: none;
        }

        .twt-modal-title {
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .twt-modal-controls {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .twt-modal-btn {
            background: transparent;
            border: none;
            color: currentColor;
            opacity: 0.75;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            transition: all 0.15s ease;
        }

        .twt-modal-btn:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.1);
        }

        .twt-modal-btn.close-btn:hover {
            background: #f38ba8;
            color: #11111b;
        }

        .twt-modal-body {
            flex: 1;
            width: 100%;
            height: 100%;
            overflow: auto;
            position: relative;
            background: #ffffff; /* 兼容默认白底 HTML 应用 */
            border-bottom-left-radius: 11px;
            border-bottom-right-radius: 11px;
        }

        .twt-modal-body > iframe {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
        }

        .twt-modal-body > .twt-app-content-wrapper {
            width: 100%;
            height: 100%;
            box-sizing: border-box;
        }
    `;
    doc.head.appendChild(style);
    console.log('[TwT HtmlPopup] 样式依赖已注入');
}

/**
 * 提取并隐藏正文中的匹配元素
 */
export function hideMessageHtmlApps() {
    const settings = extension_settings?.twt;
    if (!settings || settings.htmlPopupEnabled === false) return;

    const selector = settings.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    if (!chat) return;

    try {
        const matchingElements = chat.querySelectorAll(`.mes_text ${selector}`);
        let count = 0;

        matchingElements.forEach((el) => {
            // 跳过思维链中的内容
            if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return;

            if (!el.classList.contains('twt-app-hidden')) {
                el.classList.add('twt-app-hidden');
                count++;
            }
        });

        if (count > 0) {
            console.log(`[TwT HtmlPopup] 已成功在正文中隐藏 ${count} 个匹配选择器 [${selector}] 的 HTML 应用节点`);
        }
    } catch (err) {
        console.error(`[TwT HtmlPopup] 隐藏匹配元素失败，请检查 Selector 选择器语法是否合法 [${selector}]:`, err);
    }
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

    // 如果处于阅读模式，计算 scrollLeft 定位当前页消息
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

    // 经典纵向模式下，捕获可视区域中间的消息
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
 * 展开 HTML 应用 Modal 弹窗
 */
export function openHtmlAppModal(appEl, mesIndexInfo) {
    const doc = getDoc();
    closeHtmlAppModal(); // 先清理已存在的 Modal

    console.log('[TwT HtmlPopup] 正在准备弹窗渲染目标元素:', appEl);

    const modal = doc.createElement('div');
    modal.id = MODAL_ID;

    const dialog = doc.createElement('div');
    dialog.className = 'twt-modal-dialog';

    // 头部控制栏
    const header = doc.createElement('div');
    header.className = 'twt-modal-header';

    const title = doc.createElement('div');
    title.className = 'twt-modal-title';
    title.innerHTML = `<i class="fa-solid fa-window-maximize"></i> <span>HTML 应用 ${mesIndexInfo ? `(消息 #${mesIndexInfo})` : ''}</span>`;

    const controls = doc.createElement('div');
    controls.className = 'twt-modal-controls';

    // 按钮：刷新
    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'twt-modal-btn';
    refreshBtn.title = '刷新 / 重新渲染';
    refreshBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i>`;
    refreshBtn.onclick = () => {
        console.log('[TwT HtmlPopup] 刷新弹窗内容...');
        if (appEl.tagName === 'IFRAME' && appEl.src) {
            appEl.src = appEl.src;
        } else {
            renderBodyContent();
        }
    };

    // 按钮：新窗口打开
    const openNewBtn = doc.createElement('button');
    openNewBtn.className = 'twt-modal-btn';
    openNewBtn.title = '在新标签页/新窗口打开';
    openNewBtn.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i>`;
    openNewBtn.onclick = () => {
        try {
            if (appEl.tagName === 'IFRAME' && appEl.src) {
                getWin().open(appEl.src, '_blank');
            } else {
                const newWin = getWin().open('', '_blank');
                newWin.document.write(appEl.outerHTML || appEl.innerHTML);
                newWin.document.close();
            }
        } catch (e) {
            console.error('[TwT HtmlPopup] 新窗口打开失败:', e);
        }
    };

    // 按钮：关闭
    const closeBtn = doc.createElement('button');
    closeBtn.className = 'twt-modal-btn close-btn';
    closeBtn.title = '关闭弹窗 (Esc)';
    closeBtn.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
    closeBtn.onclick = closeHtmlAppModal;

    controls.appendChild(refreshBtn);
    controls.appendChild(openNewBtn);
    controls.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(controls);

    // 弹窗主体
    const body = doc.createElement('div');
    body.className = 'twt-modal-body';

    function renderBodyContent() {
        body.innerHTML = '';
        // 克隆节点并在 modal 中移除隐藏 class
        const clone = appEl.cloneNode(true);
        clone.classList.remove('twt-app-hidden');
        if (clone.style) {
            clone.style.display = '';
            clone.style.visibility = '';
        }

        // 如果是克隆 iframe，处理 srcdoc / src 重新绑定
        if (clone.tagName === 'IFRAME') {
            if (appEl.srcdoc) clone.srcdoc = appEl.srcdoc;
            if (appEl.src) clone.src = appEl.src;
        }

        const wrapper = doc.createElement('div');
        wrapper.className = 'twt-app-content-wrapper';
        wrapper.appendChild(clone);
        body.appendChild(wrapper);
    }

    renderBodyContent();

    dialog.appendChild(header);
    dialog.appendChild(body);
    modal.appendChild(dialog);

    // 点击背景关闭
    modal.onclick = (e) => {
        if (e.target === modal) closeHtmlAppModal();
    };

    // Esc 键关闭监听
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeHtmlAppModal();
            doc.removeEventListener('keydown', escHandler);
        }
    };
    doc.addEventListener('keydown', escHandler);

    doc.body.appendChild(modal);
    console.log('[TwT HtmlPopup] Modal 弹窗显示成功');
}

/**
 * 关闭 Modal 弹窗
 */
export function closeHtmlAppModal() {
    const doc = getDoc();
    const old = doc.getElementById(MODAL_ID);
    if (old) {
        old.remove();
        console.log('[TwT HtmlPopup] Modal 弹窗已关闭');
    }
}

/**
 * 处理 QR 栏按钮点击召出逻辑
 */
function handleQrBtnClick() {
    console.log('[TwT HtmlPopup] 点击了 QR 栏 HTML 应用召出按钮');
    const settings = extension_settings?.twt;
    const selector = settings?.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';

    const focusedMes = getCurrentFocusedMessage();
    if (!focusedMes) {
        console.warn('[TwT HtmlPopup] 当前未捕获到任何消息节点');
        if (typeof toastr !== 'undefined') toastr.info('未找到任何消息节点');
        return;
    }

    const mesId = focusedMes.getAttribute('mesid') || focusedMes.id || '';
    const mesIndex = focusedMes.getAttribute('data-index') || (parseInt(mesId) + 1) || '';

    // 在聚焦消息中寻找匹配的元素
    let appEl = focusedMes.querySelector(selector);

    if (!appEl) {
        console.warn(`[TwT HtmlPopup] 当前聚焦消息 (Index: ${mesIndex}) 内未包含匹配选择器 [${selector}] 的应用节点`);

        // 回退机制：在聊天中全局寻找【最新一条】带有应用的消息
        const doc = getDoc();
        const allAppEls = Array.from(doc.querySelectorAll(`#chat .mes_text ${selector}`));

        if (allAppEls.length > 0) {
            const latestAppEl = allAppEls[allAppEls.length - 1];
            const parentMes = latestAppEl.closest('.mes');
            const fallbackMesIndex = parentMes ? (parentMes.getAttribute('mesid') || parentMes.getAttribute('data-index') || '') : '';
            console.log(`[TwT HtmlPopup] 自动触发回退，展示对话中最新一条包含应用的消息 (Index: ${fallbackMesIndex})`);
            if (typeof toastr !== 'undefined') {
                toastr.info(`当前消息无应用，已为您自动召出最新消息 (#${fallbackMesIndex}) 中的 HTML 应用`, 'TwT 应用召出', { timeOut: 3000 });
            }
            openHtmlAppModal(latestAppEl, fallbackMesIndex);
            return;
        }

        if (typeof toastr !== 'undefined') {
            toastr.warning(`当前消息中未找到匹配的 HTML 应用 (选择器: ${selector})`, 'TwT 应用召出');
        }
        return;
    }

    console.log(`[TwT HtmlPopup] 成功在聚焦消息 (#${mesIndex}) 中提取到应用节点`);
    openHtmlAppModal(appEl, mesIndex);
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
            btn = doc.createElement('button');
            btn.id = QR_BTN_ID;
            btn.className = 'qr--button menu_button interactable';
            btn.title = '召出当前消息 HTML 应用';
            btn.innerHTML = `<i class="fa-solid fa-window-maximize"></i> 应用`;
            btn.onclick = handleQrBtnClick;

            const btnContainer = doc.querySelector('#qr--bar .qr--buttons') || doc.getElementById('qr--bar');
            if (btnContainer) {
                btnContainer.prepend(btn);
                console.log('[TwT HtmlPopup] 成功注入 QR 栏召出按钮');
            } else {
                console.warn('[TwT HtmlPopup] 未能找到 #qr--bar 容器，稍后重试注入');
            }
        }
        hideMessageHtmlApps();
    } else {
        if (btn) {
            btn.remove();
            console.log('[TwT HtmlPopup] 功能已禁用，已移除 QR 栏按钮');
        }
        // 恢复隐藏的 DOM 节点
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

    // 实时监听聊天框与 DOM 变化，自动隐藏新流式输出的应用节点
    const observer = new MutationObserverClass(() => {
        if (doc.querySelector('#qr--bar')) {
            applyHtmlPopupSettings();
        }
    });

    observer.observe(doc.body, { childList: true, subtree: true });

    setTimeout(applyHtmlPopupSettings, 1000);
}
