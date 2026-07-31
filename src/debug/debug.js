// @ts-nocheck
import { getContext } from '../../../../../extensions.js';

let debugLogs = [];
let isConsoleOpen = false;

function getDoc() {
    try {
        if (window.parent && window.parent.document) return window.parent.document;
    } catch {}
    return document;
}

export function logDebugMessage(category, message) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}][${category}] ${typeof message === 'object' ? JSON.stringify(message) : message}`;
    debugLogs.push(entry);
    if (debugLogs.length > 100) debugLogs.shift();
    updateDebugConsoleUI();
}

export function initDebugConsole() {
    const doc = getDoc();
    if (doc.getElementById('twt-debug-btn')) return;

    // 1. Floating Toggle Button
    const btn = doc.createElement('div');
    btn.id = 'twt-debug-btn';
    btn.innerText = '🐞 TwT Debug';
    btn.style.cssText = `
        position: fixed;
        bottom: 70px;
        right: 10px;
        z-index: 9999999;
        background: rgba(0, 122, 255, 0.85);
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        padding: 6px 10px;
        border-radius: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        cursor: pointer;
        user-select: none;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
    `;

    // 2. Debug Modal Panel
    const panel = doc.createElement('div');
    panel.id = 'twt-debug-panel';
    panel.style.cssText = `
        display: none;
        position: fixed;
        bottom: 110px;
        right: 10px;
        width: 92vw;
        max-width: 440px;
        height: 380px;
        z-index: 9999999;
        background: rgba(20, 20, 20, 0.95);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        color: #00ff66;
        font-family: monospace;
        font-size: 11px;
        box-sizing: border-box;
        overflow: hidden;
        flex-direction: column;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    `;

    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.12); padding:8px 12px; color:#fff; font-weight:bold;">
            <span>🐞 TwT 排版诊断控制台</span>
            <div style="display:flex; gap:6px;">
                <button id="twt-debug-copy-btn" style="background:#007aff; color:#fff; border:none; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">复制诊断信息</button>
                <button id="twt-debug-close-btn" style="background:transparent; color:#fff; border:none; font-size:14px; cursor:pointer; padding:0 4px;">✕</button>
            </div>
        </div>
        <div id="twt-debug-metrics" style="padding:8px 12px; background:rgba(0,0,0,0.5); border-bottom:1px solid rgba(255,255,255,0.1); color:#ffdd55; line-height:1.5; font-size:11px;">
            正在读取页面与排版数据...
        </div>
        <div id="twt-debug-logs" style="flex:1; overflow-y:auto; padding:8px 12px; white-space:pre-wrap; word-break:break-all; line-height:1.4; color:#00ff66;">
        </div>
    `;

    doc.body.appendChild(btn);
    doc.body.appendChild(panel);

    btn.addEventListener('click', () => {
        isConsoleOpen = !isConsoleOpen;
        panel.style.display = isConsoleOpen ? 'flex' : 'none';
        if (isConsoleOpen) refreshMetrics();
    });

    panel.querySelector('#twt-debug-close-btn').addEventListener('click', () => {
        isConsoleOpen = false;
        panel.style.display = 'none';
    });

    panel.querySelector('#twt-debug-copy-btn').addEventListener('click', async () => {
        const text = getDiagnosticDataText();
        let copySuccess = false;
        try {
            await navigator.clipboard.writeText(text);
            copySuccess = true;
        } catch {
            try {
                const textarea = doc.createElement('textarea');
                textarea.value = text;
                doc.body.appendChild(textarea);
                textarea.select();
                copySuccess = doc.execCommand('copy');
                doc.body.removeChild(textarea);
            } catch {}
        }
        if (copySuccess) {
            toastr.success('诊断信息已成功复制到剪贴板！', '复制成功');
        } else {
            toastr.info('请在控制台文本框中手动长按全选复制', '复制提示');
        }
    });

    setInterval(() => {
        if (isConsoleOpen) refreshMetrics();
    }, 600);
}

function getDiagnosticDataText() {
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    const rect = chat ? chat.getBoundingClientRect() : {};
    const computed = chat ? getComputedStyle(chat) : {};

    let data = `=== TwT Mobile Diagnostic Report ===\n`;
    data += `Time: ${new Date().toLocaleString()}\n`;
    data += `UA: ${navigator.userAgent}\n`;
    data += `DPR: ${window.devicePixelRatio}\n`;
    data += `Window: ${window.innerWidth} x ${window.innerHeight}\n`;

    if (chat) {
        data += `\n--- #chat Dimensions ---\n`;
        data += `clientWidth: ${chat.clientWidth}\n`;
        data += `offsetWidth: ${chat.offsetWidth}\n`;
        data += `scrollWidth: ${chat.scrollWidth}\n`;
        data += `scrollLeft: ${chat.scrollLeft}\n`;
        data += `rect.width: ${rect.width.toFixed(2)}\n`;
        data += `rect.left: ${rect.left.toFixed(2)}, rect.right: ${rect.right.toFixed(2)}\n`;
        data += `\n--- #chat Computed CSS ---\n`;
        data += `column-width: ${computed.columnWidth}\n`;
        data += `-webkit-column-width: ${computed.webkitColumnWidth}\n`;
        data += `column-gap: ${computed.columnGap}\n`;
        data += `width: ${computed.width}\n`;
        data += `padding: L:${computed.paddingLeft} R:${computed.paddingRight} T:${computed.paddingTop} B:${computed.paddingBottom}\n`;
        data += `margin: L:${computed.marginLeft} R:${computed.marginRight} T:${computed.marginTop} B:${computed.marginBottom}\n`;
        data += `--twt-col-width: ${computed.getPropertyValue('--twt-col-width')}\n`;

        const firstMsg = chat.querySelector('.mes');
        if (firstMsg) {
            const msgRect = firstMsg.getBoundingClientRect();
            const msgComp = getComputedStyle(firstMsg);
            data += `\n--- First .mes Bounds ---\n`;
            data += `rect.width: ${msgRect.width.toFixed(2)}, rect.left: ${msgRect.left.toFixed(2)}\n`;
            data += `margin: L:${msgComp.marginLeft} R:${msgComp.marginRight}\n`;
            data += `padding: L:${msgComp.paddingLeft} R:${msgComp.paddingRight}\n`;
        }

        const chatParent = doc.getElementById('chat_parent') || doc.getElementById('sheathed');
        if (chatParent) {
            const pRect = chatParent.getBoundingClientRect();
            const pComp = getComputedStyle(chatParent);
            data += `\n--- #chat Parent Bounds ---\n`;
            data += `rect.width: ${pRect.width.toFixed(2)}, rect.left: ${pRect.left.toFixed(2)}\n`;
            data += `padding: L:${pComp.paddingLeft} R:${pComp.paddingRight}\n`;
            data += `margin: L:${pComp.marginLeft} R:${pComp.marginRight}\n`;
        }
    } else {
        data += `#chat: NOT FOUND\n`;
    }

    data += `\n--- Recent Debug Logs ---\n`;
    data += debugLogs.length ? debugLogs.slice(-30).join('\n') : '(No log entries recorded yet)';
    return data;
}

function refreshMetrics() {
    const doc = getDoc();
    const metricsDiv = doc.getElementById('twt-debug-metrics');
    const logsDiv = doc.getElementById('twt-debug-logs');
    if (!metricsDiv || !logsDiv) return;

    const chat = doc.getElementById('chat');
    if (!chat) {
        metricsDiv.innerText = '#chat 元素未找到';
        return;
    }

    const rect = chat.getBoundingClientRect();
    const computed = getComputedStyle(chat);
    const cw = chat.clientWidth;
    const sw = chat.scrollWidth;
    const sl = chat.scrollLeft;
    const pages = cw > 0 ? Math.round(sw / cw) : 0;
    const curPage = cw > 0 ? Math.round(sl / cw) : 0;
    const colWVar = computed.getPropertyValue('--twt-col-width') || 'none';

    metricsDiv.innerHTML = `
        <div><b>视口:</b> ${window.innerWidth}px | DPR: ${window.devicePixelRatio}</div>
        <div><b>#chat:</b> clientW=${cw} | rectW=${rect.width.toFixed(1)} | scrollW=${sw}</div>
        <div><b>页码:</b> 第 ${curPage} 页 / 共 ${pages} 页 | scrollLeft=${sl.toFixed(1)}</div>
        <div><b>列宽 CSS:</b> col-width=${computed.columnWidth} | var=${colWVar}</div>
        <div><b>边距 CSS:</b> col-gap=${computed.columnGap} | padL/R=${computed.paddingLeft}/${computed.paddingRight}</div>
    `;

    logsDiv.innerText = debugLogs.length ? debugLogs.slice(-30).join('\n') : '实时监听中，产生操作或翻页日志将展示在此...';
}

export function updateDebugConsoleUI() {
    refreshMetrics();
}
