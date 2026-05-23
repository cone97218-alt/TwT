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

// 动态加载 CSS 到当前 iframe 及宿主 parent 页面（使用基于模块地址的绝对 URL 以防相对路径 404）
function injectStyles() {
    const cssUrl = new URL('./paragraph.css', import.meta.url).href;
    console.log("TwT: Injecting stylesheet from absolute URL:", cssUrl);
    
    // 清理可能已存在的、非绝对路径的、可能导致 404 的旧 paragraph.css link 标签
    $('link[href*="paragraph.css"]').not(`[href="${cssUrl}"]`).remove();
    
    if (!$(`link[href="${cssUrl}"]`).length) {
        $('<link>', {
            rel: 'stylesheet',
            type: 'text/css',
            href: cssUrl
        }).appendTo('head');
    }
    try {
        if (window.parent) {
            const pDoc = window.parent.document;
            if (pDoc && pDoc !== document) {
                // 在宿主页面中也清理旧的/相对路径的 paragraph.css link
                pDoc.querySelectorAll('link[href*="paragraph.css"]').forEach(el => {
                    if (el.getAttribute('href') !== cssUrl) el.remove();
                });
                
                if (!pDoc.querySelector(`link[href="${cssUrl}"]`)) {
                    const link = pDoc.createElement('link');
                    link.rel = 'stylesheet';
                    link.type = 'text/css';
                    link.href = cssUrl;
                    pDoc.head.appendChild(link);
                }
            }
        }
    } catch (e) {
        console.error("TwT: Failed to inject styles into parent document", e);
    }
}
injectStyles();

/**
 * 智能解析段落，按单行分段，但跳过代码块和 XML 标签内部
 */
export function parseParagraphs(text, whitelist = []) {
    if (!text) return [];
    const lines = text.split('\n');
    const blocks = [];
    let currentBlock = [];
    let insideCodeBlock = false;
    let openTagsStack = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        if (trimmed.startsWith('```')) {
            insideCodeBlock = !insideCodeBlock;
        }
        
        const openMatch = trimmed.match(/^<([a-zA-Z0-9_-]+)>$/);
        const closeMatch = trimmed.match(/^<\/([a-zA-Z0-9_-]+)>$/);
        
        const isOpenTagInWhitelist = openMatch && whitelist.includes(openMatch[1].toLowerCase());
        const isCloseTagInWhitelist = closeMatch && whitelist.includes(closeMatch[1].toLowerCase());
        
        if (isOpenTagInWhitelist && !insideCodeBlock) {
            openTagsStack.push(openMatch[1]);
        } else if (isCloseTagInWhitelist && !insideCodeBlock) {
            if (openTagsStack.length > 0 && openTagsStack[openTagsStack.length - 1].toLowerCase() === closeMatch[1].toLowerCase()) {
                openTagsStack.pop();
            }
        }
        
        const isInsideBlock = insideCodeBlock || openTagsStack.length > 0;
        
        if (isInsideBlock) {
            currentBlock.push(line);
        } else {
            if (currentBlock.length > 0) {
                currentBlock.push(line);
                blocks.push(currentBlock.join('\n'));
                currentBlock = [];
            } else {
                blocks.push(line);
            }
        }
    }
    
    if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
    }
    
    return blocks;
}

/**
 * 原地打开段落编辑器（内联勾选模式）
 * @param {number} mesId 
 */
export function openParagraphEditor(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    const $mes = $(`.mes[mesid="${mesId}"]`);
    if (!$mes.length) return;
    const $mesText = $mes.find('.mes_text');
    if (!$mesText.length) return;

    // 防止重复触发
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    // 再次同步一次宿主页面的 CSS 变量，确保主题颜色最新
    try {
        if (window.parent && window.parent.document && window.parent.document !== document) {
            const parentStyle = window.parent.document.documentElement.getAttribute('style');
            if (parentStyle) {
                document.documentElement.setAttribute('style', parentStyle);
            }
        }
    } catch (e) {
        console.warn("TwT: Cannot sync theme style from parent on editor open.", e);
    }

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
    const originalBlocks = parseParagraphs(originalText, whitelist);
    
    // 构建 block 状态对象
    const placement = message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    let blocks = [];
    
    if (useFiltered) {
        // 先对整个文本应用正则过滤，保留完整的多行标签匹配
        const filteredWholeText = getRegexedString(originalText, placement, { isMarkdown: true });
        // 解析过滤后文本的段落块
        const filteredBlocks = parseParagraphs(filteredWholeText, whitelist);
        
        // 计算两个块列表的对齐关系
        const N = originalBlocks.length;
        const M = filteredBlocks.length;
        
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
                const sim = getSimilarity(originalBlocks[i-1], filteredBlocks[j-1]);
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
        
        blocks = originalBlocks.map((blockText, idx) => {
            const matchedIdx = alignment[idx];
            const isVisible = matchedIdx !== -1;
            const filtered = isVisible ? filteredBlocks[matchedIdx] : '';
            return {
                original: blockText,
                filtered: filtered,
                current: filtered,
                isEdited: false,
                isDeleted: false,
                isVisible: isVisible
            };
        });
    } else {
        blocks = originalBlocks.map(blockText => {
            return {
                original: blockText,
                filtered: blockText,
                current: blockText,
                isEdited: false,
                isDeleted: false,
                isVisible: true
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

    // ── 内联列表容器放在消息文本中 ──────────────────────────────
    const $container = $('<div class="twt-p-container"></div>');

    // 检测当前主题/CSS美化的 <p> 标签样式
    try {
        const firstP = $('#chat .mes_text p').get(0);
        if (firstP) {
            const computed = window.getComputedStyle(firstP);
            const mb = parseFloat(computed.marginBottom) || 0;
            const pb = parseFloat(computed.paddingBottom) || 0;
            const mt = parseFloat(computed.marginTop) || 0;
            
            let spacing = '0.8em';
            if (mb > 0) spacing = computed.marginBottom;
            else if (pb > 0) spacing = computed.paddingBottom;
            else if (mt > 0) spacing = computed.marginTop;
            
            $container.css({
                '--twt-detected-p-spacing': spacing,
                '--twt-detected-p-font-size': computed.fontSize,
                '--twt-detected-p-line-height': computed.lineHeight,
                '--twt-detected-p-text-align': computed.textAlign,
                '--twt-detected-p-letter-spacing': computed.letterSpacing,
                '--twt-detected-p-text-indent': computed.textIndent,
                '--twt-detected-p-color': computed.color
            });
        }
    } catch (e) {
        console.warn("TwT: Failed to detect theme paragraph styles", e);
    }

    // ── 进入编辑模式，屏蔽点击翻页 and 手势滑动翻页 ─────────────────
    document.body.classList.add('twt-paragraph-editing');

    // 渲染段落列表
    function renderInlineList() {
        $container.empty();
        let hasVisibleBlocks = false;

        blocks.forEach((block, index) => {
            if (block.isDeleted) return;
            if (!block.isVisible) return;

            if (block.current.trim() === '') {
                $container.append('<div class="twt-p-spacer"></div>');
                return;
            }

            hasVisibleBlocks = true;

            const $item = $(`
                <div class="twt-p-item" data-index="${index}">
                    <div class="twt-p-text"></div>
                </div>
            `);

            $item.find('.twt-p-text').text(block.current);

            // 当点击段落项时，切换选中状态
            $item.on('click', function(e) {
                // 如果正在编辑当前段落（点击发生在编辑器内部），不触发选中切换
                if ($(e.target).closest('.twt-p-editor').length) return;
                $(this).toggleClass('twt-p-selected');
                const isSelected = $(this).hasClass('twt-p-selected');
                console.log(`TwT: Paragraph item ${index} clicked. Selected status: ${isSelected}`);
            });

            $container.append($item);
        });

        if (!hasVisibleBlocks) {
            $container.append('<div class="twt-p-empty">段落已被清空</div>');
        }
    }

    renderInlineList();
    $mesText.empty().append($container);

    // ── 清理并退出编辑模式 ──────────────────────────────────────────
    function exitEditMode() {
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
        $container.find('.twt-p-item.twt-p-selected').each(function() {
            checkedIndices.push(Number($(this).attr('data-index')));
        });

        if (checkedIndices.length === 0) {
            alert('请先点击选择需要删除的段落！');
            return;
        }

        if (confirm(`确定要删除选中的 ${checkedIndices.length} 个段落吗？`)) {
            checkedIndices.sort((a, b) => a - b);
            const targetIdx = checkedIndices[0];
            const lastIdx = checkedIndices[checkedIndices.length - 1];
            for (let i = targetIdx; i <= lastIdx; i++) {
                if (checkedIndices.includes(i) || blocks[i].current.trim() === '') {
                    blocks[i].isDeleted = true;
                }
            }
            renderInlineList();
        }
    });

    // ── 段落修改编辑（支持单段落或相邻多段落合并编辑） ─────────────────
    $toolbar.find('#twt-p-edit').on('click', (e) => {
        e.stopPropagation();
        console.log("TwT: Edit button (#twt-p-edit) clicked.");

        try {
            const $checked = $container.find('.twt-p-item.twt-p-selected');
            console.log("TwT: Number of selected paragraphs:", $checked.length);
            if ($checked.length === 0) {
                alert('请先选择需要编辑的段落！');
                return;
            }

            // 检查选中的段落是否在 DOM 中相邻（连续）
            const $allItems = $container.find('.twt-p-item');
            const selectedDomIndices = [];
            $allItems.each(function(idx) {
                if ($(this).hasClass('twt-p-selected')) {
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
                sortedBlockIndices.push(Number($(this).attr('data-index')));
            });
            sortedBlockIndices.sort((a, b) => a - b);

            // 合并选中段落的内容
            const mergedText = sortedBlockIndices.map(idx => blocks[idx].current).join('\n');
            console.log(`TwT: Editing ${sortedBlockIndices.length} adjacent paragraphs, merged length: ${mergedText.length}`);

            // 移除可能已存在的旧弹窗
            const oldModal = parentDoc.getElementById('twt-p-modal');
            if (oldModal) {
                console.log("TwT: Removing existing old modal");
                oldModal.remove();
            }

            console.log("TwT: Creating new modal element");
            // 使用 parentDoc 纯原生方式创建元素，避免 WRONG_DOCUMENT_ERR 或者是 jQuery 找不到的问题
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
            console.log("TwT: Modal element appended to parentDoc body");

            const $modal = $(modalEl);
            const $textarea = $modal.find('.twt-p-modal-textarea');
            $textarea.val(mergedText);

            // 动态定位弹窗，使其完美垂直居中在用户的可见视口内
            const repositionModal = () => {
                const { centerY, visibleHeight } = getVisibleCenter();
                
                // 覆盖 overlay 高度以覆盖整个文档
                const docHeight = Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight,
                    window.innerHeight
                );
                modalEl.style.height = docHeight + 'px';
                
                // 定位对话框
                const $box = $modal.find('.twt-p-modal-box');
                $box.css({
                    position: 'absolute',
                    top: centerY + 'px',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                });
                
                // 限制 textarea 最大高度，防止长段落编辑时框体超出可视范围
                $textarea.css('height', 'auto');
                const sh = $textarea[0].scrollHeight;
                const maxTaHeight = Math.max(100, Math.min(sh + 2, visibleHeight * 0.4, 300));
                $textarea.css('height', maxTaHeight + 'px');
            };

            // 监听 textarea 内容输入、窗口大小与滚动变化，实时更新位置与自适应高度
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
                // 光标移到末尾
                const len = $textarea.val().length;
                $textarea[0].setSelectionRange(len, len);
            });

            const closeModal = () => {
                console.log("TwT: Closing modal");
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
                
                // 将其余被合并编辑的块以及中间的空白/空白行段落标记为删除，防止保存后产生多余空行
                const lastIdx = sortedBlockIndices[sortedBlockIndices.length - 1];
                for (let i = targetIdx + 1; i <= lastIdx; i++) {
                    if (sortedBlockIndices.includes(i) || blocks[i].current.trim() === '') {
                        blocks[i].isDeleted = true;
                    }
                }

                // 重新渲染内联列表以反映合并后的效果
                renderInlineList();
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

        // 如果弹窗还开着，先关掉（以弹窗当前内容为准提交）
        const openModalEl = parentDoc.getElementById('twt-p-modal');
        if (openModalEl) {
            const $openModal = $(openModalEl);
            const $ta = $openModal.find('.twt-p-modal-textarea');
            // 找到对应的段落——通过当前选中项
            const $sel = $container.find('.twt-p-item.twt-p-selected');
            if ($sel.length === 1) {
                const idx = Number($sel.attr('data-index'));
                if (!isNaN(idx)) {
                    blocks[idx].current = $ta.val();
                    blocks[idx].isEdited = true;
                    $sel.find('.twt-p-text').text($ta.val());
                    $sel.removeClass('twt-p-selected');
                }
            }
            openModalEl.remove();
        }

        // 重新组合成完整文本。如果段落未修改，使用 originalText (包含隐藏内容)，否则使用编辑后的 current
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

        // 退出编辑模式（会移除工具栏和容器）
        exitEditMode();
        
        // 让酒馆重新渲染消息块（这会根据更新后的 message.mes 重新生成 HTML）
        await context.updateMessageBlock(mesId, message, { rerenderMessage: true });
        
        // 保存聊天到服务器
        await context.saveChat();
    });
}