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
 * 读取与保存消息关联的已选应用索引 (Persistence for last viewed HTML widget)
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
 * 样式注入（完全无框线、纯透明背景、多应用箭头+下拉框双切换、支持拖拽）
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
            width: max-content;
            height: fit-content;
            max-width: 98vw;
            max-height: 98vh;
            background: transparent !important; /* 纯透明无框 */
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
            padding: 4px 10px;
            background: rgba(20, 20, 32, 0.88); /* 简约半透明顶栏 */
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: none !important;
            outline: none !important;
            border-radius: 8px 8px 0 0;
            color: #cdd6f4;
            font-size: 12px;
            font-weight: 500;
            user-select: none;
            cursor: move; /* 拖拽手势 */
            width: 100%;
            box-sizing: border-box;
        }

        .twt-modal-title {
            display: flex;
            align-items: center;
            gap: 6px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 55%;
        }

        .twt-modal-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .twt-modal-switcher {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-right: 6px;
            padding-right: 6px;
            border-right: 1px solid rgba(255, 255, 255, 0.15);
            font-size: 11px;
            opacity: 0.95;
        }

        .twt-modal-select {
            background: rgba(30, 30, 46, 0.9);
            color: #cdd6f4;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 11px;
            cursor: pointer;
            outline: none;
            max-width: 150px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .twt-modal-select:hover {
            border-color: rgba(255, 255, 255, 0.4);
            background: rgba(45, 45, 65, 0.95);
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
            opacity: 0.75;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            transition: all 0.15s ease;
        }

        .twt-modal-btn:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.15);
        }

        .twt-modal-btn.close-btn:hover {
            background: #f38ba8;
            color: #11111b;
        }

        .twt-modal-body {
            width: 100%;
            height: fit-content;
            max-width: 98vw;
            max-height: 95vh;
            overflow: auto;
            position: relative;
            background: transparent !important; /* 无框无白底 */
            border: none !important;
            outline: none !important;
            border-radius: 0 0 8px 8px;
            box-sizing: border-box;
        }

        .twt-modal-body > iframe {
            border: none !important;
            outline: none !important;
            display: block;
            background: transparent !important;
        }

        .twt-modal-body > .twt-app-content-wrapper {
            width: fit-content;
            height: fit-content;
            box-sizing: border-box;
            background: transparent !important;
            border: none !important;
            outline: none !important;
        }
    `;
    console.log('[TwT HtmlPopup] 样式依赖已更新（支持箭头+下拉框多组件双重切换）');
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
 * 展开支持多应用无缝切换（箭头+下拉框）、尺寸完全贴合小部件、支持上次阅读组件持久化记忆的 Modal 弹窗
 * @param {Element|Element[]} appEls 目标 HTML 节点或节点数组
 * @param {string} mesIndexInfo 消息序号
 * @param {number|null} initialIndex 初始选中的应用索引（为 null 时自动恢复持久化记忆）
 */
export function openHtmlAppModal(appEls, mesIndexInfo, initialIndex = null) {
    const doc = getDoc();
    closeHtmlAppModal();

    const appElsList = Array.isArray(appEls) ? appEls : [appEls];
    if (appElsList.length === 0) return;

    // 恢复上次观看的组件索引
    let targetIndex = initialIndex !== null ? initialIndex : getSavedAppIndex(mesIndexInfo);
    let currentIndex = Math.max(0, Math.min(targetIndex, appElsList.length - 1));

    console.log(`[TwT HtmlPopup] 准备展开弹窗，共有 ${appElsList.length} 个应用，恢复历史选中的组件索引: ${currentIndex}`);

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

    const title = doc.createElement('div');
    title.className = 'twt-modal-title';

    const updateTitleText = () => {
        const indexText = appElsList.length > 1 ? ` (${currentIndex + 1}/${appElsList.length})` : '';
        title.innerHTML = `<i class="fa-solid fa-window-maximize"></i> <span>HTML 应用 ${mesIndexInfo ? `#${mesIndexInfo}` : ''}${indexText}</span>`;
    };
    updateTitleText();

    const controls = doc.createElement('div');
    controls.className = 'twt-modal-controls';

    // 如果多于 1 个应用，增加（箭头 + 下拉框）双重切换控制区域
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
                let label = el.getAttribute('data-title') || el.getAttribute('title') || el.getAttribute('name');
                if (!label && el.querySelector) {
                    const textNode = el.querySelector('h1, h2, h3, h4, header, .title, [data-title]');
                    if (textNode && textNode.textContent) label = textNode.textContent.trim();
                }
                if (label) {
                    label = label.replace(/\s+/g, ' ');
                    if (label.length > 15) label = label.substring(0, 15) + '…';
                    opt.textContent = `${idx + 1}. ${label}`;
                } else {
                    opt.textContent = `部件 #${idx + 1}`;
                }
                selectEl.appendChild(opt);
            });
            selectEl.value = String(currentIndex);
        };

        populateOptions();

        selectEl.onchange = (e) => {
            e.stopPropagation();
            currentIndex = parseInt(selectEl.value, 10);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            updateTitleText();
            renderBodyContent();
        };

        prevBtn.onclick = (e) => {
            e.stopPropagation();
            currentIndex = (currentIndex - 1 + appElsList.length) % appElsList.length;
            selectEl.value = String(currentIndex);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            updateTitleText();
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
            updateTitleText();
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

    header.appendChild(title);
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
        body.innerHTML = '';
        const currentAppEl = appElsList[currentIndex];
        if (!currentAppEl) return;

        const clone = currentAppEl.cloneNode(true);
        clone.classList.remove('twt-app-hidden');
        if (clone.style) {
            clone.style.display = '';
            clone.style.visibility = '';
            clone.style.backgroundColor = 'transparent';
        }

        // 精准测算当前小部件真实的物理宽度/高度
        let measuredW = 0;
        let measuredH = 0;

        const wasHidden = currentAppEl.classList.contains('twt-app-hidden');
        if (wasHidden) {
            currentAppEl.style.visibility = 'hidden';
            currentAppEl.style.position = 'absolute';
            currentAppEl.classList.remove('twt-app-hidden');
        }

        const innerNode = currentAppEl.firstElementChild || currentAppEl;
        const rect = innerNode.getBoundingClientRect();
        if (rect.width > 30 && rect.width < getWin().innerWidth) measuredW = rect.width;
        if (rect.height > 20) measuredH = rect.height;

        if (wasHidden) {
            currentAppEl.classList.add('twt-app-hidden');
            currentAppEl.style.visibility = '';
            currentAppEl.style.position = '';
        }

        // 锁定弹窗框架宽度与当前选中的小部件等宽
        if (measuredW > 0) {
            dialog.style.width = `${measuredW}px`;
            clone.style.width = '100%';
        } else {
            dialog.style.width = 'fit-content';
        }

        if (measuredH > 0) {
            clone.style.height = `${measuredH}px`;
        }

        if (clone.tagName === 'IFRAME') {
            clone.setAttribute('allowtransparency', 'true');
            if (currentAppEl.srcdoc) clone.srcdoc = currentAppEl.srcdoc;
            if (currentAppEl.src) clone.src = currentAppEl.src;
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

    // Esc 键关闭监听
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeHtmlAppModal();
            doc.removeEventListener('keydown', escHandler);
        }
    };
    doc.addEventListener('keydown', escHandler);

    doc.body.appendChild(modal);
    console.log('[TwT HtmlPopup] Modal 弹窗已展开（组件下拉选择框已激活）');
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
 * 处理 QR 栏按钮点击召出逻辑（支持一条消息内包含多个应用）
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

    // 捕获聚焦消息内【所有】匹配的应用节点
    const appEls = Array.from(focusedMes.querySelectorAll(selector)).filter(
        el => !el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')
    );

    if (appEls.length === 0) {
        console.warn(`[TwT HtmlPopup] 当前聚焦消息 (Index: ${mesIndex}) 内未包含匹配选择器 [${selector}] 的应用节点`);

        const doc = getDoc();
        const allAppEls = Array.from(doc.querySelectorAll(`#chat .mes_text ${selector}`)).filter(
            el => !el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')
        );

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

    console.log(`[TwT HtmlPopup] 成功在聚焦消息 (#${mesIndex}) 中提取到 ${appEls.length} 个应用节点`);
    openHtmlAppModal(appEls, mesIndex);
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
            btn.innerHTML = `<i class="fa-solid fa-window-maximize"></i>`;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleQrBtnClick();
            });

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
