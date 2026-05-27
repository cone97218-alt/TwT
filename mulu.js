// @ts-nocheck
import { extension_settings, getContext } from '../../../extensions.js';
import { showMoreMessages } from '../../../../script.js';

const BTN_START_ID = 'twt-mulu-start-btn';
const BTN_END_ID = 'twt-mulu-end-btn';
const BTN_TOC_ID = 'twt-mulu-toc-btn';

const escapeHtml = (str) => (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// 模块级全局变量，保证目录模态框关闭后重新打开时日志和生成状态依然存在
let globalBatchLogs = [];
let globalGenerationStatus = 'idle'; // 'idle', 'generating', 'done'

function getDoc() {
    try {
        if (window.parent && window.parent.document) {
            return window.parent.document;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document in mulu.js", e);
    }
    return document;
}

function getWin() {
    try {
        if (window.parent && window.parent.document) {
            return window.parent;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent in mulu.js", e);
    }
    return window;
}

async function ensureMessageLoaded(mesId) {
    const doc = getDoc();
    let targetMes = doc.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (targetMes) return targetMes;
    
    // If not found in DOM, load the messages!
    const firstMesEl = doc.querySelector('#chat .mes');
    if (!firstMesEl) return null;
    
    const firstDisplayedMesId = parseInt(firstMesEl.getAttribute('mesid'));
    if (isNaN(firstDisplayedMesId)) return null;
    
    if (mesId < firstDisplayedMesId) {
        const needToLoadCount = firstDisplayedMesId - mesId;
        try {
            await showMoreMessages(needToLoadCount);
        } catch (e) {
            console.error('Failed to load more messages via showMoreMessages:', e);
            // Fallback: try clicking the show more messages button
            const showMoreBtn = doc.getElementById('show_more_messages');
            if (showMoreBtn) {
                showMoreBtn.click();
                // Wait a tiny bit and check
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
    
    // Query again
    return doc.querySelector(`#chat .mes[mesid="${mesId}"]`);
}

function findSiblingAiMessageId(currentId, direction) {
    const context = typeof getContext === 'function' ? getContext() : null;
    const chatArray = context ? context.chat : window.chat;
    if (!chatArray) return -1;
    
    if (direction === 'prev') {
        for (let i = currentId - 1; i >= 0; i--) {
            const msg = chatArray[i];
            if (msg && !msg.is_user && !msg.is_system && !msg.system) {
                return i;
            }
        }
    } else {
        for (let i = currentId + 1; i < chatArray.length; i++) {
            const msg = chatArray[i];
            if (msg && !msg.is_user && !msg.is_system && !msg.system) {
                return i;
            }
        }
    }
    return -1;
}

function getTargetMessage() {
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return null;
    
    const chatRect = chatContainer.getBoundingClientRect();
    const messages = Array.from(doc.querySelectorAll('#chat .mes'));
    const aiMessages = messages.filter(m => {
        const isUser = m.classList.contains('user_mes') || m.getAttribute('is_user') === 'true';
        const isSystem = m.classList.contains('system_mes') || m.getAttribute('is_system') === 'true';
        return !isUser && !isSystem;
    });
    if (aiMessages.length === 0) return null;
    
    if (doc.body.classList.contains('twt-reading-mode')) {
        const currentScrollLeft = chatContainer.scrollLeft;
        const cw = chatContainer.clientWidth;
        const pageCenter = currentScrollLeft + (cw / 2);
        
        // Find the AI message that spans the pageCenter
        for (let i = aiMessages.length - 1; i >= 0; i--) {
            const mes = aiMessages[i];
            const rect = mes.getBoundingClientRect();
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const absoluteRight = rect.right - chatRect.left + currentScrollLeft;
            if (pageCenter >= absoluteLeft && pageCenter <= absoluteRight) {
                return mes;
            }
        }
        
        // Fallback: closest AI message to the center
        let closestMes = null;
        let minDistance = Infinity;
        for (const mes of aiMessages) {
            const rect = mes.getBoundingClientRect();
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const absoluteRight = rect.right - chatRect.left + currentScrollLeft;
            const mesCenter = (absoluteLeft + absoluteRight) / 2;
            const dist = Math.abs(mesCenter - pageCenter);
            if (dist < minDistance) {
                minDistance = dist;
                closestMes = mes;
            }
        }
        return closestMes || aiMessages[aiMessages.length - 1];
    } else {
        // Normal vertical scrolling mode - only check visible AI messages!
        const chatCenterY = chatRect.top + chatRect.height / 2;
        let closestMes = null;
        let minDistance = Infinity;
        
        for (const mes of aiMessages) {
            const rect = mes.getBoundingClientRect();
            if (rect.top <= chatRect.bottom && rect.bottom >= chatRect.top) {
                const mesCenterY = rect.top + rect.height / 2;
                const dist = Math.abs(mesCenterY - chatCenterY);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestMes = mes;
                }
            }
        }
        
        if (closestMes) return closestMes;
        
        for (const mes of aiMessages) {
            const rect = mes.getBoundingClientRect();
            if (rect.bottom >= chatRect.top) {
                return mes;
            }
        }
        
        return aiMessages[aiMessages.length - 1];
    }
}

async function scrollToMessageEdge(edge) {
    let mes = getTargetMessage();
    if (!mes) {
        // If no active AI message can be found, just scroll to absolute start or end!
        const doc = getDoc();
        const chatContainer = doc.getElementById('chat');
        if (chatContainer) {
            if (doc.body.classList.contains('twt-reading-mode')) {
                const cw = chatContainer.clientWidth;
                if (edge === 'start') {
                    chatContainer.scrollTo({ left: 0, behavior: 'smooth' });
                } else {
                    chatContainer.scrollTo({ left: chatContainer.scrollWidth, behavior: 'smooth' });
                }
            } else {
                if (edge === 'start') {
                    chatContainer.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
                }
            }
            return;
        }
        toastr.info('未找到AI消息', '提示');
        return;
    }
    
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;
    
    const currentId = parseInt(mes.getAttribute('mesid'));
    if (isNaN(currentId)) return;
    
    if (doc.body.classList.contains('twt-reading-mode')) {
        const chatRect = chatContainer.getBoundingClientRect();
        const cw = chatContainer.clientWidth;
        const currentScrollLeft = chatContainer.scrollLeft;
        const currentPage = Math.round(currentScrollLeft / cw);
        
        let targetPage = -1;
        let targetScrollLeft = 0;
        
        for (let attempts = 0; attempts < 2; attempts++) {
            const rect = mes.getBoundingClientRect();
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const absoluteRight = rect.right - chatRect.left + currentScrollLeft;
            
            if (edge === 'start') {
                targetScrollLeft = absoluteLeft;
            } else {
                targetScrollLeft = Math.floor((absoluteRight - 1) / cw) * cw;
                targetScrollLeft = Math.max(targetScrollLeft, Math.floor(absoluteLeft / cw) * cw);
            }
            
            targetPage = Math.round(targetScrollLeft / cw);
            
            if (targetPage === currentPage && attempts === 0) {
                const targetId = findSiblingAiMessageId(currentId, edge === 'start' ? 'prev' : 'next');
                if (targetId !== -1) {
                    const loadedMes = await ensureMessageLoaded(targetId);
                    if (loadedMes) {
                        mes = loadedMes;
                        await new Promise(resolve => setTimeout(resolve, 0));
                        continue;
                    }
                }
                break;
            } else {
                break;
            }
        }
        
        if (targetPage === currentPage) {
            // Sibling not found or already at edge -> jump to absolute start or end!
            if (edge === 'start') {
                chatContainer.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                chatContainer.scrollTo({ left: chatContainer.scrollWidth, behavior: 'smooth' });
            }
        } else {
            chatContainer.scrollTo({ left: targetPage * cw, behavior: 'smooth' });
        }
    } else {
        // Vertical scroll mode chain scrolling
        const chatRect = chatContainer.getBoundingClientRect();
        const rect = mes.getBoundingClientRect();
        const currentScrollTop = chatContainer.scrollTop;
        
        let shouldJumpToSibling = false;
        if (edge === 'start') {
            const diff = Math.abs(rect.top - chatRect.top);
            if (diff < 15) {
                shouldJumpToSibling = true;
            }
        } else {
            const diff = Math.abs(rect.bottom - chatRect.bottom);
            if (diff < 15) {
                shouldJumpToSibling = true;
            }
        }
        
        if (shouldJumpToSibling) {
            const targetId = findSiblingAiMessageId(currentId, edge === 'start' ? 'prev' : 'next');
            if (targetId !== -1) {
                const loadedMes = await ensureMessageLoaded(targetId);
                if (loadedMes) {
                    mes = loadedMes;
                    const newRect = mes.getBoundingClientRect();
                    const targetScrollTop = edge === 'start'
                        ? newRect.top - chatRect.top + currentScrollTop
                        : newRect.bottom - chatRect.bottom + currentScrollTop;
                    chatContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
                    return;
                }
            }
            // Sibling not found or already at edge -> jump to absolute start or end!
            if (edge === 'start') {
                chatContainer.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
            }
            return;
        }
        
        const targetScrollTop = edge === 'start'
            ? rect.top - chatRect.top + currentScrollTop
            : rect.bottom - chatRect.bottom + currentScrollTop;
        chatContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    }
}

function createButton(id, title, iconClass, onClick) {
    const doc = getDoc();
    const btn = doc.createElement('div');
    btn.id = id;
    btn.className = 'qr--button menu_button interactable';
    btn.tabIndex = 0;
    btn.role = 'button';
    btn.title = title;
    btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    return btn;
}

function injectMuluStyles() {
    const doc = getDoc();
    if (doc.getElementById('twt-mulu-styles')) return;
    const style = doc.createElement('style');
    style.id = 'twt-mulu-styles';
    style.innerHTML = `
        #twt-mulu-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.75);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #twt-mulu-modal {
            position: relative;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            background: var(--SmartThemeBlurTintColor, rgba(30, 30, 30, 0.98));
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 12px;
            box-shadow: 0 10px 30px var(--SmartThemeShadowColor, rgba(0, 0, 0, 0.5));
            color: var(--SmartThemeBodyColor, #fff);
            z-index: 10001;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: var(--SmartThemeFontFamily, sans-serif);
        }
        #twt-mulu-modal button.menu_button {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            color: var(--SmartThemeBodyColor, #fff);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #twt-mulu-modal button.menu_button:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        .twt-mulu-list::-webkit-scrollbar {
            width: 6px;
        }
        .twt-mulu-list::-webkit-scrollbar-track {
            background: transparent;
        }
        .twt-mulu-list::-webkit-scrollbar-thumb {
            background: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
            border-radius: 3px;
        }
        .twt-mulu-list::-webkit-scrollbar-thumb:hover {
            background: var(--SmartThemeEmColor, rgba(255, 255, 255, 0.4));
        }
        .twt-mulu-row:hover {
            background-color: var(--SmartThemeBotMesBlurTintColor, rgba(255, 255, 255, 0.05)) !important;
        }
    `;
    doc.head.appendChild(style);
}

let cachedOverlay = null;
let cachedChatLength = 0;
let cachedLastMessageText = '';
let cachedRegexStr = '';
let cachedSortOrder = '';
let cachedCommentsEnabled = false;

function getOrBuildMuluOverlay(forceRebuild = false) {
    const settings = extension_settings.twt || {};
    const regexStr = settings.customMuluRegex || '';
    const sortOrder = settings.muluSortOrder || 'asc';
    const commentsEnabled = !!settings.commentsEnabled;

    const context = typeof getContext === 'function' ? getContext() : null;
    const chatArray = context ? context.chat : window.chat;
    if (!chatArray || chatArray.length === 0) {
        return null;
    }

    const lastMsgText = chatArray.length > 0 ? (chatArray[chatArray.length - 1].mes || '') : '';

    if (
        !forceRebuild &&
        cachedOverlay &&
        cachedChatLength === chatArray.length &&
        cachedLastMessageText === lastMsgText &&
        cachedRegexStr === regexStr &&
        cachedSortOrder === sortOrder &&
        cachedCommentsEnabled === commentsEnabled
    ) {
        return cachedOverlay;
    }

    injectMuluStyles();

    const doc = getDoc();
    const tocItems = [];

    for (let i = 0; i < chatArray.length; i++) {
        const msg = chatArray[i];
        if (msg.is_user || msg.system) continue;

        const rawText = msg.mes || '';
        const cleanText = getCleanText(rawText);

        let displayTitle = '';
        if (regexStr && regexStr.trim() !== '') {
            const matchedTitle = extractDirectoryTitle(cleanText, regexStr);
            if (matchedTitle) {
                displayTitle = matchedTitle;
            } else {
                continue;
            }
        } else {
            displayTitle = cleanText;
        }

        displayTitle = displayTitle.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

        tocItems.push({
            mesId: i,
            title: displayTitle,
            fullText: cleanText
        });
    }

    if (sortOrder === 'desc') {
        tocItems.sort((a, b) => b.mesId - a.mesId);
    } else {
        tocItems.sort((a, b) => a.mesId - b.mesId);
    }

    const overlay = doc.createElement('div');
    overlay.id = 'twt-mulu-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', closeMuluModal);

    const modal = doc.createElement('div');
    modal.id = 'twt-mulu-modal';
    modal.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    const listContainer = doc.createElement('div');
    listContainer.className = 'twt-mulu-list';
    listContainer.style.cssText = `
        flex: 1;
        overflow-y: auto;
        max-height: 55vh;
        padding: 5px 0;
        width: 100%;
        box-sizing: border-box;
    `;

    const header = doc.createElement('div');
    header.className = 'twt-mulu-header';
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
        gap: 4px;
    `;

    const titleSpan = doc.createElement('span');
    titleSpan.innerText = '目录';
    titleSpan.style.cssText = `
        font-size: 1.1em;
        font-weight: bold;
        flex-shrink: 0;
    `;

    const searchInput = doc.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'twt-mulu-search';
    searchInput.placeholder = '搜索...';
    searchInput.style.cssText = `
        flex: 1;
        box-sizing: border-box;
        padding: 4px 8px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
        border-radius: 4px;
        background: var(--SmartThemeDarkColor, rgba(0, 0, 0, 0.2));
        color: var(--SmartThemeBodyColor, #fff);
        font-size: 0.85em;
        outline: none;
        transition: border-color 0.2s;
        min-width: 0;
    `;

    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = searchInput.value.toLowerCase().trim();
            const rows = listContainer.querySelectorAll('.twt-mulu-row');
            rows.forEach(row => {
                const rowText = (row.getAttribute('data-text') || '').toLowerCase();
                const fullText = (row.getAttribute('data-full-text') || '').toLowerCase();
                if (rowText.includes(query) || fullText.includes(query)) {
                    row.style.display = 'flex';
                } else {
                    row.style.display = 'none';
                }
            });
        }, 800);
    });

    let isBatchMode = false;

    const batchActionsContainer = doc.createElement('div');
    batchActionsContainer.style.cssText = `
        display: none;
        flex: 1;
        align-items: center;
        gap: 2px;
        box-sizing: border-box;
        overflow-x: auto;
        min-width: 0;
    `;
    
    const exitBatchSelectMode = () => {
        isBatchMode = false;
        batchActionsContainer.style.display = 'none';
        searchInput.style.display = 'block';
        batchSelectBtn.style.background = 'rgba(255, 255, 255, 0.08)';
        
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            cb.dataset.checked = 'false';
            cb.style.display = 'none';
            cb.innerHTML = '';
        });
    };

    const btnStyle = 'padding: 2px 3px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; min-width: 28px !important; line-height: 1 !important; height: auto !important; width: auto !important; flex-shrink: 0 !important;';
    
    const btnSelectAll = doc.createElement('button');
    btnSelectAll.className = 'menu_button';
    btnSelectAll.style.cssText = btnStyle;
    btnSelectAll.innerText = '全选';
    btnSelectAll.addEventListener('click', (e) => {
        e.stopPropagation();
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            cb.dataset.checked = 'true';
            cb.innerHTML = '<i class="fa-solid fa-check" style="font-size:11px;"></i>';
        });
    });

    const btnReverseSelect = doc.createElement('button');
    btnReverseSelect.className = 'menu_button';
    btnReverseSelect.style.cssText = btnStyle;
    btnReverseSelect.innerText = '反选';
    btnReverseSelect.addEventListener('click', (e) => {
        e.stopPropagation();
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            const nowChecked = cb.dataset.checked !== 'true';
            cb.dataset.checked = String(nowChecked);
            cb.innerHTML = nowChecked ? '<i class="fa-solid fa-check" style="font-size:11px;"></i>' : '';
        });
    });

    const btnRangeSelect = doc.createElement('button');
    btnRangeSelect.className = 'menu_button';
    btnRangeSelect.style.cssText = btnStyle;
    btnRangeSelect.innerText = '连选';
    btnRangeSelect.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkboxes = Array.from(listContainer.querySelectorAll('.twt-mulu-checkbox'));
        const checkedIndices = checkboxes.reduce((acc, cb, idx) => {
            if (cb.dataset.checked === 'true') acc.push(idx);
            return acc;
        }, []);
        if (checkedIndices.length >= 2) {
            const minIdx = Math.min(...checkedIndices);
            const maxIdx = Math.max(...checkedIndices);
            for (let i = minIdx; i <= maxIdx; i++) {
                checkboxes[i].dataset.checked = 'true';
                checkboxes[i].innerHTML = '<i class="fa-solid fa-check" style="font-size:11px;"></i>';
            }
        } else {
            toastr.info('请先手动勾选至少两个章节作为起点和终点！', '提示');
        }
    });

    const btnClearAll = doc.createElement('button');
    btnClearAll.className = 'menu_button';
    btnClearAll.style.cssText = btnStyle;
    btnClearAll.innerText = '清空';
    btnClearAll.addEventListener('click', (e) => {
        e.stopPropagation();
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            cb.dataset.checked = 'false';
            cb.innerHTML = '';
        });
    });

    const btnGenerate = doc.createElement('button');
    btnGenerate.className = 'menu_button';
    btnGenerate.style.cssText = 'padding: 2px 4px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; white-space: nowrap !important; background: var(--SmartThemeUnderlineColor, #007aff) !important; color: #fff !important; font-weight: bold !important; border: none !important; border-radius: 4px !important; display: inline-flex !important; align-items: center !important; gap: 2px !important; flex-shrink: 0 !important;';
    btnGenerate.innerHTML = '<i class="fa-regular fa-comment-dots"></i> 生成';

    const btnLog = doc.createElement('button');
    btnLog.className = 'menu_button';
    btnLog.style.cssText = 'padding: 2px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; min-width: 24px !important; height: 24px !important; width: 24px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; border-radius: 4px !important;';
    
    if (globalGenerationStatus === 'generating') {
        btnLog.title = '正在生成...';
        btnLog.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnLog.disabled = true;
    } else if (globalGenerationStatus === 'done') {
        btnLog.title = `查看生成日志 (共${globalBatchLogs.length}条)`;
        btnLog.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#4caf50;"></i>';
        btnLog.disabled = false;
    } else {
        btnLog.title = '查看生成日志 (暂无日志)';
        btnLog.innerHTML = '<i class="fa-solid fa-list" style="opacity: 0.5;"></i>';
        btnLog.disabled = false;
    }

    const showLogPanel = () => {
        const existingOverlay = doc.getElementById('twt-batch-log-overlay');
        if (existingOverlay) { existingOverlay.remove(); return; }

        if (!doc.getElementById('twt-log-panel-styles')) {
            const s = doc.createElement('style');
            s.id = 'twt-log-panel-styles';
            s.textContent = `
                #twt-batch-log-overlay {
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.6); z-index: 10005;
                    backdrop-filter: blur(3px);
                    display: flex; align-items: center; justify-content: center;
                }
                #twt-batch-log-panel {
                    position: relative; width: 90%; max-width: 600px;
                    height: 80vh;
                    background: var(--twt-comments-bg-solid, var(--SmartThemeBlurTintColor, #1e1e2e));
                    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15));
                    border-radius: 12px;
                    box-shadow: 0 10px 30px var(--SmartThemeShadowColor, rgba(0,0,0,0.5));
                    display: flex; flex-direction: column;
                    overflow: hidden;
                    font-size: 0.85em; color: var(--SmartThemeBodyColor, #e0e0e0);
                    z-index: 10006; box-sizing: border-box;
                    font-family: var(--SmartThemeFontFamily, sans-serif);
                }
                #twt-batch-log-panel-header {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 14px; flex-shrink: 0;
                    border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1));
                }
                #twt-batch-log-panel-body {
                    flex: 1; overflow-y: scroll; overflow-x: hidden;
                    min-height: 0;
                    padding: 10px 14px;
                    box-sizing: border-box;
                }
                #twt-batch-log-panel-body::-webkit-scrollbar { width: 6px; }
                #twt-batch-log-panel-body::-webkit-scrollbar-track { background: transparent; }
                #twt-batch-log-panel-body::-webkit-scrollbar-thumb {
                    background: var(--SmartThemeBorderColor, rgba(255,255,255,0.2));
                    border-radius: 3px;
                }
                .twt-log-card { 
                    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1));
                    border-radius: 6px; overflow: hidden; margin-bottom: 10px;
                }
                .twt-log-card:last-child { margin-bottom: 0; }
                .twt-log-card-head {
                    display: flex; align-items: center; gap: 8px; padding: 7px 10px;
                    cursor: pointer; background: rgba(255,255,255,0.03); user-select: none;
                }
                .twt-log-card-body {
                    display: none; padding: 8px 10px;
                    border-top: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.08));
                }
                .twt-log-card-body.open { display: block; }
                .twt-log-msg-block {
                    border-radius: 4px; overflow: hidden;
                    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.08));
                    margin-bottom: 6px;
                }
                .twt-log-msg-block:last-child { margin-bottom: 0; }
                .twt-log-pre {
                    margin: 0; padding: 6px 8px; white-space: pre-wrap;
                    word-break: break-all; font-family: inherit; font-size: 0.88em;
                    line-height: 1.5; max-height: 180px; overflow-y: auto;
                    overscroll-behavior: contain;
                }
                .twt-log-pre::-webkit-scrollbar { width: 4px; }
                .twt-log-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius:2px; }
            `;
            doc.head.appendChild(s);
        }

        const logOverlay = doc.createElement('div');
        logOverlay.id = 'twt-batch-log-overlay';
        logOverlay.addEventListener('click', () => logOverlay.remove());

        const panel = doc.createElement('div');
        panel.id = 'twt-batch-log-panel';
        panel.addEventListener('click', (e) => e.stopPropagation());

        const panelHeader = doc.createElement('div');
        panelHeader.id = 'twt-batch-log-panel-header';
        panelHeader.innerHTML = `<span style="font-weight:bold;font-size:1em;"><i class="fa-solid fa-clipboard-list" style="margin-right:6px;"></i>生成日志 (${globalBatchLogs.length}条)</span>`;
        const panelClose = doc.createElement('button');
        panelClose.className = 'menu_button';
        panelClose.style.cssText = 'padding:2px 6px !important; font-size:0.9em !important; margin:0 !important;';
        panelClose.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        panelClose.addEventListener('click', () => logOverlay.remove());
        panelHeader.appendChild(panelClose);
        panel.appendChild(panelHeader);

        const panelBody = doc.createElement('div');
        panelBody.id = 'twt-batch-log-panel-body';

        if (globalBatchLogs.length === 0) {
            panelBody.innerHTML = '<div style="opacity:0.5;text-align:center;padding:20px;">暂无日志</div>';
        } else {
            globalBatchLogs.forEach(entry => {
                const msgPreview = chatArray[entry.mesId]
                    ? (chatArray[entry.mesId].mes || '').substring(0, 40) + '...'
                    : `消息 #${entry.mesId}`;

                const statusColor = entry.status === 'ok' ? '#4caf50' : entry.status === 'empty' ? '#ff9800' : entry.status === 'skip' ? '#9e9e9e' : '#f44336';
                const statusIcon = entry.status === 'ok' ? 'fa-circle-check' : entry.status === 'empty' ? 'fa-circle-exclamation' : entry.status === 'skip' ? 'fa-circle-minus' : 'fa-circle-xmark';
                const statusLabel = entry.status === 'ok' ? `成功 (生成${entry.commentsCount}条段评)` : entry.status === 'empty' ? 'AI未返回段评' : entry.status === 'skip' ? '已跳过' : '失败';

                const card = doc.createElement('div');
                card.className = 'twt-log-card';

                const cardHead = doc.createElement('div');
                cardHead.className = 'twt-log-card-head';
                cardHead.innerHTML = `
                    <i class="fa-solid ${statusIcon}" style="color:${statusColor};flex-shrink:0;"></i>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">#${entry.mesId} ${escapeHtml(msgPreview)}</span>
                    <span style="color:${statusColor};white-space:nowrap;font-size:0.9em;">${statusLabel}</span>
                    <i class="fa-solid fa-chevron-down" style="font-size:0.8em;opacity:0.5;flex-shrink:0;"></i>
                `;

                const cardBody = doc.createElement('div');
                cardBody.className = 'twt-log-card-body';

                if (entry.error) {
                    const errDiv = doc.createElement('div');
                    errDiv.style.cssText = 'background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);border-radius:4px;padding:6px 8px;color:#f44336;white-space:pre-wrap;word-break:break-all;margin-bottom:6px;';
                    errDiv.textContent = '错误：' + entry.error;
                    cardBody.appendChild(errDiv);
                }

                if (entry.sentMessages && entry.sentMessages.length > 0) {
                    const promptLabel = doc.createElement('div');
                    promptLabel.style.cssText = 'font-weight:bold;opacity:0.7;font-size:0.9em;margin-bottom:4px;';
                    promptLabel.textContent = '发送的提示词：';
                    cardBody.appendChild(promptLabel);

                    entry.sentMessages.forEach((msg) => {
                        const msgBlock = doc.createElement('div');
                        msgBlock.className = 'twt-log-msg-block';
                        const roleTag = msg.role === 'system' ? '系统' : msg.role === 'user' ? '用户' : '助手';
                        const roleColor = msg.role === 'system' ? '#9c27b0' : msg.role === 'user' ? '#2196f3' : '#4caf50';
                        const msgHead = doc.createElement('div');
                        msgHead.style.cssText = `background:rgba(${msg.role === 'system' ? '156,39,176' : msg.role === 'user' ? '33,150,243' : '76,175,80'},0.15);padding:3px 8px;font-size:0.85em;font-weight:bold;color:${roleColor};`;
                        msgHead.textContent = `[${roleTag}]`;
                        const msgContent = doc.createElement('pre');
                        msgContent.className = 'twt-log-pre';
                        msgContent.textContent = msg.content || '';
                        msgBlock.appendChild(msgHead);
                        msgBlock.appendChild(msgContent);
                        cardBody.appendChild(msgBlock);
                    });
                }

                if (entry.rawResponse) {
                    const respLabel = doc.createElement('div');
                    respLabel.style.cssText = 'font-weight:bold;opacity:0.7;font-size:0.9em;margin-top:6px;margin-bottom:4px;';
                    respLabel.textContent = 'AI 原始回复：';
                    cardBody.appendChild(respLabel);
                    const respBlock = doc.createElement('pre');
                    respBlock.className = 'twt-log-pre';
                    respBlock.style.cssText += 'background:rgba(255,255,255,0.04);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,0.08));border-radius:4px;';
                    respBlock.textContent = entry.rawResponse;
                    cardBody.appendChild(respBlock);
                }

                let expanded = entry.status !== 'ok';
                if (expanded) {
                    cardBody.classList.add('open');
                    const chevron = cardHead.querySelector('.fa-chevron-down');
                    if (chevron) chevron.className = 'fa-solid fa-chevron-up';
                }
                cardHead.addEventListener('click', () => {
                    expanded = !expanded;
                    cardBody.classList.toggle('open', expanded);
                    const chevron = cardHead.querySelector('.fa-chevron-down, .fa-chevron-up');
                    if (chevron) chevron.className = `fa-solid fa-chevron-${expanded ? 'up' : 'down'}`;
                });

                card.appendChild(cardHead);
                card.appendChild(cardBody);
                panelBody.appendChild(card);
            });
        }

        panel.appendChild(panelBody);
        logOverlay.appendChild(panel);
        doc.body.appendChild(logOverlay);
    };

    btnLog.addEventListener('click', (e) => {
        e.stopPropagation();
        if (globalBatchLogs.length === 0) {
            toastr.info('暂无日志，请先开始生成段评', '提示');
            return;
        }
        showLogPanel();
    });

    const progressSpan = doc.createElement('span');
    progressSpan.style.cssText = 'font-size: 0.8em; opacity: 0.8; white-space: nowrap; display: none; margin-left: 3px;';
    progressSpan.innerText = '';

    btnGenerate.addEventListener('click', async (e) => {
        e.stopPropagation();
        const selectedCbs = listContainer.querySelectorAll('.twt-mulu-checkbox[data-checked="true"]');
        const selectedIds = Array.from(selectedCbs).map(cb => parseInt(cb.getAttribute('data-id')));
        if (selectedIds.length === 0) {
            toastr.warning('请先选择要生成段评的章节！', '提示');
            return;
        }

        globalBatchLogs = [];
        globalGenerationStatus = 'generating';

        btnLog.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnLog.title = '正在生成...';
        btnLog.disabled = true;

        btnSelectAll.disabled = true;
        btnReverseSelect.disabled = true;
        btnRangeSelect.disabled = true;
        btnClearAll.disabled = true;
        btnGenerate.disabled = true;

        progressSpan.style.display = 'inline';
        progressSpan.innerText = `准备中...`;

        try {
            const { triggerBatchCommentsForMessages } = await import('./paragraph.js');
            await triggerBatchCommentsForMessages(
                selectedIds,
                (current, total) => {
                    progressSpan.innerText = `${current}/${total}`;
                },
                (mesId, logEntry) => {
                    globalBatchLogs.push(logEntry);
                }
            );
            toastr.success('批量生成段评完成！', '成功');
            globalGenerationStatus = 'done';
        } catch (err) {
            console.error('Batch comments generation failed:', err);
            toastr.error(`生成失败: ${err.message || err}`, '错误');
            globalGenerationStatus = 'done';
        } finally {
            btnSelectAll.disabled = false;
            btnReverseSelect.disabled = false;
            btnRangeSelect.disabled = false;
            btnClearAll.disabled = false;
            btnGenerate.disabled = false;
            progressSpan.style.display = 'none';

            btnLog.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#4caf50;"></i>';
            btnLog.title = `查看生成日志 (共${globalBatchLogs.length}条)`;
            btnLog.disabled = false;

            exitBatchSelectMode();
        }
    });

    batchActionsContainer.appendChild(btnSelectAll);
    batchActionsContainer.appendChild(btnReverseSelect);
    batchActionsContainer.appendChild(btnRangeSelect);
    batchActionsContainer.appendChild(btnClearAll);
    batchActionsContainer.appendChild(btnGenerate);
    batchActionsContainer.appendChild(progressSpan);

    const headerActions = doc.createElement('div');
    headerActions.style.cssText = `
        display: flex;
        gap: 3px;
        align-items: center;
        flex-shrink: 0;
    `;

    const iconBtnStyle = 'padding: 2px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; min-width: 24px !important; height: 24px !important; width: 24px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important;';

    const batchSelectBtn = doc.createElement('button');
    batchSelectBtn.className = 'menu_button';
    batchSelectBtn.style.cssText = iconBtnStyle + ' background: rgba(255, 255, 255, 0.08);';
    batchSelectBtn.title = '批量生成段评';
    batchSelectBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
    batchSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isBatchMode = !isBatchMode;
        if (isBatchMode) {
            searchInput.style.display = 'none';
            batchActionsContainer.style.display = 'flex';
            batchSelectBtn.style.background = 'var(--SmartThemeUnderlineColor, #007aff)';
            listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => cb.style.display = 'inline-flex');
        } else {
            exitBatchSelectMode();
        }
    });

    const sortBtn = doc.createElement('button');
    sortBtn.className = 'menu_button';
    sortBtn.style.cssText = iconBtnStyle;
    sortBtn.title = sortOrder === 'asc' ? '当前：正序 (点击切换倒序)' : '当前：倒序 (点击切换正序)';
    sortBtn.innerHTML = sortOrder === 'asc' ? '<i class="fa-solid fa-sort-amount-down-alt"></i>' : '<i class="fa-solid fa-sort-amount-up"></i>';
    sortBtn.addEventListener('click', () => {
        settings.muluSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
        if (context && typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        }
        getOrBuildMuluOverlay(true);
        showMuluModal();
    });

    const closeBtn = doc.createElement('button');
    closeBtn.className = 'menu_button';
    closeBtn.style.cssText = iconBtnStyle;
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', closeMuluModal);

    if (commentsEnabled) {
        headerActions.appendChild(btnLog);
        headerActions.appendChild(batchSelectBtn);
    }
    headerActions.appendChild(sortBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(searchInput);
    header.appendChild(batchActionsContainer);
    header.appendChild(headerActions);
    modal.appendChild(header);

    const fragment = doc.createDocumentFragment();

    tocItems.forEach(item => {
        const row = doc.createElement('div');
        row.className = 'twt-mulu-row interactable';
        row.setAttribute('data-text', item.title);
        row.setAttribute('data-full-text', item.fullText);
        row.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding: 10px 15px;
            cursor: pointer;
            border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.05));
            transition: background-color 0.2s;
            box-sizing: border-box;
            width: 100%;
            overflow: hidden;
        `;

        const leftSpan = doc.createElement('span');
        const msgObj = chatArray[item.mesId];
        const isHidden = msgObj ? (msgObj.is_system || msgObj.extra?.is_system) : false;
        
        if (isHidden) {
            leftSpan.innerText = item.title + ' [已隐藏]';
            leftSpan.style.cssText = `
                flex: 0 1 auto;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: left;
                opacity: 0.55;
                text-decoration: line-through;
            `;
        } else {
            leftSpan.innerText = item.title;
            leftSpan.style.cssText = `
                flex: 0 1 auto;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: left;
            `;
        }

        const rightSpan = doc.createElement('span');
        rightSpan.innerText = `#${item.mesId}`;
        rightSpan.style.cssText = `
            color: var(--SmartThemeEmColor, var(--SmartThemeUnderlineColor, #00afff));
            font-size: 0.85em;
            opacity: 0.8;
            white-space: nowrap;
            flex-shrink: 0;
            margin-left: 8px;
        `;

        const checkbox = doc.createElement('div');
        checkbox.className = 'twt-mulu-checkbox';
        checkbox.setAttribute('data-id', item.mesId);
        checkbox.dataset.checked = 'false';
        checkbox.style.cssText = `
            margin-right: 10px;
            cursor: pointer;
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            display: none;
            border: 2px solid var(--SmartThemeUnderlineColor, #007aff);
            border-radius: 3px;
            background: transparent;
            align-items: center;
            justify-content: center;
            color: var(--SmartThemeUnderlineColor, #007aff);
            font-size: 11px;
            box-sizing: border-box;
            transition: background 0.15s;
            user-select: none;
        `;

        row.appendChild(checkbox);
        row.appendChild(leftSpan);
        row.appendChild(rightSpan);

        const toggleCheckbox = () => {
            const nowChecked = checkbox.dataset.checked !== 'true';
            checkbox.dataset.checked = String(nowChecked);
            checkbox.innerHTML = nowChecked ? '<i class="fa-solid fa-check" style="font-size:11px;"></i>' : '';
            checkbox.style.background = nowChecked ? 'rgba(var(--SmartThemeUnderlineColor-rgb, 0, 122, 255), 0.15)' : 'transparent';
        };

        row.addEventListener('click', async (e) => {
            if (isBatchMode) {
                toggleCheckbox();
                return;
            }
            closeMuluModal();
            await scrollToMessageOrNearest(item.mesId);
        });

        fragment.appendChild(row);
    });

    listContainer.appendChild(fragment);
    modal.appendChild(listContainer);

    const footer = doc.createElement('div');
    footer.style.cssText = `
        padding: 8px 15px;
        font-size: 0.8em;
        opacity: 0.6;
        text-align: right;
        border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.05));
        background: rgba(0, 0, 0, 0.1);
    `;
    footer.innerText = `共 ${tocItems.length} 条目录`;
    modal.appendChild(footer);

    overlay.appendChild(modal);

    cachedOverlay = overlay;
    cachedChatLength = chatArray.length;
    cachedLastMessageText = lastMsgText;
    cachedRegexStr = regexStr;
    cachedSortOrder = sortOrder;
    cachedCommentsEnabled = commentsEnabled;

    return overlay;
}

function showMuluModal() {
    const doc = getDoc();
    const overlay = getOrBuildMuluOverlay();
    if (!overlay) {
        toastr.error('无法生成目录');
        return;
    }
    
    const searchInput = overlay.querySelector('#twt-mulu-search');
    if (searchInput) {
        searchInput.value = '';
    }
    const rows = overlay.querySelectorAll('.twt-mulu-row');
    rows.forEach(row => row.style.display = 'flex');
    
    overlay.style.display = 'flex';
    if (!doc.body.contains(overlay)) {
        doc.body.appendChild(overlay);
    }
}

function closeMuluModal() {
    const doc = getDoc();
    const overlay = doc.getElementById('twt-mulu-overlay');
    if (overlay) overlay.style.display = 'none';
}

function getCleanText(mesText) {
    if (!mesText) return '';
    return mesText
        .replace(/<\/?[^>]+(>|$)/g, "") 
        .replace(/[\#\*\_`~\[\]\(\)\{\}\-\+\!]/g, "") 
        .trim();
}

function extractDirectoryTitle(text, regexStr) {
    if (!regexStr || regexStr.trim() === '') {
        return null;
    }
    try {
        const regex = new RegExp(regexStr, 'm');
        const match = text.match(regex);
        if (match) {
            if (match[1]) {
                return match[1].trim();
            }
            return match[0].trim();
        }
    } catch (e) {
        console.error('Regex match error:', e);
    }
    return null;
}

function scrollToMessage(mes) {
    if (!mes) return;
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;
    
    if (doc.body.classList.contains('twt-reading-mode')) {
        const chatRect = chatContainer.getBoundingClientRect();
        const cw = chatContainer.clientWidth;
        const currentScrollLeft = chatContainer.scrollLeft;
        const rect = mes.getBoundingClientRect();
        const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
        const targetPage = Math.floor(absoluteLeft / cw);
        chatContainer.scrollTo({ left: targetPage * cw, behavior: 'smooth' });
    } else {
        mes.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function scrollToMessageOrNearest(mesId) {
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;

    let targetMes = await ensureMessageLoaded(mesId);
    // Check if element exists and is visible (height > 0)
    if (targetMes && targetMes.getBoundingClientRect().height > 0) {
        scrollToMessage(targetMes);
        return;
    }

    // Find the nearest visible message element in DOM
    const context = typeof getContext === 'function' ? getContext() : null;
    const chatArray = context ? context.chat : window.chat;
    if (!chatArray) return;

    let nearestMesId = -1;
    let minDiff = Infinity;

    for (let i = 0; i < chatArray.length; i++) {
        const mesEl = doc.querySelector(`#chat .mes[mesid="${i}"]`);
        if (mesEl && mesEl.getBoundingClientRect().height > 0) {
            const diff = Math.abs(i - mesId);
            if (diff < minDiff) {
                minDiff = diff;
                nearestMesId = i;
            }
        }
    }

    if (nearestMesId !== -1) {
        const nearestMes = doc.querySelector(`#chat .mes[mesid="${nearestMesId}"]`);
        if (nearestMes) {
            scrollToMessage(nearestMes);
            toastr.info(`该消息已隐藏，已为您定位到邻近的第 ${nearestMesId} 条消息`, '提示');
            return;
        }
    }
    toastr.error('无法定位消息元素');
}

let prebuildTimeout = null;
function triggerBackgroundPrebuild() {
    clearTimeout(prebuildTimeout);
    prebuildTimeout = setTimeout(() => {
        const settings = extension_settings.twt;
        if (!settings || !settings.muluEnabled) return;
        
        const win = getWin();
        if (win && typeof win.requestIdleCallback === 'function') {
            win.requestIdleCallback(() => getOrBuildMuluOverlay());
        } else if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => getOrBuildMuluOverlay());
        } else {
            getOrBuildMuluOverlay();
        }
    }, 1500);
}

export function applyMuluSettings() {
    const settings = extension_settings.twt;
    if (!settings) return;

    const enabled = settings.muluEnabled;
    const doc = getDoc();
    
    const toggleBtn = (id, show, title, icon, action) => {
        let btn = doc.getElementById(id);
        if (enabled && show) {
            if (!btn) {
                btn = createButton(id, title, icon, action);
                const btnContainer = doc.querySelector('#qr--bar .qr--buttons') || doc.getElementById('qr--bar');
                if (btnContainer) {
                    btnContainer.prepend(btn);
                }
            }
        } else {
            if (btn) btn.remove();
        }
    };

    toggleBtn(BTN_END_ID, settings.muluBtnEnd, '跳至结尾 / 下一条', 'fa-angle-right', () => scrollToMessageEdge('end'));
    toggleBtn(BTN_TOC_ID, settings.muluBtnToc, '阅读目录', 'fa-book', showMuluModal);
    toggleBtn(BTN_START_ID, settings.muluBtnStart, '跳至开头 / 上一条', 'fa-angle-left', () => scrollToMessageEdge('start'));

    triggerBackgroundPrebuild();
}

export function initMulu() {
    const doc = getDoc();
    const win = getWin();
    const MutationObserverClass = win.MutationObserver || win.parent?.MutationObserver || window.MutationObserver;
    const observer = new MutationObserverClass(() => {
        const settings = extension_settings.twt;
        if (!settings || !settings.muluEnabled) return;

        const btnContainer = doc.querySelector('#qr--bar .qr--buttons') || doc.getElementById('qr--bar');
        if (btnContainer) {
            const hasEnd = doc.getElementById(BTN_END_ID);
            const hasToc = doc.getElementById(BTN_TOC_ID);
            const hasStart = doc.getElementById(BTN_START_ID);

            const needsEnd = settings.muluBtnEnd && !hasEnd;
            const needsToc = settings.muluBtnToc && !hasToc;
            const needsStart = settings.muluBtnStart && !hasStart;

            if (needsEnd || needsToc || needsStart) {
                applyMuluSettings();
            }
        }
        
        const context = typeof getContext === 'function' ? getContext() : null;
        const chatArray = context ? context.chat : window.chat;
        if (chatArray && chatArray.length !== cachedChatLength) {
            triggerBackgroundPrebuild();
        }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    
    setTimeout(applyMuluSettings, 1000);
}
