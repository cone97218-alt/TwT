// @ts-nocheck
let debugLogs = [];
let isConsoleOpen = false;
let activeTab = 'summary';

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
    if (debugLogs.length > 150) debugLogs.shift();
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
        width: 94vw;
        max-width: 480px;
        height: 420px;
        z-index: 9999999;
        background: rgba(18, 18, 22, 0.96);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.7);
        color: #00ff66;
        font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 11px;
        box-sizing: border-box;
        overflow: hidden;
        flex-direction: column;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    `;

    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.12); padding:8px 12px; color:#fff; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1);">
            <span>🐞 TwT 全维度排版诊断控制台</span>
            <div style="display:flex; gap:6px;">
                <button id="twt-debug-copy-btn" style="background:#007aff; color:#fff; border:none; border-radius:4px; padding:3px 10px; font-size:11px; font-weight:bold; cursor:pointer;">全量复制诊断报告</button>
                <button id="twt-debug-close-btn" style="background:transparent; color:#fff; border:none; font-size:14px; cursor:pointer; padding:0 4px;">✕</button>
            </div>
        </div>
        <div style="display:flex; background:rgba(0,0,0,0.4); border-bottom:1px solid rgba(255,255,255,0.1); font-size:11px;">
            <button class="twt-debug-tab" data-tab="summary" style="flex:1; background:rgba(255,255,255,0.15); color:#fff; border:none; padding:6px 2px; cursor:pointer; font-weight:bold;">📊 排版概要</button>
            <button class="twt-debug-tab" data-tab="chat" style="flex:1; background:transparent; color:#aaa; border:none; padding:6px 2px; cursor:pointer;">📐 #chat容器</button>
            <button class="twt-debug-tab" data-tab="mes" style="flex:1; background:transparent; color:#aaa; border:none; padding:6px 2px; cursor:pointer;">💬 .mes消息</button>
            <button class="twt-debug-tab" data-tab="visual" style="flex:1; background:transparent; color:#aaa; border:none; padding:6px 2px; cursor:pointer;">🎨 视觉样式</button>
            <button class="twt-debug-tab" data-tab="logs" style="flex:1; background:transparent; color:#aaa; border:none; padding:6px 2px; cursor:pointer;">📝 运行日志</button>
        </div>
        <div id="twt-debug-content" style="flex:1; overflow-y:auto; padding:10px 12px; white-space:pre-wrap; word-break:break-all; line-height:1.45; color:#00ff66;">
            读取中...
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

    panel.querySelectorAll('.twt-debug-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            panel.querySelectorAll('.twt-debug-tab').forEach(b => {
                b.style.background = 'transparent';
                b.style.color = '#aaa';
                b.style.fontWeight = 'normal';
            });
            tabBtn.style.background = 'rgba(255,255,255,0.15)';
            tabBtn.style.color = '#fff';
            tabBtn.style.fontWeight = 'bold';
            activeTab = tabBtn.dataset.tab;
            refreshMetrics();
        });
    });

    panel.querySelector('#twt-debug-copy-btn').addEventListener('click', async () => {
        const text = getFullDiagnosticReport();
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
            toastr.success('全量诊断报告已成功复制到剪贴板！', '复制成功');
        } else {
            toastr.info('请全选控制台文本区域进行手动复制', '复制提示');
        }
    });

    setInterval(() => {
        if (isConsoleOpen) refreshMetrics();
    }, 600);
}

function getFullDiagnosticReport() {
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    const rect = chat ? chat.getBoundingClientRect() : {};
    const computed = chat ? getComputedStyle(chat) : {};

    let data = `=== TwT Full Diagnostic Report ===\n`;
    data += `Time: ${new Date().toLocaleString()}\n`;
    data += `UA: ${navigator.userAgent}\n`;
    data += `DPR: ${window.devicePixelRatio}\n`;
    data += `Window: ${window.innerWidth} x ${window.innerHeight}\n`;
    data += `Body Classes: ${doc.body.className}\n`;

    if (chat) {
        data += `\n--- #chat Dimensions & Scroll ---\n`;
        data += `clientWidth: ${chat.clientWidth}\n`;
        data += `offsetWidth: ${chat.offsetWidth}\n`;
        data += `scrollWidth: ${chat.scrollWidth}\n`;
        data += `scrollLeft: ${chat.scrollLeft.toFixed(2)}\n`;
        data += `rect.width: ${rect.width.toFixed(2)}, rect.height: ${rect.height.toFixed(2)}\n`;
        data += `rect.left: ${rect.left.toFixed(2)}, rect.right: ${rect.right.toFixed(2)}\n`;

        const cw = chat.clientWidth;
        const sw = chat.scrollWidth;
        const curPage = cw > 0 ? Math.round(chat.scrollLeft / cw) : 0;
        const totalPage = cw > 0 ? Math.round(sw / cw) : 0;
        const expectedLeft = curPage * cw;
        const drift = (chat.scrollLeft - expectedLeft).toFixed(2);
        data += `Current Page: ${curPage} / Total: ${totalPage}\n`;
        data += `Expected scrollLeft: ${expectedLeft}px | Actual: ${chat.scrollLeft.toFixed(2)}px | Page Drift: ${drift}px\n`;

        data += `\n--- #chat Computed Styles ---\n`;
        data += `column-width: ${computed.columnWidth}\n`;
        data += `-webkit-column-width: ${computed.webkitColumnWidth}\n`;
        data += `column-gap: ${computed.columnGap}\n`;
        data += `width: ${computed.width}\n`;
        data += `padding: L:${computed.paddingLeft} R:${computed.paddingRight} T:${computed.paddingTop} B:${computed.paddingBottom}\n`;
        data += `margin: L:${computed.marginLeft} R:${computed.marginRight} T:${computed.marginTop} B:${computed.marginBottom}\n`;
        data += `border: L:${computed.borderLeftWidth} R:${computed.borderRightWidth}\n`;
        data += `box-sizing: ${computed.boxSizing}\n`;
        data += `--twt-col-width: ${computed.getPropertyValue('--twt-col-width')}\n`;
        data += `--twt-padding-left: ${computed.getPropertyValue('--twt-padding-left')}\n`;
        data += `--twt-padding-right: ${computed.getPropertyValue('--twt-padding-right')}\n`;

        const msgs = chat.querySelectorAll('.mes');
        data += `\n--- Message Elements (.mes) Count: ${msgs.length} ---\n`;
        msgs.forEach((m, idx) => {
            if (idx < 5) {
                const mRect = m.getBoundingClientRect();
                const mComp = getComputedStyle(m);
                data += `[.mes #${idx}] id:${m.id || 'none'} | rect.width:${mRect.width.toFixed(2)} | rect.left:${mRect.left.toFixed(2)} | padL/R:${mComp.paddingLeft}/${mComp.paddingRight} | marL/R:${mComp.marginLeft}/${mComp.marginRight}\n`;
            }
        });

        const chatParent = doc.getElementById('chat_parent') || doc.getElementById('sheathed');
        if (chatParent) {
            const pRect = chatParent.getBoundingClientRect();
            const pComp = getComputedStyle(chatParent);
            data += `\n--- Parent (#${chatParent.id}) Bounds ---\n`;
            data += `rect.width: ${pRect.width.toFixed(2)} | padL/R: ${pComp.paddingLeft}/${pComp.paddingRight} | marL/R: ${pComp.marginLeft}/${pComp.marginRight}\n`;
        }
    } else {
        data += `#chat: NOT FOUND\n`;
    }

    data += `\n--- Recent Debug Logs (${debugLogs.length}) ---\n`;
    data += debugLogs.length ? debugLogs.slice(-40).join('\n') : '(No log entries)';
    return data;
}

function refreshMetrics() {
    const doc = getDoc();
    const contentDiv = doc.getElementById('twt-debug-content');
    if (!contentDiv) return;

    const chat = doc.getElementById('chat');
    if (!chat) {
        contentDiv.innerText = '#chat 元素未找到';
        return;
    }

    const rect = chat.getBoundingClientRect();
    const computed = getComputedStyle(chat);
    const cw = chat.clientWidth;
    const sw = chat.scrollWidth;
    const sl = chat.scrollLeft;
    const pages = cw > 0 ? Math.round(sw / cw) : 0;
    const curPage = cw > 0 ? Math.round(sl / cw) : 0;

    if (activeTab === 'summary') {
        const expected = curPage * cw;
        const drift = (sl - expected).toFixed(2);
        contentDiv.innerHTML = `
<div style="color:#ffdd55; font-weight:bold; margin-bottom:6px;">📊 核心排版对齐概况</div>
<div>• 视口宽高: ${window.innerWidth} x ${window.innerHeight} px (DPR: ${window.devicePixelRatio})</div>
<div>• 当前页码: 第 <b>${curPage}</b> 页 / 共 <b>${pages}</b> 页</div>
<div>• #chat clientWidth: <b>${cw}</b> px | rect.width: <b>${rect.width.toFixed(2)}</b> px</div>
<div>• scrollWidth: <b>${sw}</b> px | scrollLeft: <b>${sl.toFixed(2)}</b> px</div>
<div>• 期望位移: ${expected} px | 实际位移: ${sl.toFixed(2)} px</div>
<div>• <b>单页跳幅偏差 (Drift):</b> <span style="color:${Math.abs(drift) > 1 ? '#ff4444' : '#00ff66'}">${drift} px</span></div>
<div style="margin-top:8px; color:#aaa; font-size:10px;">提示：若 Drift 偏差为 0，说明 JS 滚动目标与页面完全对齐；如发现边距随翻页变大，可切换至 [.mes消息] 标签查看各消息块边距。</div>
        `;
    } else if (activeTab === 'chat') {
        contentDiv.innerHTML = `
<div style="color:#ffdd55; font-weight:bold; margin-bottom:6px;">📐 #chat 容器与父级节点数值</div>
<div>• clientWidth: ${chat.clientWidth} px | offsetWidth: ${chat.offsetWidth} px</div>
<div>• getBoundingClientRect.width: ${rect.width.toFixed(2)} px</div>
<div>• computed column-width: ${computed.columnWidth}</div>
<div>• computed -webkit-column-width: ${computed.webkitColumnWidth}</div>
<div>• computed column-gap: ${computed.columnGap}</div>
<div>• padding: Left=${computed.paddingLeft} | Right=${computed.paddingRight}</div>
<div>• margin: Left=${computed.marginLeft} | Right=${computed.marginRight}</div>
<div>• border: Left=${computed.borderLeftWidth} | Right=${computed.borderRightWidth}</div>
<div>• box-sizing: ${computed.boxSizing}</div>
<div>• CSS var(--twt-col-width): ${computed.getPropertyValue('--twt-col-width') || 'undefined'}</div>
        `;
    } else if (activeTab === 'mes') {
        const msgs = chat.querySelectorAll('.mes');
        let html = `<div style="color:#ffdd55; font-weight:bold; margin-bottom:6px;">💬 消息节点 (.mes) 独立边距检测 (共 ${msgs.length} 条)</div>`;
        msgs.forEach((m, idx) => {
            if (idx < 6) {
                const mRect = m.getBoundingClientRect();
                const mComp = getComputedStyle(m);
                const hasDangerPad = parseFloat(mComp.paddingLeft) > 0 || parseFloat(mComp.paddingRight) > 0;
                html += `
<div style="background:rgba(255,255,255,0.05); padding:4px 6px; border-radius:4px; margin-bottom:6px;">
  <div><b>#.mes ${idx} (id: ${m.id || 'none'})</b></div>
  <div>rect.width: ${mRect.width.toFixed(2)} px | rect.left: ${mRect.left.toFixed(2)} px</div>
  <div>padding: L=${mComp.paddingLeft} R=${mComp.paddingRight} <span style="color:${hasDangerPad ? '#ff9900' : '#00ff66'}">${hasDangerPad ? '(注意:阅读模式下.mes带有padding会导致折行溢出)' : '(正常)'}</span></div>
  <div>margin: L=${mComp.marginLeft} R=${mComp.marginRight}</div>
</div>`;
            }
        });
        contentDiv.innerHTML = html;
    } else if (activeTab === 'visual') {
        contentDiv.innerHTML = `
<div style="color:#ffdd55; font-weight:bold; margin-bottom:6px;">🎨 视觉模式与 CSS 变量状态</div>
<div>• body.classList: ${doc.body.className}</div>
<div>• --twt-padding-left: ${computed.getPropertyValue('--twt-padding-left') || '未设置'}</div>
<div>• --twt-padding-right: ${computed.getPropertyValue('--twt-padding-right') || '未设置'}</div>
<div>• --twt-font-size: ${computed.getPropertyValue('--twt-font-size') || '默认'}</div>
<div>• --twt-line-height: ${computed.getPropertyValue('--twt-line-height') || '默认'}</div>
<div>• --twt-text-indent: ${computed.getPropertyValue('--twt-text-indent') || '0'}</div>
        `;
    } else if (activeTab === 'logs') {
        contentDiv.innerText = debugLogs.length ? debugLogs.slice(-40).join('
') : '(暂无日志记录)';
    }
}

export function updateDebugConsoleUI() {
    refreshMetrics();
}
