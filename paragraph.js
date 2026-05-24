// @ts-nocheck
import { extension_settings, getContext } from '../../../extensions.js';
import { scrollPageLeft, scrollPageRight } from './pagination.js';
import { getRegexedString, regex_placement } from '../../regex/engine.js';

// 使用本地 document 作为 modal 的挂载目标，防止跨文档/跨域限制或弹窗被 iframe 遮挡
const parentDoc = document;

// 获取当前可见视口的几何中心及高度（兼容宿主 iframe 与带 transforms 容器的定位）
function getVisibleCenter() {
    let top = 0;
    let height = window.innerHeight;
    let isIframeCentering = false;

    try {
        if (window.parent && window.parent !== window && window.parent.document) {
            const iframe = window.frameElement;
            if (iframe) {
                const rect = iframe.getBoundingClientRect();
                const parentHeight = window.parent.innerHeight;
                
                const visibleTop = Math.max(0, -rect.top);
                const visibleBottom = Math.min(rect.height || document.documentElement.scrollHeight, parentHeight - rect.top);
                
                top = visibleTop;
                height = visibleBottom - visibleTop;
                isIframeCentering = true;
            }
        }
    } catch (e) {
        console.warn("TwT: Cannot access parent window geometry, falling back to local positioning.", e);
    }

    if (!isIframeCentering) {
        // 后备本地窗口定位，支持带有 CSS transform 的外部滚动定位
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
        top = scrollTop;
        height = window.innerHeight || document.documentElement.clientHeight;
    }

    return {
        centerY: top + height / 2,
        visibleTop: top,
        visibleHeight: height
    };
}

// 同步宿主页面主题样式到 iframe
try {
    if (window.parent) {
        const pDoc = window.parent.document;
        if (pDoc && pDoc !== document) {
            const parentStyle = pDoc.documentElement.getAttribute('style');
            if (parentStyle) {
                document.documentElement.setAttribute('style', parentStyle);
            }
        }
    }
} catch (e) {
    console.warn("TwT: Cannot sync theme style from parent.", e);
}

// 动态加载 CSS 到当前 iframe 及宿主 parent 页面（使用基于模块地址 of 绝对 URL 并追加时间戳以防缓存）
function injectStyles() {
    const baseCssUrl = new URL('./paragraph.css', import.meta.url).href;
    const cssUrl = `${baseCssUrl}?v=${Date.now()}`;
    console.log("TwT: Injecting stylesheet from URL:", cssUrl);
    
    // 清理所有旧的 paragraph.css link 标签
    $('link[href*="paragraph.css"]').remove();
    
    $('<link>', {
        rel: 'stylesheet',
        type: 'text/css',
        href: cssUrl
    }).appendTo('head');
    
    try {
        if (window.parent) {
            const pDoc = window.parent.document;
            if (pDoc && pDoc !== document) {
                // 在宿主页面中也清理旧的 paragraph.css link
                pDoc.querySelectorAll('link[href*="paragraph.css"]').forEach(el => el.remove());
                
                const link = pDoc.createElement('link');
                link.rel = 'stylesheet';
                link.type = 'text/css';
                link.href = cssUrl;
                pDoc.head.appendChild(link);
            }
        }
    } catch (e) {
        console.error("TwT: Failed to inject styles into parent document", e);
    }
}
injectStyles();

/**
 * 辅助方法：将 <p> 元素内部根据 <br> 切分为独立的 block-like inline 元素，且 100% 保持排版高度
 */
function splitParagraphsByBr($mesText) {
    $mesText.find('p').each(function() {
        const $p = $(this);
        if ($p.find('br').length === 0) return;
        
        const newContents = [];
        let currentGroup = [];
        
        $p.contents().each(function() {
            if (this.nodeType === Node.ELEMENT_NODE && this.nodeName.toUpperCase() === 'BR') {
                if (currentGroup.length > 0) {
                    const $line = $('<span class="twt-p-line-wrapper" style="display: block; margin: 0; padding: 0; position: relative;"></span>');
                    $line.append(currentGroup);
                    newContents.push($line[0]);
                    currentGroup = [];
                }
            } else {
                currentGroup.push(this);
            }
        });
        
        if (currentGroup.length > 0) {
            const $line = $('<span class="twt-p-line-wrapper" style="display: block; margin: 0; padding: 0; position: relative;"></span>');
            $line.append(currentGroup);
            newContents.push($line[0]);
        }
        
        $p.empty().append(newContents);
    });
}

/**
 * 获取可选择的 DOM 叶子块级元素（使用高效的自顶向下递归，避免大规模 closest 调用，极大地提升手机端响应速度）
 */
function getSelectableElements($mesText) {
    // 首先根据 <br> 进行换行切分
    splitParagraphsByBr($mesText);
    
    const list = [];
    
    function traverse(node) {
        const $node = $(node);
        
        // 匹配块级或行级可选元素
        if ($node.is('p, span.twt-p-line-wrapper, li, pre, blockquote, h1, h2, h3, h4, h5, h6, hr, .thought-block')) {
            if ($node.is('p') && $node.find('span.twt-p-line-wrapper').length > 0) {
                // 如果是 p 且内部有换行切分包装，则深层遍历它的直接子节点
                $node.children().each(function() {
                    traverse(this);
                });
            } else {
                // 否则直接作为独立的叶子可选块收集，停止向内深层递归，提高效率
                list.push($node);
            }
            return;
        }
        
        // 对于非目标容器节点（如 div, ul, ol），继续向下递归遍历其子节点
        $node.children().each(function() {
            traverse(this);
        });
    }
    
    $mesText.children().each(function() {
        traverse(this);
    });
    
    return list;
}

/**
 * 智能解析 Markdown 段落、代码块、引用块及列表项等
 */
export function parseMarkdownToBlocks(text, whitelist = []) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const blocks = [];
    
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // 1. 空行
        if (trimmed === '') {
            blocks.push({
                type: 'empty',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: false
            });
            i++;
            continue;
        }
        
        // 2. 代码块
        if (trimmed.startsWith('```')) {
            let codeLines = [line];
            i++;
            while (i < lines.length) {
                const subLine = lines[i];
                codeLines.push(subLine);
                if (subLine.trim().startsWith('```')) {
                    i++;
                    break;
                }
                i++;
            }
            const blockContent = codeLines.join('\n');
            blocks.push({
                type: 'code',
                original: blockContent,
                current: blockContent,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            continue;
        }

        // 3. XML标签白名单 (例如思考链)
        const openMatch = trimmed.match(/^<([a-zA-Z0-9_-]+)>$/);
        const isOpenTagInWhitelist = openMatch && whitelist.includes(openMatch[1].toLowerCase());
        if (isOpenTagInWhitelist) {
            const tagName = openMatch[1].toLowerCase();
            let xmlLines = [line];
            let openCount = 1;
            i++;
            while (i < lines.length) {
                const subLine = lines[i];
                const subTrim = subLine.trim();
                xmlLines.push(subLine);
                
                if (subTrim === `<${tagName}>`) {
                    openCount++;
                } else if (subTrim === `</${tagName}>`) {
                    openCount--;
                    if (openCount === 0) {
                        i++;
                        break;
                    }
                }
                i++;
            }
            const blockContent = xmlLines.join('\n');
            blocks.push({
                type: 'xml',
                original: blockContent,
                current: blockContent,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            continue;
        }
        
        // 4. 引用块
        if (trimmed.startsWith('>') || trimmed.startsWith('&gt;')) {
            let quoteLines = [line];
            i++;
            while (i < lines.length) {
                const subLine = lines[i];
                const subTrimmed = subLine.trim();
                if (subTrimmed.startsWith('>') || subTrimmed.startsWith('&gt;')) {
                    quoteLines.push(subLine);
                    i++;
                } else if (subTrimmed === '') {
                    let nextIsQuote = false;
                    let nextIdx = i + 1;
                    while (nextIdx < lines.length) {
                        const nextTrim = lines[nextIdx].trim();
                        if (nextTrim === '') {
                            nextIdx++;
                        } else {
                            if (nextTrim.startsWith('>') || nextTrim.startsWith('&gt;')) {
                                nextIsQuote = true;
                            }
                            break;
                        }
                    }
                    if (nextIsQuote) {
                        quoteLines.push(subLine);
                        i++;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            const blockContent = quoteLines.join('\n');
            blocks.push({
                type: 'quote',
                original: blockContent,
                current: blockContent,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            continue;
        }
        
        // 5. 标题
        if (trimmed.startsWith('#')) {
            blocks.push({
                type: 'header',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            i++;
            continue;
        }
        
        // 6. 水平分割线
        if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
            blocks.push({
                type: 'hr',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            i++;
            continue;
        }
        
        // 7. 列表项
        if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
            blocks.push({
                type: 'list-item',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            i++;
            continue;
        }
        
        // 8. 单行段落（不在上面规则内的，全部按独立单行作为段落处理，从而完美映射没有空行的单独段落）
        blocks.push({
            type: 'paragraph',
            original: line,
            current: line,
            isEdited: false,
            isDeleted: false,
            isVisible: true
        });
        i++;
    }
    
    return blocks;
}

/**
 * 原设计兼容：保留 parseParagraphs 方法
 */
export function parseParagraphs(text, whitelist = []) {
    return parseMarkdownToBlocks(text, whitelist).map(b => b.original);
}

/**
 * 原地打开段落编辑器（零 Layout Shift 版）
 * @param {number} mesId 
 * @param {number} [clickX]
 * @param {number} [clickY]
 */
export function openParagraphEditor(mesId, clickX = null, clickY = null) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    const $mes = $(`.mes[mesid="${mesId}"]`);
    if (!$mes.length) return;
    const $mesText = $mes.find('.mes_text');
    if (!$mesText.length) return;

    // 防止重复触发
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    // 读取自定义设置与正则过滤标志
    const settings = extension_settings.twt || {};
    const useFiltered = settings.menuOptEditFiltered ?? false;
    const toolbarBottom = settings.paragraphToolbarBottom !== undefined ? settings.paragraphToolbarBottom : 15;
    const iconSize = settings.paragraphIconSize !== undefined ? settings.paragraphIconSize : 20;

    const whitelistStr = settings.paragraphXmlWhitelist || 'thought, TavernThought, reasoning, details';
    const whitelist = whitelistStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // 锁住 #chat 的高度，防止移动端键盘弹出时布局重排/自动翻页
    const $chat = $('#chat');
    let originalChatStyle = '';
    if ($chat.length) {
        originalChatStyle = $chat.attr('style') || '';
        const currentHeight = $chat.outerHeight();
        $chat.css('cssText', $chat.attr('style') + `; height: ${currentHeight}px !important; max-height: none !important;`);
    }

    // 保存原始消息内容（用于取消时恢复）
    const originalText = message.mes || '';
    
    // 保存原始 HTML 用于取消时恢复（注意：这是渲染后的 HTML，不是原始文本）
    const originalHtml = $mesText.html();
    
    // 解析原始文本的段落块
    const originalBlocks = parseMarkdownToBlocks(originalText, whitelist);
    
    // 构建 block 状态对象
    const placement = message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    let blocks = [];
    
    if (useFiltered) {
        // 先对整个文本应用正则过滤，保留完整的多行标签匹配
        const filteredWholeText = getRegexedString(originalText, placement, { isMarkdown: true });
        const filteredBlocks = parseMarkdownToBlocks(filteredWholeText, whitelist);
        
        const origVisible = originalBlocks.filter(b => b.isVisible);
        const filtVisible = filteredBlocks.filter(b => b.isVisible);
        
        const N = origVisible.length;
        const M = filtVisible.length;
        
        const getSimilarity = (a, b) => {
            if (a === b) return 1.0;
            if (!a || !b) return 0.0;
            const charsA = new Set(a);
            const charsB = new Set(b);
            let intersection = 0;
            for (const c of charsA) {
                if (charsB.has(c)) intersection++;
            }
            const union = charsA.size + charsB.size - intersection;
            if (union === 0) return 0.0;
            return intersection / union;
        };
        
        // dp[i][j] 记录最大匹配得分
        const dp = Array.from({ length: N + 1 }, () => Array(M + 1).fill(0));
        const parent = Array.from({ length: N + 1 }, () => Array(M + 1).fill(''));
        
        for (let i = 1; i <= N; i++) {
            for (let j = 1; j <= M; j++) {
                const sim = getSimilarity(origVisible[i-1].original, filtVisible[j-1].original);
                let matchScore = -1;
                if (sim > 0.15) {
                    matchScore = dp[i-1][j-1] + sim;
                }
                const skipOrigScore = dp[i-1][j];
                const skipFiltScore = dp[i][j-1];
                
                if (matchScore >= skipOrigScore && matchScore >= skipFiltScore) {
                    dp[i][j] = matchScore;
                    parent[i][j] = 'match';
                } else if (skipOrigScore >= skipFiltScore) {
                    dp[i][j] = skipOrigScore;
                    parent[i][j] = 'skip_orig';
                } else {
                    dp[i][j] = skipFiltScore;
                    parent[i][j] = 'skip_filt';
                }
            }
        }
        
        let i = N, j = M;
        const alignment = new Array(N).fill(-1);
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && parent[i][j] === 'match') {
                alignment[i-1] = j-1;
                i--;
                j--;
            } else if (i > 0 && (j === 0 || parent[i][j] === 'skip_orig')) {
                alignment[i-1] = -1;
                i--;
            } else {
                j--;
            }
        }
        
        let visibleIdx = 0;
        blocks = originalBlocks.map((block) => {
            if (!block.isVisible) {
                return block;
            }
            const matchedIdx = alignment[visibleIdx];
            const isVisible = matchedIdx !== -1;
            const filtered = isVisible ? filtVisible[matchedIdx].original : '';
            visibleIdx++;
            return {
                ...block,
                filtered: filtered,
                current: filtered,
                isEdited: false,
                isDeleted: false,
                isVisible: isVisible
            };
        });
    } else {
        blocks = originalBlocks.map(block => {
            return {
                ...block,
                filtered: block.original,
                current: block.original,
                isEdited: false,
                isDeleted: false
            };
        });
    }

    // ── 将工具栏添加到 #chat 的父容器中，防止它跟随 #chat 横向翻页滚动 ──
    const $chatParent = $('#chat').parent();
    if ($chatParent.length && $chatParent.css('position') === 'static') {
        $chatParent.css('position', 'relative');
    }

    const $toolbar = $(`
        <div id="twt-paragraph-toolbar" class="twt-p-toolbar-wrap" style="bottom: ${toolbarBottom}px; --twt-paragraph-icon-size: ${iconSize}px;">
            <div class="twt-p-toolbar-inner">
                <button class="twt-p-btn twt-p-btn-page" id="twt-p-prev" title="上一页"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="twt-p-btn twt-p-btn-danger" id="twt-p-delete" title="删除所选段落"><i class="fa-solid fa-trash"></i></button>
                <button class="twt-p-btn twt-p-btn-normal" id="twt-p-edit" title="编辑所选段落"><i class="fa-solid fa-pen"></i></button>
                <button class="twt-p-btn twt-p-btn-normal" id="twt-p-cancel" title="取消编辑"><i class="fa-solid fa-xmark"></i></button>
                <button class="twt-p-btn twt-p-btn-primary" id="twt-p-save" title="确认保存"><i class="fa-solid fa-check"></i></button>
                <button class="twt-p-btn twt-p-btn-page" id="twt-p-next" title="下一页"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>
    `).appendTo($chatParent.length ? $chatParent : 'body');

    // ── 进入编辑模式 ─────────────────
    document.body.classList.add('twt-paragraph-editing');

    // 获取当前 HTML 中所有的块级元素并映射
    const $elements = getSelectableElements($mesText);
    
    let blockIdx = 0;
    let elementIdx = 0;
    const visibleBlocks = blocks.filter(b => b.isVisible);
    
    while (blockIdx < visibleBlocks.length && elementIdx < $elements.length) {
        const block = visibleBlocks[blockIdx];
        const $el = $elements[elementIdx];
        
        // 检测 DOM 元素是否属于思考链块
        const isDomThought = $el.hasClass('thought-block') || $el.closest('.thought-block').length > 0 || $el.is('blockquote');
        
        // 如果是 XML（比如 <thought>）块，但当前 DOM 元素不是思考链/引用容器，说明它是非渲染的隐藏块，跳过该块
        if (block.type === 'xml' && !isDomThought) {
            blockIdx++;
            continue;
        }
        
        $el.addClass('twt-p-selectable');
        // 将可见块对应的原始 blocks 索引赋值给 data-twt-block-idx
        const originalIdx = blocks.indexOf(block);
        $el.attr('data-twt-block-idx', originalIdx);
        
        blockIdx++;
        elementIdx++;
    }

    // 如果传入了点击坐标，根据屏幕物理坐标计算并默认选中物理位置最近的段落块
    if (clickX !== null && clickY !== null) {
        let minDistance = Infinity;
        let $targetBlock = null;
        
        $elements.forEach(($el) => {
            const rect = $el[0].getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.hypot(clickX - centerX, clickY - centerY);
            
            if (distance < minDistance) {
                minDistance = distance;
                $targetBlock = $el;
            }
        });
        
        if ($targetBlock) {
            $targetBlock.addClass('twt-p-selected');
            console.log(`TwT: Auto-selected closest paragraph at block index ${$targetBlock.attr('data-twt-block-idx')} via screen coordinates`);
        }
    }

    // 监听选择点击事件
    $mesText.off('.twt-paragraph-edit').on('click.twt-paragraph-edit', '.twt-p-selectable', function(e) {
        e.stopPropagation();
        if ($(e.target).closest('button, a, input, textarea, select, .twt-p-editor').length) return;
        $(this).toggleClass('twt-p-selected');
    });

    // ── 清理并退出编辑模式 ──────────────────────────────────────────
    function exitEditMode() {
        $mesText.off('.twt-paragraph-edit');
        document.body.classList.remove('twt-paragraph-editing');
        $toolbar.remove();
        const oldModal = parentDoc.getElementById('twt-p-modal');
        if (oldModal) {
            oldModal.remove();
        }
        if ($chat.length) {
            $chat.attr('style', originalChatStyle);
        }
    }

    // ── 更新 DOM 选择器上的删除、已编辑状态 ──
    function updateDomStates() {
        let elIdx = 0;
        blocks.forEach((block, blockIdx) => {
            if (!block.isVisible) return;
            if (elIdx < $elements.length) {
                const $el = $elements[elIdx];
                if (block.isDeleted || block.isEdited) {
                    $el.removeClass('twt-p-selected');
                }
                $el.toggleClass('twt-p-deleted', !!block.isDeleted);
                $el.toggleClass('twt-p-edited', !!block.isEdited);
                elIdx++;
            }
        });
    }

    // ── 左右翻页按钮动作 ─────────────────────────────────────────
    $toolbar.find('#twt-p-prev').on('click', (e) => {
        e.stopPropagation();
        scrollPageLeft();
    });

    $toolbar.find('#twt-p-next').on('click', (e) => {
        e.stopPropagation();
        scrollPageRight();
    });

    // ── 取消编辑 ───────────────────────────────────────────────────
    $toolbar.find('#twt-p-cancel').on('click', (e) => {
        e.stopPropagation();
        exitEditMode();
        $mesText.html(originalHtml);
    });

    // ── 删除段落 ───────────────────────────────────────────────────
    $toolbar.find('#twt-p-delete').on('click', (e) => {
        e.stopPropagation();

        const checkedIndices = [];
        $mesText.find('.twt-p-selectable.twt-p-selected').each(function() {
            checkedIndices.push(Number($(this).attr('data-twt-block-idx')));
        });

        if (checkedIndices.length === 0) {
            alert('请先点击选择需要删除的段落！');
            return;
        }

        if (confirm(`确定要删除选中的 ${checkedIndices.length} 个段落吗？`)) {
            checkedIndices.forEach(idx => {
                blocks[idx].isDeleted = true;
            });
            updateDomStates();
        }
    });

    // ── 段落修改编辑（支持单段落或相邻多段落合并编辑） ─────────────────
    $toolbar.find('#twt-p-edit').on('click', (e) => {
        e.stopPropagation();

        try {
            const $checked = $mesText.find('.twt-p-selectable.twt-p-selected');
            if ($checked.length === 0) {
                alert('请先点击选择需要编辑的段落！');
                return;
            }

            // 检查选中的段落是否在 DOM 中相邻（连续）
            const selectedDomIndices = [];
            $elements.forEach(($el, idx) => {
                if ($el.hasClass('twt-p-selected')) {
                    selectedDomIndices.push(idx);
                }
            });

            let isContiguous = true;
            for (let i = 1; i < selectedDomIndices.length; i++) {
                if (selectedDomIndices[i] !== selectedDomIndices[i - 1] + 1) {
                    isContiguous = false;
                    break;
                }
            }

            if (!isContiguous) {
                alert('仅支持合并编辑相邻的段落！');
                return;
            }

            // 收集选中段落的 blocks 索引并排序
            const sortedBlockIndices = [];
            $checked.each(function() {
                sortedBlockIndices.push(Number($(this).attr('data-twt-block-idx')));
            });
            sortedBlockIndices.sort((a, b) => a - b);

            // 合并选中段落的内容
            const mergedText = sortedBlockIndices.map(idx => blocks[idx].current).join('\n');

            // 移除可能已存在的旧弹窗
            const oldModal = parentDoc.getElementById('twt-p-modal');
            if (oldModal) {
                oldModal.remove();
            }

            // 创建弹窗元素
            const modalEl = parentDoc.createElement('div');
            modalEl.id = 'twt-p-modal';
            modalEl.className = 'twt-p-modal-overlay';
            modalEl.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; z-index: 999999; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);';
            modalEl.innerHTML = `
                <div class="twt-p-modal-box" style="position: absolute; left: 50%; transform: translate(-50%, -50%); width: calc(100% - 32px); max-width: 600px; padding: 20px; border-radius: 14px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; background: var(--SmartThemeBlurTintColor, #1e1e2e); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);">
                    <div class="twt-p-modal-header" style="font-size: 0.95em; font-weight: bold; opacity: 0.75; color: var(--SmartThemeBodyColor, #e0e0e0); padding-bottom: 6px; border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.12));">编辑段落</div>
                    <textarea class="twt-p-modal-textarea" style="width: 100%; box-sizing: border-box; background: var(--SmartThemeDarkColor, rgba(0,0,0,0.25)); color: var(--SmartThemeBodyColor, #ffffff); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-radius: 8px; padding: 10px 12px; font-family: inherit; font-size: 1em; line-height: 1.6; resize: none; overflow-y: auto; min-height: 100px; outline: none;"></textarea>
                    <div class="twt-p-modal-actions" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
                        <button class="twt-p-modal-btn twt-p-modal-cancel" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 8px; font-size: 0.9em; cursor: pointer; border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); background: var(--SmartThemeDarkColor, rgba(255,255,255,0.08)); color: var(--SmartThemeBodyColor, #ffffff); outline: none;"><i class="fa-solid fa-xmark"></i> 取消</button>
                        <button class="twt-p-modal-btn twt-p-modal-confirm" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 8px; font-size: 0.9em; cursor: pointer; border: none; background: var(--SmartThemeUnderlineColor, var(--SmartThemePrimaryColor, #007aff)); color: #ffffff; font-weight: bold; outline: none;"><i class="fa-solid fa-check"></i> 确定</button>
                    </div>
                </div>
            `;
            parentDoc.body.appendChild(modalEl);

            const $modal = $(modalEl);
            const $textarea = $modal.find('.twt-p-modal-textarea');
            $textarea.val(mergedText);

            // 动态定位弹窗，使其完美垂直居中在用户的可见视口内
            const repositionModal = () => {
                const { centerY, visibleHeight } = getVisibleCenter();
                const docHeight = Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight,
                    window.innerHeight
                );
                modalEl.style.height = docHeight + 'px';
                
                const $box = $modal.find('.twt-p-modal-box');
                $box.css({
                    position: 'absolute',
                    top: centerY + 'px',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                });
                
                $textarea.css('height', 'auto');
                const sh = $textarea[0].scrollHeight;
                const maxTaHeight = Math.max(100, Math.min(sh + 2, visibleHeight * 0.4, 300));
                $textarea.css('height', maxTaHeight + 'px');
            };

            $textarea.on('input', repositionModal);

            const handleScrollResize = () => {
                requestAnimationFrame(repositionModal);
            };

            window.addEventListener('resize', handleScrollResize);
            window.addEventListener('scroll', handleScrollResize);
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.addEventListener('resize', handleScrollResize);
                    window.parent.addEventListener('scroll', handleScrollResize);
                }
            } catch (e) {
                console.warn("TwT: Cannot bind listener to window.parent", e);
            }
            
            // 支持 Ctrl+Enter 确认提交
            $textarea.on('keydown', (ev) => {
                if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                    ev.preventDefault();
                    $modal.find('.twt-p-modal-confirm').trigger('click');
                }
            });

            requestAnimationFrame(() => {
                repositionModal();
                $textarea[0].focus();
                const len = $textarea.val().length;
                $textarea[0].setSelectionRange(len, len);
            });

            const closeModal = () => {
                window.removeEventListener('resize', handleScrollResize);
                window.removeEventListener('scroll', handleScrollResize);
                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.removeEventListener('resize', handleScrollResize);
                        window.parent.removeEventListener('scroll', handleScrollResize);
                    }
                } catch (e) {}
                $modal.remove();
            };

            // 点击遮罩层关闭
            $modal.on('click', function(ev) {
                if (ev.target === this) closeModal();
            });

            $modal.find('.twt-p-modal-cancel').on('click', (ev) => {
                ev.stopPropagation();
                closeModal();
            });

            $modal.find('.twt-p-modal-confirm').on('click', (ev) => {
                ev.stopPropagation();
                const newText = $textarea.val();
                
                // 将编辑后的合并文本写入第一个选中块中
                const targetIdx = sortedBlockIndices[0];
                blocks[targetIdx].current = newText;
                blocks[targetIdx].isEdited = true;
                blocks[targetIdx].isDeleted = false; // edited overrides deletion
                
                // 将其余被合并编辑的块以及中间的空白/空白行段落标记为删除，防止保存后产生多余空行
                const lastIdx = sortedBlockIndices[sortedBlockIndices.length - 1];
                for (let i = targetIdx + 1; i <= lastIdx; i++) {
                    if (sortedBlockIndices.includes(i) || blocks[i].current.trim() === '') {
                        blocks[i].isDeleted = true;
                    }
                }

                updateDomStates();
                closeModal();
            });
        } catch (err) {
            console.error("TwT: Error opening paragraph editor:", err);
            if (typeof toastr !== 'undefined') {
                toastr.error(`打开编辑器失败: ${err.message}`);
            } else {
                alert(`打开编辑器失败: ${err.message}`);
            }
        }
    });

    // ── 保存所有修改 ───────────────────────────────────────────────
    $toolbar.find('#twt-p-save').on('click', async (e) => {
        e.stopPropagation();

        const openModalEl = parentDoc.getElementById('twt-p-modal');
        if (openModalEl) {
            const $openModal = $(openModalEl);
            const $ta = $openModal.find('.twt-p-modal-textarea');
            const $sel = $mesText.find('.twt-p-selectable.twt-p-selected');
            if ($sel.length === 1) {
                const idx = Number($sel.attr('data-twt-block-idx'));
                if (!isNaN(idx)) {
                    blocks[idx].current = $ta.val();
                    blocks[idx].isEdited = true;
                    blocks[idx].isDeleted = false;
                }
            }
            openModalEl.remove();
        }

        // 重新组合成完整文本
        const finalBlocks = [];
        blocks.forEach(block => {
            if (block.isDeleted) return;
            if (block.isEdited) {
                finalBlocks.push(block.current);
            } else {
                finalBlocks.push(block.original);
            }
        });

        const finalContent = finalBlocks.join('\n');
        
        // 更新消息对象的原始文本
        message.mes = finalContent;

        // 退出编辑模式
        exitEditMode();
        
        // 让酒馆重新渲染消息块并保存
        await context.updateMessageBlock(mesId, message, { rerenderMessage: true });
        await context.saveChat();
    });
}