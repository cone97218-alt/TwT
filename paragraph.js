// @ts-nocheck
import { extension_settings, getContext } from '../../../extensions.js';
import { scrollPageLeft, scrollPageRight } from './pagination.js';
import { getRegexedString, regex_placement } from '../../regex/engine.js';

// 动态加载 CSS
if (!$('link[href*="paragraph.css"]').length) {
    $('<link>', {
        rel: 'stylesheet',
        type: 'text/css',
        href: 'scripts/extensions/third-party/TwT/paragraph.css'
    }).appendTo('head');
}

/**
 * 智能解析段落，按单行分段，但跳过代码块和 XML 标签内部的分段
 * @param {string} text 
 * @returns {string[]}
 */
export function parseParagraphs(text) {
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
        
        if (openMatch && !insideCodeBlock) {
            openTagsStack.push(openMatch[1]);
        } else if (closeMatch && !insideCodeBlock) {
            if (openTagsStack.length > 0 && openTagsStack[openTagsStack.length - 1] === closeMatch[1]) {
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

    // 读取自定义设置与正则过滤标志
    const settings = extension_settings.twt || {};
    const useFiltered = settings.menuOptEditFiltered ?? false;
    const toolbarBottom = settings.paragraphToolbarBottom !== undefined ? settings.paragraphToolbarBottom : 15;

    // 保存原始消息内容（用于取消时恢复）
    const originalText = message.mes || '';
    
    let displayText = originalText;
    // 如果启用了正则过滤选项，在进行分段拆分前先将文本通过酒馆正则表达式过滤为用户可见的文本
    // 注意：这只是显示用的过滤，保存时仍应保存原始消息内容
    if (useFiltered) {
        const placement = message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
        displayText = getRegexedString(displayText, placement, { isMarkdown: true });
    }

    // 保存原始 HTML 用于取消时恢复（注意：这是渲染后的 HTML，不是原始文本）
    const originalHtml = $mesText.html();
    let blocks = parseParagraphs(displayText);

    // ── 将工具栏添加到 #chat 的父容器中，防止它跟随 #chat 横向翻页滚动 ──
    const $chatParent = $('#chat').parent();
    if ($chatParent.length && $chatParent.css('position') === 'static') {
        $chatParent.css('position', 'relative');
    }

    const $toolbar = $(`
        <div id="twt-paragraph-toolbar" class="twt-p-toolbar-wrap" style="bottom: ${toolbarBottom}px;">
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

    // ── 进入编辑模式，屏蔽点击翻页 and 手势滑动翻页 ─────────────────
    document.body.classList.add('twt-paragraph-editing');

    // 渲染段落列表
    function renderInlineList() {
        $container.empty();
        let hasVisibleBlocks = false;

        blocks.forEach((pText, index) => {
            if (pText === null) return;

            if (pText.trim() === '') {
                $container.append('<div class="twt-p-spacer"></div>');
                return;
            }

            hasVisibleBlocks = true;

            const $item = $(`
                <div class="twt-p-item" data-index="${index}">
                    <div class="twt-p-text"></div>
                </div>
            `);

            $item.find('.twt-p-text').text(pText);

            // 当点击段落项时，切换选中状态（只保留竖线高亮，移除复选框）
            $item.on('click', function(e) {
                // 如果正在编辑当前段落（点击发生在编辑器内部），不触发选中切换
                if ($(e.target).closest('.twt-p-editor').length) return;
                $(this).toggleClass('twt-p-selected');
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
            checkedIndices.forEach(idx => { blocks[idx] = null; });
            renderInlineList();
        }
    });

    // ── 单个段落修改编辑 ───────────────────────────────────────────
    $toolbar.find('#twt-p-edit').on('click', (e) => {
        e.stopPropagation();

        const $checked = $container.find('.twt-p-item.twt-p-selected');
        if ($checked.length !== 1) {
            alert('请选择单项段落进行编辑！');
            return;
        }

        const $item = $checked.first();
        const index = Number($item.attr('data-index'));
        const pText = blocks[index];

        // 关闭可能已存在的老编辑器
        $container.find('.twt-p-editor').each(function() {
            const otherIndex = Number($(this).data('for-index'));
            const $otherItem = $container.find(`.twt-p-item[data-index="${otherIndex}"]`);
            $(this).remove();
            $otherItem.show();
        });

        $item.hide();

        const $editor = $(`
            <div class="twt-p-editor" data-for-index="${index}">
                <textarea class="twt-p-textarea"></textarea>
                <div class="twt-p-editor-actions">
                    <button class="twt-p-btn twt-p-editor-cancel" title="取消"><i class="fa-solid fa-xmark"></i></button>
                    <button class="twt-p-btn twt-p-editor-save" title="确定"><i class="fa-solid fa-check"></i></button>
                </div>
            </div>
        `);

        const $textarea = $editor.find('.twt-p-textarea');
        $textarea.val(pText);
        $item.after($editor);

        // 自适应高度调整：在最高 220px 限制下动态调节高度，超出时启用滚动条
        const adjustHeight = () => {
            $textarea.css('height', 'auto');
            const scrollHeight = $textarea[0].scrollHeight;
            const maxHeight = 220; // 对应 CSS 中设置 of max-height
            
            if (scrollHeight > maxHeight) {
                $textarea.css('height', maxHeight + 'px');
                $textarea.css('overflow-y', 'auto');
            } else {
                $textarea.css('height', (scrollHeight + 2) + 'px');
                $textarea.css('overflow-y', 'hidden');
            }
        };

        $textarea.on('input', adjustHeight);
        requestAnimationFrame(adjustHeight); // 等元素渲染后刷新高度

        $editor.find('.twt-p-editor-cancel').on('click', (ev) => {
            ev.stopPropagation();
            $editor.remove();
            $item.show();
        });

        $editor.find('.twt-p-editor-save').on('click', (ev) => {
            ev.stopPropagation();
            const newText = $textarea.val();
            blocks[index] = newText;
            $item.find('.twt-p-text').text(newText);
            $editor.remove();
            $item.show();
        });
    });

    // ── 保存所有修改 ───────────────────────────────────────────────
    $toolbar.find('#twt-p-save').on('click', async (e) => {
        e.stopPropagation();

        // 收集仍开启编辑框的段落数据
        $container.find('.twt-p-editor').each(function() {
            const newText = $(this).find('.twt-p-textarea').val();
            const idx = Number($(this).data('for-index'));
            if (!isNaN(idx)) blocks[idx] = newText;
        });

        // 过滤掉被删除的段落（null），重新组合成完整文本
        // 重要：保存的是原始文本内容，不是经过正则过滤的显示文本
        const finalContent = blocks.filter(b => b !== null).join('\n');
        
        // 更新消息对象的原始文本
        message.mes = finalContent;

        // 退出编辑模式（会移除工具栏和容器）
        exitEditMode();
        
        // 让酒馆重新渲染消息块（这会根据更新后的 message.mes 重新生成 HTML）
        // 注意：不传 rerenderMessage 参数或设为 true 都会重新渲染消息内容
        await context.updateMessageBlock(mesId, message, { rerenderMessage: true });
        
        // 保存聊天到服务器
        await context.saveChat();
    });
}