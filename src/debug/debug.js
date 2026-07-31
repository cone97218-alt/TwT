// @ts-nocheck
import { extension_settings } from '../../../../../extensions.js';

let debugLogs = [];
let isPanelOpen = false;
let updateMetricsInterval = null;

function getDoc() {
    try {
        if (window.parent && window.parent.document) return window.parent.document;
    } catch {}
    return document;
}

/**
 * 记录 Debug 日志
 */
export function addDebugLog(type, details) {
    try {
        const timeStr = new Date().toISOString().split('T')[1].slice(0, 12);
        const entry = { time: timeStr, type, details };
        debugLogs.push(entry);
        if (debugLogs.length > 100) debugLogs.shift();
        if (isPanelOpen) renderLogStream();
    } catch (e) {}
}

/**
 * 渲染/刷新 Debug 浮动按钮与面板
 */
export function updateDebugConsoleVisibility() {
    const doc = getDoc();
    const settings = extension_settings.twt;
    const isEnabled = !!(settings && settings.debugConsoleEnabled);

    let btn = doc.getElementById('twt-debug-floating-btn');
    let panel = doc.getElementById('twt-debug-panel');

    if (!isEnabled) {
        if (btn) btn.remove();
        if (panel) panel.remove();
        if (updateMetricsInterval) clearInterval(updateMetricsInterval);
        return;
    }

    if (!btn) {
        btn = doc.createElement('div');
        btn.id = 'twt-debug-floating-btn';
        btn.innerHTML = '<i class="fa-solid fa-bug" style="margin-right:4px;"></i>Debug';
        btn.style.cssText = `
            position: fixed;
            top: 70px;
            right: 12px;
            z-index: 10000000;
            background: rgba(244, 67, 54, 0.88);
            color: #fff;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            backdrop-filter: blur(6px);
            user-select: none;
            -webkit-user-select: none;
        `;
        btn.addEventListener('click', () => toggleDebugPanel());
        doc.body.appendChild(btn);
    }

    if (!panel) {
        panel = doc.createElement('div');
        panel.id = 'twt-debug-panel';
        panel.style.cssText = `
            position: fixed;
            top: 115px;
            right: 10px;
            left: 10px;
            max-width: 440px;
            margin: 0 auto;
            max-height: 75vh;
            z-index: 10000001;
            background: rgba(18, 18, 18, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6);
            color: #00ff66;
            font-family: monospace;
            font-size: 11px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            backdrop-filter: blur(10px);
        `;

        panel.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.08); border-bottom:1px solid rgba(255,255,255,0.1); color:#fff; font-weight:bold;">
                <span><i class="fa-solid fa-bug" style="color:#f44336;margin-right:6px;"></i>TwT 手机端 Debug 诊断面板</span>
                <div style="display:flex; gap:6px;">
                    <button id="twt-debug-btn-copy" style="padding:3px 8px; font-size:11px; background:#007aff; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">复制报告</button>
                    <button id="twt-debug-btn-clear" style="padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.2); color:#fff; border:none; border-radius:4px; cursor:pointer;">清空</button>
                    <button id="twt-debug-btn-close" style="padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.1); color:#fff; border:none; border-radius:4px; cursor:pointer;">✕</button>
                </div>
            </div>
            <div id="twt-debug-metrics" style="padding:10px 12px; background:rgba(0,0,0,0.5); border-bottom:1px solid rgba(255,255,255,0.1); line-height:1.5; color:#64b5f6;">
                读取中...
            </div>
            <div id="twt-debug-logs" style="flex:1; padding:8px 12px; overflow-y:auto; word-break:break-all; line-height:1.35; color:#e0e0e0; max-height:40vh;">
            </div>
        `;

        doc.body.appendChild(panel);

        doc.getElementById('twt-debug-btn-close')?.addEventListener('click', () => toggleDebugPanel(false));
        doc.getElementById('twt-debug-btn-clear')?.addEventListener('click', () => {
            debugLogs = [];
            renderLogStream();
        });
        doc.getElementById('twt-debug-btn-copy')?.addEventListener('click', () => copyDebugReport());
    }
}

function toggleDebugPanel(open) {
    const doc = getDoc();
    const panel = doc.getElementById('twt-debug-panel');
    if (!panel) return;

    if (open !== undefined) isPanelOpen = open;
    else isPanelOpen = (panel.style.display === 'none');

    panel.style.display = isPanelOpen ? 'flex' : 'none';

    if (isPanelOpen) {
        refreshMetrics();
        renderLogStream();
        if (updateMetricsInterval) clearInterval(updateMetricsInterval);
        updateMetricsInterval = setInterval(refreshMetrics, 300);
    } else {
        if (updateMetricsInterval) clearInterval(updateMetricsInterval);
    }
}

function refreshMetrics() {
    const doc = getDoc();
    const metricsDiv = doc.getElementById('twt-debug-metrics');
    if (!metricsDiv) return;

    const chat = doc.getElementById('chat');
    const win = window;

    if (!chat) {
        metricsDiv.innerHTML = '⚠️ 未找到 #chat 容器';
        return;
    }

    const rect = chat.getBoundingClientRect();
    const computed = getComputedStyle(chat);
    const colWidthVar = computed.getPropertyValue('--twt-col-width') || 'none';
    const cw = rect.width;
    const scrollLeft = chat.scrollLeft;
    const scrollWidth = chat.scrollWidth;
    const clientWidth = chat.clientWidth;
    const totalPages = Math.max(1, Math.round(scrollWidth / (cw || 1)));
    const pageByScroll = Math.round(scrollLeft / (cw || 1));
    const expectedLeft = pageByScroll * cw;
    const drift = scrollLeft - expectedLeft;

    const childrenCount = chat.children.length;
    const firstChild = chat.firstElementChild;
    const firstChildTag = firstChild ? firstChild.tagName.toLowerCase() : 'none';
    const firstChildClass = firstChild ? firstChild.className : '';
    const firstChildHeight = firstChild ? firstChild.getBoundingClientRect().height : 0;
    const firstChildTransform = firstChild ? getComputedStyle(firstChild).transform : 'none';

    metricsDiv.innerHTML = `
        <div><strong>📱 视口:</strong> ${win.innerWidth}×${win.innerHeight} (DPR: ${win.devicePixelRatio || 1})</div>
        <div><strong>📐 #chat 实际宽(cw):</strong> ${rect.width.toFixed(2)}px (clientWidth: ${clientWidth}px)</div>
        <div><strong>📊 --twt-col-width:</strong> ${colWidthVar}</div>
        <div><strong>📖 模式:</strong> readingMode=${doc.body.classList.contains('twt-reading-mode')}</div>
        <div><strong>📑 页码:</strong> 第 ${pageByScroll} / ${totalPages} 页 (scrollLeft: ${scrollLeft.toFixed(2)}px, scrollWidth: ${scrollWidth}px)</div>
        <div><strong>🎯 预期对齐:</strong> ${expectedLeft.toFixed(2)}px (当前累积偏差: <span style="color:${Math.abs(drift)>2?'#ff5252':'#4caf50'};font-weight:bold;">${drift.toFixed(2)}px</span>)</div>
        <div><strong>🧱 #chat 边距:</strong> pad=L${computed.paddingLeft}/R${computed.paddingRight}, mar=L${computed.marginLeft}/R${computed.marginRight}</div>
        <div><strong>🧬 子节点数:</strong> ${childrenCount}个 (首节点: ${firstChildTag}.${firstChildClass}, 高:${firstChildHeight.toFixed(1)}px, tf:${firstChildTransform !== 'none'})</div>
    `;
}

function renderLogStream() {
    const doc = getDoc();
    const logsDiv = doc.getElementById('twt-debug-logs');
    if (!logsDiv) return;

    if (debugLogs.length === 0) {
        logsDiv.innerHTML = '<div style="opacity:0.5;text-align:center;padding:10px;">暂无动作日志</div>';
        return;
    }

    logsDiv.innerHTML = debugLogs.map(l => `
        <div style="margin-bottom:4px;border-bottom:1px dashed rgba(255,255,255,0.08);padding-bottom:2px;">
            <span style="color:#ffb74d;">[${l.time}]</span>
            <span style="color:#81c784;font-weight:bold;">${l.type}:</span>
            <span>${escapeLog(l.details)}</span>
        </div>
    `).reverse().join('');
}

function escapeLog(obj) {
    if (typeof obj === 'string') return obj;
    try {
        return JSON.stringify(obj);
    } catch {
        return String(obj);
    }
}

function copyDebugReport() {
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    const win = window;

    let report = `=== TwT Mobile Debug Report ===\n`;
    report += `Time: ${new Date().toLocaleString()}\n`;
    report += `Viewport: ${win.innerWidth}x${win.innerHeight} (DPR: ${win.devicePixelRatio})\n`;
    report += `UserAgent: ${navigator.userAgent}\n`;

    if (chat) {
        const rect = chat.getBoundingClientRect();
        const computed = getComputedStyle(chat);
        report += `Chat Rect Width: ${rect.width}px, Height: ${rect.height}px\n`;
        report += `Chat clientWidth: ${chat.clientWidth}px, scrollWidth: ${chat.scrollWidth}px, scrollLeft: ${chat.scrollLeft}px\n`;
        report += `Chat padding: L${computed.paddingLeft} R${computed.paddingRight}, margin: L${computed.marginLeft} R${computed.marginRight}\n`;
        report += `Chat colWidth var: ${computed.getPropertyValue('--twt-col-width')}\n`;
        report += `Chat Children Count: ${chat.children.length}\n`;
        const first = chat.firstElementChild;
        if (first) {
            report += `First Child: <${first.tagName.toLowerCase()} class="${first.className}"> height=${first.getBoundingClientRect().height}px transform=${getComputedStyle(first).transform}\n`;
        }
    }

    report += `\n--- Recent Logs (${debugLogs.length}) ---\n`;
    debugLogs.slice(-25).forEach(l => {
        report += `[${l.time}] ${l.type}: ${escapeLog(l.details)}\n`;
    });

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(report).then(() => {
            toastr.success('Debug 诊断报告已成功复制到剪贴板！', '成功');
        }).catch(err => {
            fallbackCopy(report);
        });
    } else {
        fallbackCopy(report);
    }
}

function fallbackCopy(text) {
    const doc = getDoc();
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        doc.execCommand('copy');
        toastr.success('Debug 诊断报告已成功复制到剪贴板！', '成功');
    } catch {
        toastr.error('复制失败，请截图 Debug 诊断面板。', '错误');
    }
    ta.remove();
}
