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
        background: rgba(0, 122, 255, 0.9);
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        padding: 6px 12px;
        border-radius: 20px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.5);
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
        width: 94vw;
        max-width: 460px;
        height: 420px;
        z-index: 9999999;
        background: rgba(18, 18, 20, 0.96);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.7);
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
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.15); padding:8px 12px; color:#fff; font-weight:bold;">
            <span>🐞 TwT 深度排版诊断控制台</span>
            <div style="display:flex; gap:6px;">
                <button id="twt-debug-copy-btn" style="background:#007aff; color:#fff; border:none; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">复制全量诊断</button>
                <button id="twt-debug-close-btn" style="background:transparent; color:#fff; border:none; font-size:14px; cursor:pointer; padding:0 4px;">✕</button>
            </div>
        </div>
        <div id="twt-debug-metrics" style="padding:8px 12px; background:rgba(0,0,0,0.6); border-bottom:1px solid rgba(255,255,255,0.1); color:#ffdd55; line-height:1.5; font-size:11px;">
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
        const text = getFullDiagnosticDataText();
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
            toastr.success('全量深度诊断信息已复制到剪贴板！', '复制成功');
        } else {
            toastr.info('请在下方文本框全选复制', '复制提示');
        }
    });

    setInterval(() => {
        if (isConsoleOpen) refreshMetrics();
    }, 600);
}

function getFullDiagnosticDataText() {
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    const rect = chat ? chat.getBoundingClientRect() : {};
    const computed = chat ? getComputedStyle(chat) : {};

    let data = `=== TwT Full Deep Mobile Diagnostic Report ===\n`;
    data += `Time: ${new Date().toLocaleString()}\n`;
    data += `UA: ${navigator.userAgent}\n`;
    data += `DPR: ${window.devicePixelRatio}\n`;
    data += `Screen: ${window.screen ? window.screen.width + 'x' + window.screen.height : 'N/A'}\n`;
    data += `Window: ${window.innerWidth} x ${window.innerHeight}\n`;
    data += `Body Classes: ${doc.body.className}\n`;

    if (chat) {
        data += `\n--- #chat Bounds & Scroll ---\n`;
        data += `clientWidth: ${chat.clientWidth}\n`;
        data += `offsetWidth: ${chat.offsetWidth}\n`;
        data += `scrollWidth: ${chat.scrollWidth}\n`;
        data += `scrollLeft: ${chat.scrollLeft}\n`;
        data += `rect.width: ${rect.width.toFixed(3)}\n`;
        data += `rect.left: ${rect.left.toFixed(3)}, rect.right: ${rect.right.toFixed(3)}\n`;
        
        data += `\n--- #chat Computed CSS ---\n`;
        data += `column-width: ${computed.columnWidth}\n`;
        data += `-webkit-column-width: ${computed.webkitColumnWidth}\n`;
        data += `column-gap: ${computed.columnGap}\n`;
        data += `width: ${computed.width}\n`;
        data += `max-width: ${computed.maxWidth}\n`;
        data += `padding: L:${computed.paddingLeft} R:${computed.paddingRight} T:${computed.paddingTop} B:${computed.paddingBottom}\n`;
        data += `margin: L:${computed.marginLeft} R:${computed.marginRight} T:${computed.marginTop} B:${computed.marginBottom}\n`;
        data += `--twt-col-width: ${computed.getPropertyValue('--twt-col-width')}\n`;

        // Parent containers
        const parents = ['#sheathed', '#chat_parent', '#form_sheath'];
        parents.forEach(pSel => {
            const pEl = doc.querySelector(pSel);
            if (pEl) {
                const pRect = pEl.getBoundingClientRect();
                const pComp = getComputedStyle(pEl);
                data += `\n--- Parent ${pSel} ---\n`;
                data += `rect.width: ${pRect.width.toFixed(2)}, rect.left: ${pRect.left.toFixed(2)}\n`;
                data += `padding: L:${pComp.paddingLeft} R:${pComp.paddingRight}\n`;
                data += `margin: L:${pComp.marginLeft} R:${pComp.marginRight}\n`;
            }
        });

        // Scan all .mes elements
        const mesList = Array.from(chat.querySelectorAll('.mes'));
        data += `\n--- Total .mes Elements: ${mesList.length} ---\n`;

        mesList.slice(0, 10).forEach((mes, idx) => {
            const mesRect = mes.getBoundingClientRect();
            const mesComp = getComputedStyle(mes);
            data += `\n[.mes #${idx} id=${mes.id || 'none'}]\n`;
            data += `rect.width: ${mesRect.width.toFixed(2)}, rect.left: ${mesRect.left.toFixed(2)}, rect.top: ${mesRect.top.toFixed(2)}\n`;
            data += `margin: L:${mesComp.marginLeft} R:${mesComp.marginRight} T:${mesComp.marginTop} B:${mesComp.marginBottom}\n`;
            data += `padding: L:${mesComp.paddingLeft} R:${mesComp.paddingRight} T:${mesComp.paddingTop} B:${mesComp.paddingBottom}\n`;
            data += `display: ${mesComp.display}, box-sizing: ${mesComp.boxSizing}\n`;

            const textEl = mes.querySelector('.mes_text');
            if (textEl) {
                const tRect = textEl.getBoundingClientRect();
                const tComp = getComputedStyle(textEl);
                data += `  └─ [.mes_text] rectW: ${tRect.width.toFixed(2)}, marginL/R: ${tComp.marginLeft}/${tComp.marginRight}, padL/R: ${tComp.paddingLeft}/${tComp.paddingRight}\n`;

                const pEls = Array.from(textEl.querySelectorAll('p, pre, blockquote, table, div'));
                if (pEls.length > 0) {
                    const firstP = pEls[0];
                    const pComp = getComputedStyle(firstP);
                    data += `  └─ [Child <${firstP.tagName.toLowerCase()}>] margin: T:${pComp.marginTop} B:${pComp.marginBottom} L:${pComp.marginLeft} R:${pComp.marginRight}, line-height: ${pComp.lineHeight}\n`;
                }
            }
        });

    } else {
        data += `#chat: NOT FOUND\n`;
    }

    data += `\n--- Recent Debug Logs ---\n`;
    data += debugLogs.length ? debugLogs.slice(-30).join('\n') : '(No logs recorded)';
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
    const mesCount = chat.querySelectorAll('.mes').length;

    metricsDiv.innerHTML = `
        <div><b>视口:</b> ${window.innerWidth}px | DPR: ${window.devicePixelRatio} | 消息数: ${mesCount}</div>
        <div><b>#chat:</b> clientW=${cw} | rectW=${rect.width.toFixed(2)} | scrollW=${sw}</div>
        <div><b>页码:</b> 第 ${curPage} 页 / 共 ${pages} 页 | scrollLeft=${sl.toFixed(1)}</div>
        <div><b>列宽 CSS:</b> col-width=${computed.columnWidth} | var=${colWVar}</div>
        <div><b>边距 CSS:</b> col-gap=${computed.columnGap} | padL/R=${computed.paddingLeft}/${computed.paddingRight}</div>
    `;

    logsDiv.innerText = debugLogs.length ? debugLogs.slice(-30).join('\n') : '点击上方【复制全量诊断】按钮，即可把包含所有消息层级、Margin、Padding、段落特性的全量报告一键粘贴给我！';
}

export function updateDebugConsoleUI() {
    refreshMetrics();
}
