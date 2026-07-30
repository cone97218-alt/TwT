// @ts-nocheck
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { applyPaginationMode, initPaginationEvent, resetPaginationBinding } from './src/pagination/pagination.js';
import { applyVisualMode } from './src/visual/visual.js';
import { initMulu, applyMuluSettings } from './src/mulu/mulu.js';
import { initMenu, applyMenuMode, applyFullscreenMode } from './src/menu/menu.js';

let parentDoc = document;
try {
    if (window.parent && window.parent.document) {
        parentDoc = window.parent.document;
    }
} catch (e) {
    console.warn("TwT: Cannot access window.parent.document", e);
}
let isExcerptModeActive = false;

function getEl(selector) {
    return $(parentDoc).find(selector);
}

const escapeHtml = (str) => (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const extensionName = 'TwT';

const defaultSettings = {
    enabled: true,
    swipeEnabled: true,
    messagePageEnabled: false,
    htmlPageBreakEnabled: true,
    avatarLayoutMode: 'float',
    customWhitelist: '.mes_reasoning_details, .thought-block',
    menuEnabled: false,
    menuOptRegenerate: true,
    menuOptSwipe: true,
    menuOptManage: true,
    menuOptEdit: true,
    paragraphToolbarBottom: 15,
    paragraphIconSize: 20,
    paragraphXmlWhitelist: 'thought, TavernThought, reasoning, details',
    menuOptEditFiltered: false,
    menuOptExcerpt: false,
    excerptTopOffset: 0,
    excerptFontSize: 12,
    menuOptFullscreen: true,
    menuOptApi: false,
    menuOptPurifier: false,
    menuOptPurifierDiff: false,
    menuOptNewChat: true,
    menuOptCloseChat: true,
    menuOptPromptViewer: false,
    menuOrder: [
        'menuOptRegenerate',
        'menuOptSwipe',
        'menuOptManage',
        'menuOptEdit',
        'menuOptNewChat',
        'menuOptCloseChat',
        'menuOptExcerpt',
        'menuOptFullscreen',
        'menuOptApi',
        'menuOptPurifier',
        'menuOptPurifierDiff',
        'menuOptPromptViewer'
    ],
    isFullscreen: false,
    menuInvokeMethod: 'longpress',
    menuLongpressDelay: 500,
    menuDirection: 'bottom-right',
    menuStyle: 'grid',
    visualEnabled: false, 
    muluEnabled: false,
    muluBtnStart: true,
    muluBtnToc: true,
    muluBtnEnd: true,
    paddingTop: 0,
    paddingBottom: 60,
    paddingLeft: 15,
    paddingRight: 15,
    fontSize: 16,
    lineHeight: 1.6,
    textIndent: 0,           // 首行缩进字符数（0 = 不缩进）
    textAlign: 'left',       // 对齐方式：left | justify | center | right
    paragraphSpacing: 0,     // 段落间距 px
    letterSpacing: 0,        // 字间距 px
    fontWeight: 'normal',    // 文本粗细
    fontFamily: 'inherit',   // 字体选择
    customFonts: {},         // 自定义字体库
    visualPresets: {}, 

    currentPreset: 'custom',
    presetThemeLinks: {},
    presetTagLinks: {},
    
    // New Mulu Regex settings
    muluRegexPresets: {
        '章节 (第X章/第X回)': '第[一二三四五六七八九十百千万\\\\d]+[章节回卷折幕篇][^\\\\n]*',
        'Markdown 标题': '^\\\\s*#+\\\\s+([^\\\\n]+)',
        '括号标题 【X】': '【([^】]+)】',
        '数字标题 (1. X)': '^\\\\s*\\\\d+[、.．\\\\s]+([^\\\\n]+)'
    },
    currentMuluRegexPreset: '章节 (第X章/第X回)',
    customMuluRegex: '第[一二三四五六七八九十百千万\\d]+[章节回卷折幕篇][^\\n]*',
    muluSortOrder: 'asc',

    // CSS Custom Optimization settings
    optimizeEnabled: false,
    optimizePatches: {},
    optimizeFolders: ['界面调整', '手势与选择'],

    // Comments settings
    commentsEnabled: true,
    commentsSelectedApiId: 'main',
    commentsApis: [],
    commentsPromptPresets: {
        '网络读者弹幕吐槽': [
            { role: 'system', content: '你是一个小说读者，正在小说网站上阅读小说。请针对以下带编号的段落，写一些像真实读者留下的评论吐槽（俗称“本章说”、“间贴”、“弹幕”）。\n\n【要求】\n1. 吐槽数量：不需要每一段都写，挑选 2~4 个最精彩、最想让人吐槽的段落。\n2. 吐槽内容：符合小说读者的语气，包含剧情猜测、吐槽、玩梗、情感发泄（如甜死我了、虐心、前方高能、男主太帅了）等，保持简短（通常 15~35 字）。\n3. 网友网名：结合你吐槽的内容和小说背景，为每个吐槽生成一个个性化的网友网名（例如：纯爱战神_123、催更狂魔_456、催泪弹收割机、列文虎克等）。', enabled: true, name: '系统角色指令' },
            { role: 'user', content: '【前文剧情】\n{{context_history}}\n\n【上下文背景】\n主角姓名（用户）：{{user}}\nNPC姓名（角色）：{{char}}\n\n【待阅读小说片段】\n{{paragraphs_input}}', enabled: true, name: '前文与段落输入' },
            { role: 'system', content: '必须以 JSON 数组格式返回，不要有任何前言、后记或解释，格式如下：\n[\n  { "para_id": 0, "author": "个性化的网友网名", "comment": "吐槽内容" },\n  { "para_id": 2, "author": "个性化的网友网名", "comment": "吐槽内容" }\n]', enabled: true, name: '输出格式控制' }
        ],
        '理性剧情分析': [
            { role: 'system', content: '你是一个非常理性的网络小说评论家。请阅读以下小说片段，挑选 1~2 个段落进行专业分析，并给出简短的书评吐槽。\n\n【要求】\n1. 网友网名：结合你分析的内容 and 小说背景，为每个分析生成一个个性化的专业网友网名（例如：剧情分析师_99、细节怪、伏笔回收站等）。\n2. 字数控制在 50 字以内。', enabled: true, name: '系统分析师指令' },
            { role: 'user', content: '【前文剧情】\n{{context_history}}\n\n【待阅读小说片段】\n{{paragraphs_input}}', enabled: true, name: '前文与段落输入' },
            { role: 'system', content: '必须以 JSON 数组格式返回，格式如下：\n[\n  { "para_id": 1, "author": "个性化的网友网名", "comment": "分析吐槽" }\n]', enabled: true, name: '输出格式控制' }
        ]
    },
    commentsCurrentPreset: '网络读者弹幕吐槽',
    commentsRegexFilters: [
        { id: 'filter_thought', name: '排除 AI 思考过程 (thought/details)', pattern: '<(thought|TavernThought|details|reasoning)[^>]*>[\\s\\S]*?<\\/\\1>', action: 'remove', enabled: true },
        { id: 'filter_markdown', name: '排除 Markdown 样式标记 (*和_)', pattern: '[*_]', action: 'remove', enabled: false }
    ],
    commentsDrawerPosition: 'right', // left, right, center
    commentsDrawerWidth: 35 // default width percentage
};

const defaultPatches = {
    '隐藏滚动条': {
        active: false,
        folder: '界面调整',
        code: `/* 隐藏全局滚动条及聊天区域滚动条 */\n::-webkit-scrollbar {\n    display: none !important;\n    width: 0 !important;\n    height: 0 !important;\n}\nbody, html, #chat, #chat-container, .twt-mulu-list {\n    scrollbar-width: none !important; /* Firefox */\n    -ms-overflow-style: none !important; /* IE/Edge */\n}`
    },
    '禁用聊天区域长按菜单': {
        active: false,
        folder: '手势与选择',
        code: `/* 禁用聊天区域文本选中与移动端长按呼出菜单 */\n#chat {\n    -webkit-touch-callout: none !important; /* 禁用iOS长按菜单 */\n    -webkit-user-select: none !important;   /* 禁用选中 */\n    user-select: none !important;\n}\n/* 如果有输入框在聊天区内，允许选中 */\n#chat input, #chat textarea {\n    -webkit-touch-callout: default !important;\n    -webkit-user-select: text !important;\n    user-select: text !important;\n}`
    },
    '收藏栏左侧图标缩小': {
        active: false,
        folder: '界面调整',
        code: `/* 收藏栏左侧图标缩小 */\nbody #rm_button_characters {\n    font-size: 16px !important;\n    width: 32px !important;\n    height: 32px !important;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}`
    },
    '收藏栏下方空隙缩小': {
        active: false,
        folder: '界面调整',
        code: `/* 收藏栏下方空隙缩小 */\nbody #CharListButtonAndHotSwaps {\n    margin-bottom: -20px;\n}`
    },
    'Spreset': {
        active: false,
        folder: '界面调整',
        code: `.spreset-button-container {\n  display: none;\n}`
    }
};

if (!extension_settings.twt) {
    extension_settings.twt = Object.assign({}, defaultSettings);
    extension_settings.twt.optimizePatches = Object.assign({}, defaultPatches);
} else {
    for (const key in defaultSettings) {
        if (extension_settings.twt[key] === undefined) {
            extension_settings.twt[key] = defaultSettings[key];
        }
    }
    if (!extension_settings.twt.visualPresets) {
        extension_settings.twt.visualPresets = {};
    }
    if (!extension_settings.twt.muluRegexPresets) {
        extension_settings.twt.muluRegexPresets = Object.assign({}, defaultSettings.muluRegexPresets);
    }
    if (!extension_settings.twt.optimizePatches) {
        extension_settings.twt.optimizePatches = {};
    }
    // 注入默认预设的补丁
    for (const [key, val] of Object.entries(defaultPatches)) {
        if (extension_settings.twt.optimizePatches[key] === undefined) {
            extension_settings.twt.optimizePatches[key] = Object.assign({}, val);
        } else if (extension_settings.twt.optimizePatches[key].folder === undefined && val.folder) {
            extension_settings.twt.optimizePatches[key].folder = val.folder;
        }
    }
    if (!extension_settings.twt.commentsApis) {
        extension_settings.twt.commentsApis = [];
    }
    if (extension_settings.twt.commentsSelectedApiId === undefined) {
        extension_settings.twt.commentsSelectedApiId = 'main';
    }
    if (!extension_settings.twt.commentsPromptPresets || typeof extension_settings.twt.commentsPromptPresets !== 'object' || Object.keys(extension_settings.twt.commentsPromptPresets).length === 0) {
        extension_settings.twt.commentsPromptPresets = JSON.parse(JSON.stringify(defaultSettings.commentsPromptPresets));
    }
    
    // 迁移旧版字符串提示词为新版结构化数组提示词
    for (const key in extension_settings.twt.commentsPromptPresets) {
        const val = extension_settings.twt.commentsPromptPresets[key];
        if (typeof val === 'string') {
            if (key === '网络读者弹幕吐槽' && defaultSettings.commentsPromptPresets['网络读者弹幕吐槽']) {
                extension_settings.twt.commentsPromptPresets[key] = JSON.parse(JSON.stringify(defaultSettings.commentsPromptPresets['网络读者弹幕吐槽']));
            } else if (key === '理性剧情分析' && defaultSettings.commentsPromptPresets['理性剧情分析']) {
                extension_settings.twt.commentsPromptPresets[key] = JSON.parse(JSON.stringify(defaultSettings.commentsPromptPresets['理性剧情分析']));
            } else {
                extension_settings.twt.commentsPromptPresets[key] = [
                    { role: 'user', content: val, enabled: true }
                ];
            }
        }
    }
    
    if (!extension_settings.twt.commentsCurrentPreset || !extension_settings.twt.commentsPromptPresets[extension_settings.twt.commentsCurrentPreset]) {
        extension_settings.twt.commentsCurrentPreset = Object.keys(extension_settings.twt.commentsPromptPresets)[0] || '网络读者弹幕吐槽';
    }
    if (!extension_settings.twt.commentsRegexFilters) {
        extension_settings.twt.commentsRegexFilters = JSON.parse(JSON.stringify(defaultSettings.commentsRegexFilters));
    }
    if (extension_settings.twt.commentsDrawerPosition === undefined) {
        extension_settings.twt.commentsDrawerPosition = defaultSettings.commentsDrawerPosition;
    }
    if (extension_settings.twt.commentsDrawerWidth === undefined) {
        extension_settings.twt.commentsDrawerWidth = defaultSettings.commentsDrawerWidth;
    }

    if (!extension_settings.twt.menuOrder) {
        extension_settings.twt.menuOrder = [...defaultSettings.menuOrder];
    } else {
        defaultSettings.menuOrder.forEach(key => {
            if (!extension_settings.twt.menuOrder.includes(key)) {
                extension_settings.twt.menuOrder.push(key);
            }
        });
    }
}

function updatePageTabVisibility() {
    const $tabBtn = $('#tab-btn-page');
    const $tabContent = $('#twt-tab-page');
    
    if (extension_settings.twt.enabled) {
        $tabBtn.show();
    } else {
        $tabBtn.hide();
        if ($tabBtn.hasClass('active')) {
            $tabBtn.removeClass('active');
            $tabContent.hide().removeClass('active');
            $('[data-tab="twt-tab-settings"]').addClass('active');
            $('#twt-tab-settings').show().addClass('active');
        }
    }
}

function updateMenuTabVisibility() {
    const $tabBtn = $('#tab-btn-menu');
    const $tabContent = $('#twt-tab-menu');
    
    if (extension_settings.twt.menuEnabled) {
        $tabBtn.show();
    } else {
        $tabBtn.hide();
        if ($tabBtn.hasClass('active')) {
            $tabBtn.removeClass('active');
            $tabContent.hide().removeClass('active');
            $('[data-tab="twt-tab-settings"]').addClass('active');
            $('#twt-tab-settings').show().addClass('active');
        }
    }
}

function updateVisualTabVisibility() {
    const $tabBtn = $('#tab-btn-visual');
    const $tabContent = $('#twt-tab-visual');
    
    if (extension_settings.twt.visualEnabled) {
        $tabBtn.show();
    } else {
        $tabBtn.hide();
        if ($tabBtn.hasClass('active')) {
            $tabBtn.removeClass('active');
            $tabContent.hide().removeClass('active');
            $('[data-tab="twt-tab-settings"]').addClass('active');
            $('#twt-tab-settings').show().addClass('active');
        }
    }
}

function updateMuluTabVisibility() {
    const $tabBtn = $('#tab-btn-mulu');
    const $tabContent = $('#twt-tab-mulu');
    
    if (extension_settings.twt.muluEnabled) {
        $tabBtn.show();
    } else {
        $tabBtn.hide();
        if ($tabBtn.hasClass('active')) {
            $tabBtn.removeClass('active');
            $tabContent.hide().removeClass('active');
            $('[data-tab="twt-tab-settings"]').addClass('active');
            $('#twt-tab-settings').show().addClass('active');
        }
    }
}


function updateCommentsTabVisibility() {
    const $tabBtn = $('#tab-btn-comments');
    const $tabContent = $('#twt-tab-comments');
    
    if (extension_settings.twt.commentsEnabled) {
        $tabBtn.show();
    } else {
        $tabBtn.hide();
        if ($tabBtn.hasClass('active')) {
            $tabBtn.removeClass('active');
            $tabContent.hide().removeClass('active');
            $('[data-tab="twt-tab-settings"]').addClass('active');
            $('#twt-tab-settings').show().addClass('active');
        }
    }
}

function renderCommentsPresetList() {
    const $select = $('#twt_comments_preset');
    if (!$select.length) return;
    $select.empty();
    const presets = extension_settings.twt.commentsPromptPresets || {};
    for (const presetName of Object.keys(presets)) {
        const $opt = $('<option></option>').val(presetName).text(presetName);
        $select.append($opt);
    }
    const current = extension_settings.twt.commentsCurrentPreset || Object.keys(presets)[0] || '';
    $select.val(current);
    $('#twt_comments_prompt').val(presets[current] || '');
}

function updateParagraphSubOptionsVisibility() {
    const $subOptions = $('#twt_paragraph_edit_sub_options');
    if (extension_settings.twt.menuOptEdit) {
        $subOptions.show();
    } else {
        $subOptions.hide();
    }
}

function updateExcerptSubOptionsVisibility() {
    const $subOptions = $('#twt_excerpt_sub_options');
    if (extension_settings.twt.menuOptExcerpt) {
        $subOptions.show();
    } else {
        $subOptions.hide();
    }
}

function updateLiveExcerptBar() {
    const bar = parentDoc.getElementById('twt-excerpt-float-bar');
    if (bar) {
        const topOffset = extension_settings.twt.excerptTopOffset !== undefined ? extension_settings.twt.excerptTopOffset : 0;
        const fontSize = extension_settings.twt.excerptFontSize !== undefined ? extension_settings.twt.excerptFontSize : 12;
        bar.style.top = `${topOffset}px`;
        bar.style.fontSize = `${fontSize}px`;
        if (topOffset === 0) {
            bar.style.borderTop = 'none';
            bar.style.borderRadius = '0 0 10px 10px';
        } else {
            bar.style.borderTop = '1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15))';
            bar.style.borderRadius = '10px';
        }
    }
}

let currentlyEditingPatchName = null;
const collapsedFolders = {};
let optimizeSearchTimeout = null;
let currentOptimizeSearchQuery = '';

function renderOptimizePatchList() {
    const $list = $('#twt_optimize_list');
    $list.empty();

    const patches = extension_settings.twt.optimizePatches || {};
    const folders = extension_settings.twt.optimizeFolders || [];
    const patchNames = Object.keys(patches);

    if (patchNames.length === 0) {
        $list.append(`
            <div id="twt_optimize_empty_hint" style="text-align: center; opacity: 0.5; padding: 15px; font-size: 0.9em; border: 1px dashed var(--SmartThemeBorderColor); border-radius: 6px; width: 100%; box-sizing: border-box;">
                暂无自定义补丁，点击“新建补丁”开始吧！
            </div>
        `);
        return;
    }

    // Helper function to build a patch item element
    const buildPatchItemHtml = (name, patch) => {
        const isEditingThis = currentlyEditingPatchName === name;
        return `
            <div class="twt-optimize-item" data-name="${escapeHtml(name)}" style="display: flex; flex-direction: column; background: rgba(0,0,0,0.15); padding: 8px 10px; border-radius: 6px; border: 1px solid ${isEditingThis ? 'var(--SmartThemeUnderlineColor)' : 'var(--SmartThemeBorderColor)'}; gap: 6px; width: 100%; box-sizing: border-box; box-shadow: none !important;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; box-shadow: none !important;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; min-width: 0; margin: 0; user-select: none; box-shadow: none !important;">
                        <input type="checkbox" class="twt-patch-checkbox" ${patch.active ? 'checked' : ''} style="margin: 0; flex-shrink: 0; box-shadow: none !important;" />
                        <span class="twt-patch-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; font-size: 0.95em; ${isEditingThis ? 'font-weight: bold; color: var(--SmartThemeUnderlineColor, #fff);' : ''}">${escapeHtml(name)}</span>
                    </label>
                    <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; box-shadow: none !important;">
                        <div style="position: relative; display: inline-block; box-shadow: none !important;">
                            <button class="twt-patch-move menu_button" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: rgba(255, 255, 255, 0.08); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important; display: flex; align-items: center; justify-content: center;" title="移动分类">
                                <i class="fa-solid fa-folder"></i>
                            </button>
                            <select class="twt-patch-folder-select" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; margin: 0; padding: 0; border: none; outline: none; -webkit-appearance: none; -moz-appearance: none; appearance: none;">
                                <option value="" ${!patch.folder ? 'selected' : ''}>未分类</option>
                                ${folders.map(f => `<option value="${escapeHtml(f)}" ${patch.folder === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                            </select>
                        </div>
                        <button class="twt-patch-edit" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: ${isEditingThis ? 'var(--SmartThemeUnderlineColor)' : 'rgba(255, 255, 255, 0.08)'}; color: ${isEditingThis ? 'var(--SmartThemeDarkColor)' : 'var(--SmartThemeBodyColor)'}; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important;" title="编辑代码"><i class="fa-solid fa-code"></i></button>
                        <button class="twt-patch-rename" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: rgba(255, 255, 255, 0.08); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important;" title="重命名补丁"><i class="fa-solid fa-pen"></i></button>
                        <button class="twt-patch-delete" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: rgba(255, 255, 255, 0.08); color: #ff4444; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important;" title="删除补丁"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    };

    // Group patches by folder
    const folderGroups = {};
    const uncategorizedPatches = [];

    // Initialize groups
    folders.forEach(f => {
        folderGroups[f] = [];
    });

    Object.keys(patches).forEach(name => {
        const patch = patches[name];
        if (patch.folder && folderGroups[patch.folder]) {
            folderGroups[patch.folder].push({ name, patch });
        } else {
            uncategorizedPatches.push({ name, patch });
        }
    });

    let hasAnyMatch = false;

    // Render defined folders
    folders.forEach(folderName => {
        let listItems = folderGroups[folderName];
        let isFolderMatched = false;
        if (currentOptimizeSearchQuery) {
            isFolderMatched = folderName.toLowerCase().includes(currentOptimizeSearchQuery);
            if (!isFolderMatched) {
                listItems = listItems.filter(item => item.name.toLowerCase().includes(currentOptimizeSearchQuery));
            }
        }

        if (currentOptimizeSearchQuery && !isFolderMatched && listItems.length === 0) {
            return; // skip rendering this folder
        }

        hasAnyMatch = true;
        const isCollapsed = currentOptimizeSearchQuery ? false : (collapsedFolders[folderName] !== false);
        const patchCount = listItems.length;
        
        const $folderEl = $(`
            <div class="twt-optimize-folder" data-folder="${escapeHtml(folderName)}" style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; margin-bottom: 4px;">
                <div class="twt-optimize-folder-header" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 6px; cursor: pointer; user-select: none; border: 1px solid rgba(255,255,255,0.08);">
                    <div class="twt-folder-title-wrap" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-down twt-folder-chevron" style="font-size: 0.8em; transition: transform 0.2s; ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                        <i class="fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} twt-folder-icon" style="color: #e0a96d; font-size: 0.95em;"></i>
                        <span style="font-weight: bold; font-size: 0.9em;">${escapeHtml(folderName)}</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="twt-folder-count" style="font-size: 0.8em; opacity: 0.5;">(${patchCount})</span>
                        <button class="twt-folder-rename menu_button" style="padding: 2px 5px !important; margin: 0 !important; font-size: 0.75em !important; height: auto !important; min-height: unset !important;" title="重命名分类"><i class="fa-solid fa-pen"></i></button>
                        <button class="twt-folder-delete menu_button" style="padding: 2px 5px !important; margin: 0 !important; font-size: 0.75em !important; height: auto !important; min-height: unset !important; color: #ff4444 !important;" title="删除分类"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="twt-optimize-folder-content" style="display: ${isCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 6px; padding: 4px 0 4px 12px; border-left: 1px dashed rgba(255,255,255,0.15); margin-left: 14px;">
                    <!-- Items will be placed here -->
                </div>
            </div>
        `);
        
        const $content = $folderEl.find('.twt-optimize-folder-content');
        if (listItems.length === 0) {
            $content.append(`<div style="font-size:0.85em; opacity:0.35; padding: 4px;">无补丁</div>`);
        } else {
            listItems.forEach(item => {
                $content.append(buildPatchItemHtml(item.name, item.patch));
            });
        }
        $list.append($folderEl);
    });

    // Render Uncategorized section (only if there are uncategorized patches or folders are empty)
    let filteredUncat = uncategorizedPatches;
    let isUncatMatched = false;
    if (currentOptimizeSearchQuery) {
        isUncatMatched = "未分类".includes(currentOptimizeSearchQuery);
        if (!isUncatMatched) {
            filteredUncat = filteredUncat.filter(item => item.name.toLowerCase().includes(currentOptimizeSearchQuery));
        }
    }

    if (filteredUncat.length > 0 || (folders.length === 0 && !currentOptimizeSearchQuery)) {
        hasAnyMatch = true;
        const isCollapsed = currentOptimizeSearchQuery ? false : (collapsedFolders[''] !== false);
        const patchCount = filteredUncat.length;
        const $uncatEl = $(`
            <div class="twt-optimize-folder" data-folder="" style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; margin-bottom: 4px;">
                <div class="twt-optimize-folder-header" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 6px; cursor: pointer; user-select: none; border: 1px solid rgba(255,255,255,0.08);">
                    <div class="twt-folder-title-wrap" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-down twt-folder-chevron" style="font-size: 0.8em; transition: transform 0.2s; ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                        <i class="fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} twt-folder-icon" style="color: #a0a0a0; font-size: 0.95em;"></i>
                        <span style="font-weight: bold; font-size: 0.9em; opacity: 0.85;">未分类</span>
                    </div>
                    <span class="twt-folder-count" style="font-size: 0.8em; opacity: 0.5;">(${patchCount})</span>
                </div>
                <div class="twt-optimize-folder-content" style="display: ${isCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 6px; padding: 4px 0 4px 12px; border-left: 1px dashed rgba(255,255,255,0.15); margin-left: 14px;">
                    <!-- Items will be placed here -->
                </div>
            </div>
        `);
        
        const $content = $uncatEl.find('.twt-optimize-folder-content');
        if (uncategorizedPatches.length === 0) {
            $content.append(`<div style="font-size:0.85em; opacity:0.35; padding: 4px;">无补丁</div>`);
        } else {
            filteredUncat.forEach(item => {
                $content.append(buildPatchItemHtml(item.name, item.patch));
            });
        }
        $list.append($uncatEl);
    }

    if (currentOptimizeSearchQuery && !hasAnyMatch) {
        $list.append(`
            <div id="twt_optimize_no_results" style="text-align: center; opacity: 0.5; padding: 15px; font-size: 0.9em; border: 1px dashed var(--SmartThemeBorderColor); border-radius: 6px; width: 100%; box-sizing: border-box;">
                未找到与 “${escapeHtml(currentOptimizeSearchQuery)}” 相关的补丁或分类
            </div>
        `);
    }
}

function openOptimizeEditor(name) {
    const patches = extension_settings.twt.optimizePatches || {};
    const patch = patches[name];
    if (!patch) return;

    currentlyEditingPatchName = name;
    getEl('#twt_optimize_editor_title').text(`正在编辑: ${name}`);
    getEl('#twt_optimize_code').val(patch.code || '');
    getEl('#twt-optimize-editor-modal').css('display', 'flex');
    
    renderOptimizePatchList();
}

function closeOptimizeEditor() {
    currentlyEditingPatchName = null;
    getEl('#twt-optimize-editor-modal').css('display', 'none');
    renderOptimizePatchList();
}

export function updateInjectedStyles() {
    let doc = document;
    try {
        if (window.parent && window.parent.document) {
            doc = window.parent.document;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document in updateInjectedStyles.", e);
    }
    let style = doc.getElementById('twt-optimize-styles');
    if (!style) {
        style = doc.createElement('style');
        style.id = 'twt-optimize-styles';
        doc.head.appendChild(style);
    }

    if (!extension_settings.twt.visualEnabled) {
        style.innerHTML = '';
        return;
    }

    let css = '';
    const patches = extension_settings.twt.optimizePatches || {};
    for (const [name, patch] of Object.entries(patches)) {
        if (patch && patch.active && patch.code) {
            css += `/* Patch: ${name} */\n${patch.code}\n\n`;
        }
    }

    style.innerHTML = css;
}

const BUILTIN_FONTS = {
    'Huiwen-mincho': {
        name: '汇文明朝',
        family: 'Huiwen-mincho',
        css: '@import url("https://fontsapi.zeoseven.com/256/main/result.css");'
    },
    'Noto Serif CJK': {
        name: '思源宋体',
        family: 'Noto Serif CJK',
        css: '@import url("https://fontsapi.zeoseven.com/285/main/result.css");'
    }
};

function getValidCustomFonts() {
    const raw = extension_settings.twt.customFonts;
    if (!raw || typeof raw !== 'object') return {};
    const valid = {};
    for (const [key, fontData] of Object.entries(raw)) {
        if (!fontData) continue;
        if (typeof fontData === 'object' && fontData.css && typeof fontData.css === 'string' && fontData.css.trim().length > 0) {
            valid[key] = fontData;
        }
    }
    return valid;
}

function updateCustomFontsStyle() {
    let $style = $('#twt-custom-fonts-style');
    if (!$style.length) {
        $style = $('<style id="twt-custom-fonts-style"></style>').appendTo('head');
    }
    let importsCss = '';
    let fontFaceCss = '';

    for (const fontKey of Object.keys(BUILTIN_FONTS)) {
        importsCss += `${BUILTIN_FONTS[fontKey].css}\n`;
    }

    const customFonts = getValidCustomFonts();
    for (const [fontName, fontData] of Object.entries(customFonts)) {
        if (fontData && fontData.css) {
            let snippet = fontData.css.trim();
            const importMatch = snippet.match(/@import\s+url\((["']?)([^"']+)\1\);?/i);
            if (importMatch) {
                importsCss += `@import url("${importMatch[2]}");\n`;
            } else if (snippet.startsWith('@import')) {
                const firstLine = snippet.split('\n')[0].trim();
                importsCss += `${firstLine}\n`;
            } else {
                fontFaceCss += `/* Custom Font: ${fontName} */\n${snippet}\n\n`;
            }
        }
    }
    $style.text(`${importsCss}\n${fontFaceCss}`);
}

function renderFontFamilyOptions() {
    const $select = $('#twt_font_family');
    if (!$select.length) return;
    $select.empty();
    $select.append(`<option value="inherit">系统默认</option>`);
    for (const [key, fontObj] of Object.entries(BUILTIN_FONTS)) {
        $select.append($('<option></option>').val(fontObj.family).text(fontObj.name));
    }
    const customFonts = getValidCustomFonts();
    extension_settings.twt.customFonts = customFonts;
    for (const [fontKey, fontObj] of Object.entries(customFonts)) {
        if (BUILTIN_FONTS[fontKey] || BUILTIN_FONTS[fontObj.family]) continue;
        const displayName = fontObj.name || fontKey;
        const familyVal = fontObj.family || fontKey;
        $select.append($('<option></option>').val(familyVal).text(`${displayName} (自定义)`));
    }
    $select.val(extension_settings.twt.fontFamily || 'inherit');
}


function renderPresetList() {
    const $select = $('#twt_visual_preset');
    $select.empty();
    $select.append(`<option value="custom">自定义</option>`);
    for (const presetName of Object.keys(extension_settings.twt.visualPresets)) {
        const $opt = $('<option></option>').val(presetName).text(presetName);
        $select.append($opt);
    }
    $select.val(extension_settings.twt.currentPreset);
}

function applyPreset(presetName) {
    if (presetName === 'custom') return;
    const preset = extension_settings.twt.visualPresets[presetName];
    if (preset) {
        // Page margins
        if (preset.paddingTop !== undefined) extension_settings.twt.paddingTop = preset.paddingTop;
        if (preset.paddingBottom !== undefined) extension_settings.twt.paddingBottom = preset.paddingBottom;
        if (preset.paddingLeft !== undefined) extension_settings.twt.paddingLeft = preset.paddingLeft;
        if (preset.paddingRight !== undefined) extension_settings.twt.paddingRight = preset.paddingRight;
        
        $('#twt_padding_top').val(extension_settings.twt.paddingTop);
        $('#twt_padding_bottom').val(extension_settings.twt.paddingBottom);
        $('#twt_padding_left').val(extension_settings.twt.paddingLeft);
        $('#twt_padding_right').val(extension_settings.twt.paddingRight);

        if (preset.avatarLayoutMode !== undefined) extension_settings.twt.avatarLayoutMode = preset.avatarLayoutMode;
        else extension_settings.twt.avatarLayoutMode = 'float';
        $('#twt_avatar_layout_mode').val(extension_settings.twt.avatarLayoutMode);
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
        
        // Typography
        if (preset.fontSize !== undefined) extension_settings.twt.fontSize = preset.fontSize;
        if (preset.lineHeight !== undefined) extension_settings.twt.lineHeight = preset.lineHeight;
        if (preset.textIndent !== undefined) extension_settings.twt.textIndent = preset.textIndent;
        if (preset.textAlign !== undefined) extension_settings.twt.textAlign = preset.textAlign;
        if (preset.paragraphSpacing !== undefined) extension_settings.twt.paragraphSpacing = preset.paragraphSpacing;
        if (preset.letterSpacing !== undefined) extension_settings.twt.letterSpacing = preset.letterSpacing;
        if (preset.fontWeight !== undefined) extension_settings.twt.fontWeight = preset.fontWeight;
        if (preset.fontFamily !== undefined) extension_settings.twt.fontFamily = preset.fontFamily;
        else extension_settings.twt.fontFamily = 'inherit';
        if (preset.customFonts) {
            extension_settings.twt.customFonts = Object.assign({}, extension_settings.twt.customFonts || {}, preset.customFonts);
        }
        updateCustomFontsStyle();
        renderFontFamilyOptions();
        
        $('#twt_font_size').val(extension_settings.twt.fontSize);
        $('#twt_line_height').val(extension_settings.twt.lineHeight);
        $('#twt_text_indent').val(extension_settings.twt.textIndent);
        $('#twt_text_align').val(extension_settings.twt.textAlign);
        $('#twt_paragraph_spacing').val(extension_settings.twt.paragraphSpacing);
        $('#twt_letter_spacing').val(extension_settings.twt.letterSpacing);
        $('#twt_font_weight').val(extension_settings.twt.fontWeight || 'normal');
        
        // CSS Optimization Patches with new-patch detection and deleted-patch removal
        const patches = extension_settings.twt.optimizePatches || {};
        if (preset.optimizePatches) {
            // Clean up preset.optimizePatches: remove any key that is not in the system's patches
            for (const key of Object.keys(preset.optimizePatches)) {
                if (!(key in patches)) {
                    delete preset.optimizePatches[key];
                }
            }
            // Apply states. If system patch is not in preset.optimizePatches (it's new), turn it off.
            for (const key of Object.keys(patches)) {
                if (key in preset.optimizePatches) {
                    patches[key].active = !!preset.optimizePatches[key];
                } else {
                    patches[key].active = false;
                }
            }
        } else {
            // If preset doesn't have optimizePatches, turn all patches off
            preset.optimizePatches = {};
            for (const key of Object.keys(patches)) {
                patches[key].active = false;
            }
        }
        renderOptimizePatchList();
        updateInjectedStyles();
        
        getContext().saveSettingsDebounced();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    }
}

function saveCurrentToPreset(name) {
    const presetData = {
        paddingTop: extension_settings.twt.paddingTop,
        paddingBottom: extension_settings.twt.paddingBottom,
        paddingLeft: extension_settings.twt.paddingLeft,
        paddingRight: extension_settings.twt.paddingRight,
        fontSize: extension_settings.twt.fontSize,
        lineHeight: extension_settings.twt.lineHeight,
        textIndent: extension_settings.twt.textIndent,
        textAlign: extension_settings.twt.textAlign,
        paragraphSpacing: extension_settings.twt.paragraphSpacing,
        letterSpacing: extension_settings.twt.letterSpacing,
        fontWeight: extension_settings.twt.fontWeight || 'normal',
        fontFamily: extension_settings.twt.fontFamily || 'inherit',
        customFonts: $.extend(true, {}, extension_settings.twt.customFonts || {}),
        avatarLayoutMode: extension_settings.twt.avatarLayoutMode || 'float'
    };

    presetData.optimizePatches = {};
    const patches = extension_settings.twt.optimizePatches || {};
    for (const patchName of Object.keys(patches)) {
        presetData.optimizePatches[patchName] = !!patches[patchName].active;
    }

    extension_settings.twt.visualPresets[name] = presetData;
    extension_settings.twt.currentPreset = name;
    getContext().saveSettingsDebounced();
    renderPresetList();
}


function renderMuluRegexPresetList() {
    const $select = $('#twt_mulu_regex_preset');
    $select.empty();
    $select.append(`<option value="custom">自定义</option>`);
    for (const presetName of Object.keys(extension_settings.twt.muluRegexPresets)) {
        const $opt = $('<option></option>').val(presetName).text(presetName);
        $select.append($opt);
    }
    $select.val(extension_settings.twt.currentMuluRegexPreset);
}

function applyMuluRegexPreset(presetName) {
    if (presetName === 'custom') return;
    const regexPattern = extension_settings.twt.muluRegexPresets[presetName];
    if (regexPattern !== undefined) {
        extension_settings.twt.customMuluRegex = regexPattern;
        $('#twt_mulu_regex_input').val(regexPattern);
        getContext().saveSettingsDebounced();
    }
}

function saveCurrentToMuluRegexPreset(name) {
    extension_settings.twt.muluRegexPresets[name] = extension_settings.twt.customMuluRegex;
    extension_settings.twt.currentMuluRegexPreset = name;
    getContext().saveSettingsDebounced();
    renderMuluRegexPresetList();
}

let workLogs = [];

function logWork(message) {
    const timeStr = new Date().toLocaleTimeString();
    const entry = { time: Date.now(), text: `[${timeStr}] ${message}` };
    workLogs.push(entry);
    
    const $container = $('#twt-work-logs');
    if ($container.length) {
        $container.append(`<div style="line-height:1.3; font-size:0.95em;">${entry.text}</div>`);
        $container.scrollTop($container[0].scrollHeight);
    }
}

function cleanOldLogs() {
    const halfHourAgo = Date.now() - 30 * 60 * 1000;
    const initialLen = workLogs.length;
    workLogs = workLogs.filter(log => log.time >= halfHourAgo);
    
    if (workLogs.length !== initialLen) {
        const $container = $('#twt-work-logs');
        if ($container.length) {
            $container.empty();
            workLogs.forEach(entry => {
                $container.append(`<div style="line-height:1.3; font-size:0.95em;">${entry.text}</div>`);
            });
        }
    }
}

// 每过半小时自动清理日志
setInterval(cleanOldLogs, 30 * 60 * 1000);

function getGlobalThemes() {
    const themes = [];
    const themeSelect = parentDoc.getElementById('themes');
    if (themeSelect) {
        for (const opt of themeSelect.options) {
            if (opt.value) themes.push({ val: opt.value, name: opt.text || opt.value });
        }
    }
    return themes;
}

function initThemeLinkListener() {
    const handleThemeChange = (themeVal) => {
        if (!themeVal) return;
        
        // 优先检查直接主题关联
        const themeLinks = extension_settings.twt.presetThemeLinks || {};
        let targetPreset = themeLinks[themeVal];
        
        // 如果没有直接关联且 themeManager 可用，检查该主题绑定的标签关联
        if (!targetPreset && window.themeManager) {
            try {
                const tagIds = window.themeManager.getThemeTags(themeVal);
                if (tagIds && tagIds.length > 0) {
                    const tagLinks = extension_settings.twt.presetTagLinks || {};
                    for (const tagId of tagIds) {
                        if (tagLinks[tagId] && extension_settings.twt.visualPresets[tagLinks[tagId]]) {
                            targetPreset = tagLinks[tagId];
                            logWork(`检测到主题 [${themeVal}] 绑定了标签 [${tagId}]，触发关联预设 [${targetPreset}]`);
                            break;
                        }
                    }
                }
            } catch (err) {
                console.error('[TwT] 获取主题关联标签失败:', err);
            }
        }
        
        if (targetPreset && extension_settings.twt.visualPresets[targetPreset]) {
            logWork(`载入关联预设 [${targetPreset}]`);
            extension_settings.twt.currentPreset = targetPreset;
            $('#twt_visual_preset').val(targetPreset);
            applyPreset(targetPreset);
        }
    };

    const themeSelect = parentDoc.getElementById('themes');
    if (themeSelect) {
        $(themeSelect).off('change.twt').on('change.twt', function() {
            handleThemeChange($(this).val());
            // 切换主题时，实时重新计算不透明背景色并多次延迟重试以确保 CSS 变量已写入
            updateCommentsBgSolid();
            setTimeout(updateCommentsBgSolid, 100);
            setTimeout(updateCommentsBgSolid, 300);
        });
    }

    // Check initial active theme on startup
    if (themeSelect && $(themeSelect).val()) {
        handleThemeChange($(themeSelect).val());
    }

    // 监听 themeManager 标签变化事件，以重新计算关联预设
    const registerTagListener = () => {
        if (window.themeManager) {
            window.themeManager.onTagsChanged((latestTags) => {
                const currentTheme = themeSelect ? $(themeSelect).val() : null;
                if (currentTheme) {
                    handleThemeChange(currentTheme);
                }
            });
        }
    };

    if (window.themeManager) {
        registerTagListener();
    } else {
        let retries = 0;
        const checkInterval = setInterval(() => {
            retries++;
            if (window.themeManager) {
                clearInterval(checkInterval);
                registerTagListener();
            } else if (retries > 25) {
                clearInterval(checkInterval);
            }
        }, 200);
    }

    // 监听 body 和 html 的样式/类名变化，以捕获中途发生的主题变更，实时更新不透明背景色
    const themeObserver = new MutationObserver(() => {
        updateCommentsBgSolid();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
}

function bindUI() {
    const $enabled = $('#twt_enabled');
    const $swipeEnabled = $('#twt_swipe_enabled');
    const $messagePageEnabled = $('#twt_message_page_enabled');
    const $htmlPageBreakEnabled = $('#twt_html_page_break_enabled');
    const $avatarLayoutMode = $('#twt_avatar_layout_mode');
    const $customWhitelist = $('#twt_custom_whitelist');
    const $menuEnabled = $('#twt_menu_enabled');
    const $menuInvokeMethod = $('#twt_menu_invoke_method');
    const $menuLongpressDelay = $('#twt_menu_longpress_delay');
    const $menuDirection = $('#twt_menu_direction');
    const $menuOptRegenerate = $('#twt_menu_opt_regenerate');
    const $menuOptSwipe = $('#twt_menu_opt_swipe');
    const $menuOptManage = $('#twt_menu_opt_manage');
    const $menuOptEdit = $('#twt_menu_opt_edit');
    const $paragraphToolbarBottom = $('#twt_paragraph_toolbar_bottom');
    const $paragraphIconSize = $('#twt_paragraph_icon_size');
    const $paragraphXmlWhitelist = $('#twt_paragraph_xml_whitelist');
    const $menuOptEditFiltered = $('#twt_menu_opt_edit_filtered');
    const $menuOptExcerpt = $('#twt_menu_opt_excerpt');
    const $excerptTopOffset = $('#twt_excerpt_top_offset');
    const $excerptFontSize = $('#twt_excerpt_font_size');
    const $menuOptFullscreen = $('#twt_menu_opt_fullscreen');
    const $menuOptApi = $('#twt_menu_opt_api');
    const $menuOptPurifier = $('#twt_menu_opt_purifier');
    const $menuOptPurifierDiff = $('#twt_menu_opt_purifier_diff');
    const $menuOptNewChat = $('#twt_menu_opt_new_chat');
    const $menuOptCloseChat = $('#twt_menu_opt_close_chat');
    const $menuOptPromptViewer = $('#twt_menu_opt_prompt_viewer');
    const $menuStyle = $('#twt_menu_style');
    const $visualEnabled = $('#twt_visual_enabled');
    const $muluEnabled = $('#twt_mulu_enabled');
    
    const $paddingTop = $('#twt_padding_top');
    const $paddingBottom = $('#twt_padding_bottom');
    const $paddingLeft = $('#twt_padding_left');
    const $paddingRight = $('#twt_padding_right');
    const $fontSize = $('#twt_font_size');
    const $lineHeight = $('#twt_line_height');
    const $textIndent = $('#twt_text_indent');
    const $textAlign = $('#twt_text_align');
    const $paragraphSpacing = $('#twt_paragraph_spacing');
    const $letterSpacing = $('#twt_letter_spacing');
    const $fontWeight = $('#twt_font_weight');

    const $muluBtnStart = $('#twt_mulu_btn_start');
    const $muluBtnToc = $('#twt_mulu_btn_toc');
    const $muluBtnEnd = $('#twt_mulu_btn_end');

    // UI初始化
    $enabled.prop('checked', extension_settings.twt.enabled);
    $swipeEnabled.prop('checked', extension_settings.twt.swipeEnabled);
    $messagePageEnabled.prop('checked', extension_settings.twt.messagePageEnabled);
    $htmlPageBreakEnabled.prop('checked', extension_settings.twt.htmlPageBreakEnabled);
    $avatarLayoutMode.val(extension_settings.twt.avatarLayoutMode || 'float');
    $customWhitelist.val(extension_settings.twt.customWhitelist || '');
    $menuEnabled.prop('checked', extension_settings.twt.menuEnabled);
    $menuInvokeMethod.val(extension_settings.twt.menuInvokeMethod || 'longpress');
    $menuLongpressDelay.val(extension_settings.twt.menuLongpressDelay || 500);
    $menuDirection.val(extension_settings.twt.menuDirection || 'bottom-right');
    $menuOptRegenerate.prop('checked', extension_settings.twt.menuOptRegenerate);
    $menuOptSwipe.prop('checked', extension_settings.twt.menuOptSwipe);
    $menuOptManage.prop('checked', extension_settings.twt.menuOptManage);
    $menuOptEdit.prop('checked', extension_settings.twt.menuOptEdit);
    $paragraphToolbarBottom.val(extension_settings.twt.paragraphToolbarBottom !== undefined ? extension_settings.twt.paragraphToolbarBottom : 15);
    $paragraphIconSize.val(extension_settings.twt.paragraphIconSize !== undefined ? extension_settings.twt.paragraphIconSize : 20);
    $paragraphXmlWhitelist.val(extension_settings.twt.paragraphXmlWhitelist !== undefined ? extension_settings.twt.paragraphXmlWhitelist : 'thought, TavernThought, reasoning, details');
    $menuOptEditFiltered.prop('checked', extension_settings.twt.menuOptEditFiltered ?? false);
    $menuOptExcerpt.prop('checked', extension_settings.twt.menuOptExcerpt);
    $excerptTopOffset.val(extension_settings.twt.excerptTopOffset !== undefined ? extension_settings.twt.excerptTopOffset : 0);
    $excerptFontSize.val(extension_settings.twt.excerptFontSize !== undefined ? extension_settings.twt.excerptFontSize : 12);
    $menuOptFullscreen.prop('checked', extension_settings.twt.menuOptFullscreen);
    $menuOptApi.prop('checked', extension_settings.twt.menuOptApi);
    $menuOptPurifier.prop('checked', extension_settings.twt.menuOptPurifier);
    $menuOptPurifierDiff.prop('checked', extension_settings.twt.menuOptPurifierDiff);
    $menuOptNewChat.prop('checked', extension_settings.twt.menuOptNewChat);
    $menuOptCloseChat.prop('checked', extension_settings.twt.menuOptCloseChat);
    $menuOptPromptViewer.prop('checked', extension_settings.twt.menuOptPromptViewer);
    $menuStyle.val(extension_settings.twt.menuStyle || 'grid');
    
    updateParagraphSubOptionsVisibility();
    updateExcerptSubOptionsVisibility();
    
    const updateLongpressDelayRow = () => {
        if ($menuInvokeMethod.val() === 'longpress') {
            $('#twt_menu_longpress_delay_row').show();
        } else {
            $('#twt_menu_longpress_delay_row').hide();
        }
    };
    updateLongpressDelayRow();

    $visualEnabled.prop('checked', extension_settings.twt.visualEnabled);
    $muluEnabled.prop('checked', extension_settings.twt.muluEnabled);


    $paddingTop.val(extension_settings.twt.paddingTop);
    $paddingBottom.val(extension_settings.twt.paddingBottom);
    $paddingLeft.val(extension_settings.twt.paddingLeft);
    $paddingRight.val(extension_settings.twt.paddingRight);
    $fontSize.val(extension_settings.twt.fontSize);
    $lineHeight.val(extension_settings.twt.lineHeight);
    $textIndent.val(extension_settings.twt.textIndent ?? 0);
    $textAlign.val(extension_settings.twt.textAlign ?? 'left');
    $paragraphSpacing.val(extension_settings.twt.paragraphSpacing ?? 0);
    $letterSpacing.val(extension_settings.twt.letterSpacing ?? 0);
    $fontWeight.val(extension_settings.twt.fontWeight ?? 'normal');

    $muluBtnStart.prop('checked', extension_settings.twt.muluBtnStart);
    $muluBtnToc.prop('checked', extension_settings.twt.muluBtnToc);
    $muluBtnEnd.prop('checked', extension_settings.twt.muluBtnEnd);

    updateCustomFontsStyle();
    renderFontFamilyOptions();
    renderPresetList();
    renderMuluRegexPresetList();
    renderOptimizePatchList();

    $('#twt_mulu_regex_input').val(extension_settings.twt.customMuluRegex);

    // 预设相关
    $('#twt_visual_preset').on('change', function() {
        const val = $(this).val();
        extension_settings.twt.currentPreset = val;
        getContext().saveSettingsDebounced();
        applyPreset(val);
    });

    // 辅助切换页签方法
    const switchTab = (activeTab) => {
        if (activeTab === 'themes') {
            getEl('#twt-panel-themes').css('display', 'flex');
            getEl('#twt-panel-tags').css('display', 'none');
            getEl('#twt-tab-themes').css({
                'border-bottom': '2px solid var(--SmartThemeUnderlineColor, #007aff)',
                'font-weight': 'bold',
                'opacity': '1'
            });
            getEl('#twt-tab-tags').css({
                'border-bottom': 'none',
                'font-weight': 'normal',
                'opacity': '0.6'
            });
        } else {
            getEl('#twt-panel-themes').css('display', 'none');
            getEl('#twt-panel-tags').css('display', 'flex');
            getEl('#twt-tab-tags').css({
                'border-bottom': '2px solid var(--SmartThemeUnderlineColor, #007aff)',
                'font-weight': 'bold',
                'opacity': '1'
            });
            getEl('#twt-tab-themes').css({
                'border-bottom': 'none',
                'font-weight': 'normal',
                'opacity': '0.6'
            });
        }
    };

    // 绑定页签点击事件
    getEl('#twt-tab-themes').off('click').on('click', function(e) {
        e.stopPropagation();
        switchTab('themes');
    });

    getEl('#twt-tab-tags').off('click').on('click', function(e) {
        e.stopPropagation();
        switchTab('tags');
    });

    $('#twt_preset_link').on('click', function() {
        const currentPresetName = extension_settings.twt.currentPreset;
        if (!currentPresetName || currentPresetName === 'custom') {
            toastr.warning('“自定义”状态不可进行关联。', '提示');
            return;
        }
        
        getEl('#twt-link-preset-name').text(currentPresetName);
        
        // 渲染主题列表
        const $themeContainer = getEl('#twt-theme-checkboxes-container');
        $themeContainer.empty();
        getEl('#twt-theme-search').val('');
        
        const themes = getGlobalThemes();
        if (themes.length === 0) {
            $themeContainer.append(`<div style="font-size:0.9em; opacity:0.5; text-align:center; padding:10px;">未找到可用的全局美化主题。</div>`);
        } else {
            const links = extension_settings.twt.presetThemeLinks || {};
            themes.forEach(theme => {
                const isChecked = links[theme.val] === currentPresetName;
                $themeContainer.append(`
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0; font-size:0.95em; padding:4px 0; user-select:none;">
                        <input type="checkbox" class="twt-theme-link-cb" value="${theme.val}" ${isChecked ? 'checked' : ''} style="margin:0;" />
                        <span class="theme-name-text">${theme.name}</span>
                    </label>
                `);
            });
        }
        
        // 渲染标签列表 (如果 themeManager 可用)
        const $tagContainer = getEl('#twt-tag-checkboxes-container');
        $tagContainer.empty();
        getEl('#twt-tag-search').val('');
        
        if (window.themeManager) {
            getEl('#twt-link-tabs').css('display', 'flex');
            switchTab('themes'); // 默认展示主题页签
            
            try {
                const tags = window.themeManager.getTags();
                if (tags.length === 0) {
                    $tagContainer.append(`<div style="font-size:0.9em; opacity:0.5; text-align:center; padding:10px;">未找到可用的主题标签。</div>`);
                } else {
                    const tagLinks = extension_settings.twt.presetTagLinks || {};
                    tags.forEach(tag => {
                        const isChecked = tagLinks[tag.id] === currentPresetName;
                        $tagContainer.append(`
                            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0; font-size:0.95em; padding:4px 0; user-select:none;">
                                <input type="checkbox" class="twt-tag-link-cb" value="${tag.id}" ${isChecked ? 'checked' : ''} style="margin:0;" />
                                <span class="tag-name-text">${tag.name}</span>
                            </label>
                        `);
                    });
                }
            } catch (err) {
                console.error('[TwT] 获取主题管理器标签失败:', err);
                $tagContainer.append(`<div style="font-size:0.9em; opacity:0.5; text-align:center; padding:10px; color:var(--SmartThemeErrorColor);">获取标签失败。</div>`);
            }
        } else {
            // 没有主题管理器，隐藏页签直接展示主题列表
            getEl('#twt-link-tabs').css('display', 'none');
            switchTab('themes');
        }
        
        getEl('#twt-link-theme-modal').css('display', 'flex');
    });

    // 搜索过滤事件 (防抖延迟 1000ms 触发)
    let themeSearchTimeout;
    getEl('#twt-theme-search').off('input').on('input', function() {
        clearTimeout(themeSearchTimeout);
        const query = $(this).val().toLowerCase();
        themeSearchTimeout = setTimeout(() => {
            getEl('#twt-theme-checkboxes-container label').each(function() {
                const text = $(this).find('.theme-name-text').text().toLowerCase();
                if (text.includes(query)) {
                    $(this).css('display', 'flex');
                } else {
                    $(this).css('display', 'none');
                }
            });
        }, 1000);
    });

    let tagSearchTimeout;
    getEl('#twt-tag-search').off('input').on('input', function() {
        clearTimeout(tagSearchTimeout);
        const query = $(this).val().toLowerCase();
        tagSearchTimeout = setTimeout(() => {
            getEl('#twt-tag-checkboxes-container label').each(function() {
                const text = $(this).find('.tag-name-text').text().toLowerCase();
                if (text.includes(query)) {
                    $(this).css('display', 'flex');
                } else {
                    $(this).css('display', 'none');
                }
            });
        }, 1000);
    });

    getEl('#twt_link_theme_cancel').off('click').on('click', function(e) {
        e.stopPropagation();
        getEl('#twt-link-theme-modal').css('display', 'none');
    });

    getEl('#twt_link_theme_save').off('click').on('click', function(e) {
        e.stopPropagation();
        const currentPresetName = extension_settings.twt.currentPreset;
        if (!extension_settings.twt.presetThemeLinks) {
            extension_settings.twt.presetThemeLinks = {};
        }
        if (!extension_settings.twt.presetTagLinks) {
            extension_settings.twt.presetTagLinks = {};
        }
        
        const checkedThemes = [];
        getEl('#twt-theme-checkboxes-container .twt-theme-link-cb').each(function() {
            const val = $(this).val();
            const checked = $(this).prop('checked');
            if (checked) {
                extension_settings.twt.presetThemeLinks[val] = currentPresetName;
                checkedThemes.push(val);
            } else {
                if (extension_settings.twt.presetThemeLinks[val] === currentPresetName) {
                    delete extension_settings.twt.presetThemeLinks[val];
                }
            }
        });

        const checkedTags = [];
        if (window.themeManager) {
            getEl('#twt-tag-checkboxes-container .twt-tag-link-cb').each(function() {
                const val = $(this).val();
                const checked = $(this).prop('checked');
                if (checked) {
                    extension_settings.twt.presetTagLinks[val] = currentPresetName;
                    checkedTags.push(val);
                } else {
                    if (extension_settings.twt.presetTagLinks[val] === currentPresetName) {
                        delete extension_settings.twt.presetTagLinks[val];
                    }
                }
            });
        }
        
        getContext().saveSettingsDebounced();
        logWork(`更新预设 [${currentPresetName}] 关联：主题[${checkedThemes.join(', ') || '无'}], 标签[${checkedTags.join(', ') || '无'}]`);
        getEl('#twt-link-theme-modal').css('display', 'none');
    });

    getEl('#twt-link-theme-modal').off('click mousedown mouseup pointerdown pointerup touchstart').on('click mousedown mouseup pointerdown pointerup touchstart', function(e) {
        if (e.type === 'click' && e.target === this) {
            getEl('#twt-link-theme-modal').css('display', 'none');
        }
        e.stopPropagation();
    });

    // 新增预设
    $('#twt_preset_add').on('click', function() {
        const name = prompt('请输入新预设名称：', '新预设');
        if (name && name.trim().length > 0) {
            const trimmedName = name.trim();
            if (extension_settings.twt.visualPresets[trimmedName]) {
                if (!confirm(`预设 "${trimmedName}" 已存在，是否覆盖它？`)) {
                    return;
                }
            }
            saveCurrentToPreset(trimmedName);
            toastr.success(`已成功保存为新预设 "${trimmedName}"`, '提示');
        }
    });

    // 覆盖当前预设
    $('#twt_preset_save').on('click', function() {
        const current = extension_settings.twt.currentPreset;
        if (current && current !== 'custom') {
            saveCurrentToPreset(current);
            toastr.success(`已成功覆盖预设 "${current}"`, '提示');
        } else {
            toastr.warning('当前为“自定义”状态，请先点击“新增”创建预设。', '提示');
        }
    });

    $('#twt_preset_rename').on('click', function() {
        const current = extension_settings.twt.currentPreset;
        if (current !== 'custom') {
            const newName = prompt('重命名预设为：', current);
            if (newName && newName.trim().length > 0 && newName.trim() !== current) {
                const trimmedName = newName.trim();
                extension_settings.twt.visualPresets[trimmedName] = extension_settings.twt.visualPresets[current];
                delete extension_settings.twt.visualPresets[current];
                extension_settings.twt.currentPreset = trimmedName;
                getContext().saveSettingsDebounced();
                renderPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可重命名。', '提示');
        }
    });

    $('#twt_preset_delete').on('click', function() {
        const current = extension_settings.twt.currentPreset;
        if (current !== 'custom') {
            if (confirm(`确定要删除预设 "${current}" 吗？`)) {
                delete extension_settings.twt.visualPresets[current];
                extension_settings.twt.currentPreset = 'custom';
                getContext().saveSettingsDebounced();
                renderPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可删除。', '提示');
        }
    });

    // 目录正则相关事件绑定
    $('#twt_mulu_regex_preset').on('change', function() {
        const val = $(this).val();
        extension_settings.twt.currentMuluRegexPreset = val;
        getContext().saveSettingsDebounced();
        applyMuluRegexPreset(val);
    });

    $('#twt_mulu_regex_save').on('click', function() {
        const currentName = extension_settings.twt.currentMuluRegexPreset !== 'custom' ? extension_settings.twt.currentMuluRegexPreset : '新正则预设';
        const name = prompt('请输入正则预设名称：', currentName);
        if (name && name.trim().length > 0) {
            saveCurrentToMuluRegexPreset(name.trim());
        }
    });

    $('#twt_mulu_regex_rename').on('click', function() {
        const current = extension_settings.twt.currentMuluRegexPreset;
        if (current !== 'custom') {
            const newName = prompt('重命名正则预设为：', current);
            if (newName && newName.trim().length > 0 && newName.trim() !== current) {
                const trimmedName = newName.trim();
                extension_settings.twt.muluRegexPresets[trimmedName] = extension_settings.twt.muluRegexPresets[current];
                delete extension_settings.twt.muluRegexPresets[current];
                extension_settings.twt.currentMuluRegexPreset = trimmedName;
                getContext().saveSettingsDebounced();
                renderMuluRegexPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可重命名。', '提示');
        }
    });

    $('#twt_mulu_regex_delete').on('click', function() {
        const current = extension_settings.twt.currentMuluRegexPreset;
        if (current !== 'custom') {
            if (confirm(`确定要删除正则预设 "${current}" 吗？`)) {
                delete extension_settings.twt.muluRegexPresets[current];
                extension_settings.twt.currentMuluRegexPreset = 'custom';
                getContext().saveSettingsDebounced();
                renderMuluRegexPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可删除。', '提示');
        }
    });

    $('#twt_mulu_regex_input').on('input', function() {
        extension_settings.twt.customMuluRegex = $(this).val();
        if (extension_settings.twt.currentMuluRegexPreset !== 'custom') {
            extension_settings.twt.currentMuluRegexPreset = 'custom';
            $('#twt_mulu_regex_preset').val('custom');
        }
        getContext().saveSettingsDebounced();
    });

    // 搜索补丁与分类绑定
    $('#twt_optimize_search_toggle').on('click', function(e) {
        e.preventDefault();
        const $container = $('#twt_optimize_search_container');
        $container.slideToggle(150, function() {
            if ($container.is(':hidden')) {
                $('#twt_optimize_search_input').val('');
                currentOptimizeSearchQuery = '';
                renderOptimizePatchList();
            } else {
                $('#twt_optimize_search_input').focus();
            }
        });
    });

    $('#twt_optimize_search_input').on('input', function() {
        clearTimeout(optimizeSearchTimeout);
        const query = $(this).val().trim().toLowerCase();
        optimizeSearchTimeout = setTimeout(() => {
            currentOptimizeSearchQuery = query;
            renderOptimizePatchList();
        }, 1000); // 1s debounce
    });

    // 优化补丁事件绑定
    $('#twt_optimize_add').on('click', function() {
        const name = prompt('请输入新补丁名称：');
        if (name && name.trim().length > 0) {
            const trimmedName = name.trim();
            if (extension_settings.twt.optimizePatches[trimmedName]) {
                toastr.warning('同名补丁已存在！', '提示');
                return;
            }
            if (!extension_settings.twt.optimizePatches) {
                extension_settings.twt.optimizePatches = {};
            }
            extension_settings.twt.optimizePatches[trimmedName] = { code: '', active: true, folder: '' };
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
            openOptimizeEditor(trimmedName);
            updateInjectedStyles();
        }
    });

    // 新建分类文件夹
    $('#twt_optimize_add_folder').on('click', function() {
        const name = prompt('请输入新分类/文件夹名称：');
        if (name && name.trim().length > 0) {
            const trimmedName = name.trim();
            if (!extension_settings.twt.optimizeFolders) {
                extension_settings.twt.optimizeFolders = [];
            }
            if (extension_settings.twt.optimizeFolders.includes(trimmedName)) {
                toastr.warning('同名分类已存在！', '提示');
                return;
            }
            extension_settings.twt.optimizeFolders.push(trimmedName);
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    // 绑定分类文件夹重命名
    $('#twt_optimize_list').on('click', '.twt-folder-rename', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $folder = $(this).closest('.twt-optimize-folder');
        const oldName = $folder.attr('data-folder');
        if (!oldName) return; // 未分类不能重命名
        
        const newName = prompt('请输入新的分类名称：', oldName);
        if (newName && newName.trim().length > 0 && newName.trim() !== oldName) {
            const trimmed = newName.trim();
            if (!extension_settings.twt.optimizeFolders) {
                extension_settings.twt.optimizeFolders = [];
            }
            if (extension_settings.twt.optimizeFolders.includes(trimmed)) {
                toastr.warning('同名分类已存在！', '提示');
                return;
            }
            
            const idx = extension_settings.twt.optimizeFolders.indexOf(oldName);
            if (idx !== -1) {
                extension_settings.twt.optimizeFolders[idx] = trimmed;
            }
            
            // 更新补丁引用
            const patches = extension_settings.twt.optimizePatches || {};
            for (const key of Object.keys(patches)) {
                if (patches[key] && patches[key].folder === oldName) {
                    patches[key].folder = trimmed;
                }
            }
            
            // 迁移折叠记录
            if (oldName in collapsedFolders) {
                collapsedFolders[trimmed] = collapsedFolders[oldName];
                delete collapsedFolders[oldName];
            }
            
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    // 绑定分类文件夹删除
    $('#twt_optimize_list').on('click', '.twt-folder-delete', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $folder = $(this).closest('.twt-optimize-folder');
        const folderName = $folder.attr('data-folder');
        if (!folderName) return; // 未分类不能删除
        
        if (confirm(`确定要删除分类 "${folderName}" 吗？该分类下的补丁将移至“未分类”。`)) {
            const idx = extension_settings.twt.optimizeFolders.indexOf(folderName);
            if (idx !== -1) {
                extension_settings.twt.optimizeFolders.splice(idx, 1);
            }
            
            // 将此分类下补丁的 folder 清空
            const patches = extension_settings.twt.optimizePatches || {};
            for (const key of Object.keys(patches)) {
                if (patches[key] && patches[key].folder === folderName) {
                    patches[key].folder = '';
                }
            }
            
            if (folderName in collapsedFolders) {
                delete collapsedFolders[folderName];
            }
            
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    // 绑定分类文件夹收起/折叠点击
    $('#twt_optimize_list').on('click', '.twt-optimize-folder-header', function(e) {
        if ($(e.target).closest('button').length) return; // 忽略对操作按钮的点击
        const $folder = $(this).closest('.twt-optimize-folder');
        const folderName = $folder.attr('data-folder') || '';
        const $content = $folder.find('.twt-optimize-folder-content');
        const $chevron = $(this).find('.twt-folder-chevron');
        const $folderIcon = $(this).find('.twt-folder-icon');
        
        $content.slideToggle(150, () => {
            const isHidden = $content.is(':hidden');
            collapsedFolders[folderName] = isHidden;
            if (isHidden) {
                $chevron.css('transform', 'rotate(-90deg)');
                $folderIcon.removeClass('fa-folder-open').addClass('fa-folder');
            } else {
                $chevron.css('transform', 'none');
                $folderIcon.removeClass('fa-folder').addClass('fa-folder-open');
            }
        });
    });

    // 移动补丁至新分类
    $('#twt_optimize_list').on('change', '.twt-patch-folder-select', function() {
        const $item = $(this).closest('.twt-optimize-item');
        const patchName = $item.data('name');
        const targetFolder = $(this).val();
        
        if (extension_settings.twt.optimizePatches[patchName]) {
            extension_settings.twt.optimizePatches[patchName].folder = targetFolder;
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    getEl('#twt_optimize_close_editor').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeOptimizeEditor();
    });

    getEl('#twt_optimize_save_editor').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (currentlyEditingPatchName) {
            const name = currentlyEditingPatchName;
            const code = getEl('#twt_optimize_code').val();
            if (extension_settings.twt.optimizePatches[name]) {
                extension_settings.twt.optimizePatches[name].code = code;
                getContext().saveSettingsDebounced();
                updateInjectedStyles();
            }
        }
        closeOptimizeEditor();
    });

    getEl('#twt-optimize-editor-modal').off('click mousedown mouseup pointerdown pointerup touchstart').on('click mousedown mouseup pointerdown pointerup touchstart', function(e) {
        e.stopPropagation();
        if ($(e.target).is('#twt-optimize-editor-modal')) {
            e.preventDefault();
            closeOptimizeEditor();
        }
    });

    $('#twt_optimize_list').on('change', '.twt-patch-checkbox', function() {
        const $item = $(this).closest('.twt-optimize-item');
        const name = $item.data('name');
        const active = $(this).prop('checked');
        if (extension_settings.twt.optimizePatches[name]) {
            extension_settings.twt.optimizePatches[name].active = active;
            getContext().saveSettingsDebounced();
            updateInjectedStyles();
        }
    });

    $('#twt_optimize_list').on('click', '.twt-patch-edit', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.twt-optimize-item');
        const name = $item.data('name');
        openOptimizeEditor(name);
    });

    $('#twt_optimize_list').on('click', '.twt-patch-rename', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.twt-optimize-item');
        const current = $item.data('name');
        const newName = prompt('重命名补丁为：', current);
        if (newName && newName.trim().length > 0 && newName.trim() !== current) {
            const trimmedName = newName.trim();
            if (extension_settings.twt.optimizePatches[trimmedName]) {
                toastr.warning('同名补丁已存在！', '提示');
                return;
            }
            extension_settings.twt.optimizePatches[trimmedName] = extension_settings.twt.optimizePatches[current];
            delete extension_settings.twt.optimizePatches[current];
            if (currentlyEditingPatchName === current) {
                currentlyEditingPatchName = trimmedName;
                getEl('#twt_optimize_editor_title').text(`正在编辑: ${trimmedName}`);
            }
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
            updateInjectedStyles();
        }
    });

    $('#twt_optimize_list').on('click', '.twt-patch-delete', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.twt-optimize-item');
        const current = $item.data('name');
        if (confirm(`确定要删除补丁 "${current}" 吗？`)) {
            delete extension_settings.twt.optimizePatches[current];
            if (currentlyEditingPatchName === current) {
                closeOptimizeEditor();
            }
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
            updateInjectedStyles();
        }
    });

    const handleVisualChange = () => {
        getContext().saveSettingsDebounced();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    };

    // 开关相关
    $enabled.on('change', function () {
        extension_settings.twt.enabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updatePageTabVisibility();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $swipeEnabled.on('change', function () {
        extension_settings.twt.swipeEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $messagePageEnabled.on('change', function () {
        extension_settings.twt.messagePageEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $htmlPageBreakEnabled.on('change', function () {
        extension_settings.twt.htmlPageBreakEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $avatarLayoutMode.on('change', function () {
        extension_settings.twt.avatarLayoutMode = $(this).val();
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $customWhitelist.on('input', function () {
        extension_settings.twt.customWhitelist = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $menuEnabled.on('change', function () {
        extension_settings.twt.menuEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateMenuTabVisibility();
        applyMenuMode(extension_settings.twt.menuEnabled, extension_settings.twt);
    });

    $menuInvokeMethod.on('change', function () {
        extension_settings.twt.menuInvokeMethod = $(this).val();
        getContext().saveSettingsDebounced();
        updateLongpressDelayRow();
    });

    $menuDirection.on('change', function () {
        extension_settings.twt.menuDirection = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $menuLongpressDelay.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.menuLongpressDelay = val;
            getContext().saveSettingsDebounced();
        }
    });

    $menuOptRegenerate.on('change', function () {
        extension_settings.twt.menuOptRegenerate = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptSwipe.on('change', function () {
        extension_settings.twt.menuOptSwipe = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptManage.on('change', function () {
        extension_settings.twt.menuOptManage = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptEdit.on('change', function () {
        extension_settings.twt.menuOptEdit = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateParagraphSubOptionsVisibility();
    });

    $paragraphToolbarBottom.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.paragraphToolbarBottom = val;
            getContext().saveSettingsDebounced();
            const $toolbar = $('#twt-paragraph-toolbar');
            if ($toolbar.length) {
                $toolbar.css('bottom', val + 'px');
            }
        }
    });

    $paragraphIconSize.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.paragraphIconSize = val;
            getContext().saveSettingsDebounced();
            const $toolbar = $('#twt-paragraph-toolbar');
            if ($toolbar.length) {
                $toolbar.css('--twt-paragraph-icon-size', val + 'px');
            }
        }
    });

    $paragraphXmlWhitelist.on('input', function () {
        extension_settings.twt.paragraphXmlWhitelist = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $menuOptEditFiltered.on('change', function () {
        extension_settings.twt.menuOptEditFiltered = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptExcerpt.on('change', function () {
        extension_settings.twt.menuOptExcerpt = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateExcerptSubOptionsVisibility();
    });

    $excerptTopOffset.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.excerptTopOffset = val;
            getContext().saveSettingsDebounced();
            updateLiveExcerptBar();
        }
    });

    $excerptFontSize.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.excerptFontSize = val;
            getContext().saveSettingsDebounced();
            updateLiveExcerptBar();
        }
    });



    $menuOptFullscreen.on('change', function () {
        extension_settings.twt.menuOptFullscreen = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptApi.on('change', function () {
        extension_settings.twt.menuOptApi = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptPurifier.on('change', function () {
        extension_settings.twt.menuOptPurifier = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptPurifierDiff.on('change', function () {
        extension_settings.twt.menuOptPurifierDiff = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptNewChat.on('change', function () {
        extension_settings.twt.menuOptNewChat = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptCloseChat.on('change', function () {
        extension_settings.twt.menuOptCloseChat = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptPromptViewer.on('change', function () {
        extension_settings.twt.menuOptPromptViewer = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuStyle.on('change', function () {
        extension_settings.twt.menuStyle = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $visualEnabled.on('change', function () {
        extension_settings.twt.visualEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateVisualTabVisibility();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
        updateInjectedStyles();
    });

    $('.twt-collapsible-header').off('click').on('click', function () {
        const $content = $(this).next('.twt-collapsible-content');
        const $icon = $(this).find('.twt-collapsible-icon');
        $content.slideToggle(150);
        $icon.toggleClass('rotated');
    });

    $muluEnabled.on('change', function () {
        extension_settings.twt.muluEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateMuluTabVisibility();
        applyMuluSettings();
    });

    $muluBtnStart.on('change', function () {
        extension_settings.twt.muluBtnStart = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
    });

    $muluBtnToc.on('change', function () {
        extension_settings.twt.muluBtnToc = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
    });

    $muluBtnEnd.on('change', function () {
        extension_settings.twt.muluBtnEnd = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
    });

    // 视觉输入框
    $paddingTop.on('input', function () {
        const val = parseInt($paddingTop.val());
        if (!isNaN(val)) { extension_settings.twt.paddingTop = val; handleVisualChange(); }
    });

    $paddingBottom.on('input', function () {
        const val = parseInt($paddingBottom.val());
        if (!isNaN(val)) { extension_settings.twt.paddingBottom = val; handleVisualChange(); }
    });

    $paddingLeft.on('input', function () {
        const val = parseInt($paddingLeft.val());
        if (!isNaN(val)) { extension_settings.twt.paddingLeft = val; handleVisualChange(); }
    });

    $paddingRight.on('input', function () {
        const val = parseInt($paddingRight.val());
        if (!isNaN(val)) { extension_settings.twt.paddingRight = val; handleVisualChange(); }
    });

    $fontSize.on('input', function () {
        const val = parseInt($fontSize.val());
        if (!isNaN(val)) { extension_settings.twt.fontSize = val; handleVisualChange(); }
    });

    $lineHeight.on('input', function () {
        const val = parseFloat($lineHeight.val());
        if (!isNaN(val)) { extension_settings.twt.lineHeight = val; handleVisualChange(); }
    });

    $textIndent.on('input', function () {
        const val = parseFloat($textIndent.val());
        if (!isNaN(val)) { extension_settings.twt.textIndent = val; handleVisualChange(); }
    });

    $textAlign.on('change', function () {
        extension_settings.twt.textAlign = $(this).val();
        handleVisualChange();
    });

    $paragraphSpacing.on('input', function () {
        const val = parseFloat($paragraphSpacing.val());
        if (!isNaN(val)) { extension_settings.twt.paragraphSpacing = val; handleVisualChange(); }
    });

    $letterSpacing.on('input', function () {
        const val = parseFloat($letterSpacing.val());
        if (!isNaN(val)) { extension_settings.twt.letterSpacing = val; handleVisualChange(); }
    });

    $fontWeight.on('change', function () {
        extension_settings.twt.fontWeight = $(this).val();
        handleVisualChange();
    });

    $('#twt_font_family').on('change', function () {
        extension_settings.twt.fontFamily = $(this).val();
        handleVisualChange();
    });

    $('#twt_font_import_file').on('click', function () {
        $('#twt_font_file_input').trigger('click');
    });

    $('#twt_font_file_input').on('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const defaultName = file.name.replace(/\.[^/.]+$/, '');
        const fontName = prompt('请输入字体显示名称：', defaultName);
        if (!fontName || !fontName.trim()) {
            $(this).val('');
            return;
        }
        const trimmedName = fontName.trim();

        const ext = file.name.split('.').pop().toLowerCase();
        let formatHint = '';
        if (ext === 'ttf') formatHint = ' format("truetype")';
        else if (ext === 'otf') formatHint = ' format("opentype")';
        else if (ext === 'woff') formatHint = ' format("woff")';
        else if (ext === 'woff2') formatHint = ' format("woff2")';
        else if (ext === 'eot') formatHint = ' format("embedded-opentype")';

        const reader = new FileReader();
        reader.onload = function (evt) {
            let dataUrl = evt.target.result;
            if (typeof dataUrl === 'string' && (dataUrl.startsWith('data:application/octet-stream') || dataUrl.startsWith('data:;'))) {
                const mimeMap = {
                    ttf: 'font/ttf',
                    otf: 'font/otf',
                    woff: 'font/woff',
                    woff2: 'font/woff2',
                    eot: 'application/vnd.ms-fontobject'
                };
                const mime = mimeMap[ext] || 'font/ttf';
                dataUrl = dataUrl.replace(/^data:[^;]*/, `data:${mime}`);
            }

            const fontFaceCss = `@font-face {\n  font-family: "${trimmedName}";\n  src: url("${dataUrl}")${formatHint};\n  font-display: swap;\n}`;
            if (!extension_settings.twt.customFonts) extension_settings.twt.customFonts = {};
            extension_settings.twt.customFonts[trimmedName] = {
                name: trimmedName,
                family: trimmedName,
                css: fontFaceCss
            };
            extension_settings.twt.fontFamily = trimmedName;
            updateCustomFontsStyle();
            renderFontFamilyOptions();
            handleVisualChange();
            $('#twt_font_file_input').val('');
        };
        reader.readAsDataURL(file);
    });

    $('#twt_font_import_css').on('click', function () {
        const cssInput = prompt('请输入字体 CSS 代码或网络 URL (支持直接粘贴包含 @import、@font-face 或 body { font-family: ... } 的完整代码片段)：');
        if (!cssInput || !cssInput.trim()) return;
        const input = cssInput.trim();

        let cleanCss = '';
        let detectedFamily = '';

        // Extract @import if present
        const importMatch = input.match(/@import\s+url\((["']?)([^"']+)\1\);?/i);
        if (importMatch) {
            cleanCss = `@import url("${importMatch[2]}");`;
        }

        // Extract font-family if present
        const familyMatch = input.match(/font-family\s*:\s*["']?([^"';}\r\n]+)["']?/i);
        if (familyMatch) {
            detectedFamily = familyMatch[1].trim();
        }

        // If direct HTTP URL with no @import wrapper
        if (!cleanCss && (input.startsWith('http://') || input.startsWith('https://'))) {
            cleanCss = `@import url("${input}");`;
        }

        // If @font-face block (not @import)
        if (!cleanCss && /@font-face/i.test(input)) {
            const fontFaceMatch = input.match(/@font-face\s*\{[\s\S]*?\}/i);
            cleanCss = fontFaceMatch ? fontFaceMatch[0] : input;
        }

        if (!cleanCss) {
            cleanCss = input;
        }

        const defaultName = detectedFamily || 'MyCustomFont';
        const fontName = prompt('请确认/修改字体显示名称：', defaultName);
        if (!fontName || !fontName.trim()) return;
        const finalName = fontName.trim();
        const finalFamily = detectedFamily || finalName;

        // If @font-face block (not @import), update font-family in @font-face to match finalFamily
        if (!importMatch && /font-family\s*:/i.test(cleanCss)) {
            cleanCss = cleanCss.replace(/font-family\s*:\s*["']?([^"';}]+)["']?/i, `font-family: "${finalFamily}"`);
        }

        if (!extension_settings.twt.customFonts) extension_settings.twt.customFonts = {};
        extension_settings.twt.customFonts[finalName] = {
            name: finalName,
            family: finalFamily,
            css: cleanCss
        };
        extension_settings.twt.fontFamily = finalFamily;
        updateCustomFontsStyle();
        renderFontFamilyOptions();
        handleVisualChange();
    });


    $('#twt_font_delete').on('click', function () {
        const currentFont = $('#twt_font_family').val();
        if (!currentFont || currentFont === 'inherit' || BUILTIN_FONTS[currentFont]) {
            alert('系统默认及内置字体不可删除');
            return;
        }
        const customFonts = extension_settings.twt.customFonts || {};
        let keyToDelete = null;
        for (const [k, v] of Object.entries(customFonts)) {
            if (k === currentFont || (v && v.family === currentFont)) {
                keyToDelete = k;
                break;
            }
        }
        if (keyToDelete && customFonts[keyToDelete]) {
            const dispName = customFonts[keyToDelete].name || keyToDelete;
            if (confirm(`确定要删除自定义字体 "${dispName}" 吗？`)) {
                delete customFonts[keyToDelete];
                extension_settings.twt.fontFamily = 'inherit';
                updateCustomFontsStyle();
                renderFontFamilyOptions();
                handleVisualChange();
            }
        }
    });



    $('#twt-settings').on('click', '.twt-tab', function() {
        $('#twt-settings .twt-tab').removeClass('active');
        $('#twt-settings .twt-tab-content').hide().removeClass('active');

        $(this).addClass('active');
        const targetId = $(this).data('tab');
        $('#' + targetId).show().addClass('active');
    });

    const $commentsEnabled = $('#twt_comments_enabled');
    $commentsEnabled.prop('checked', extension_settings.twt.commentsEnabled);
    
    const updateCommentsBtnVisibilityLocal = () => {
        if ($commentsEnabled.prop('checked')) {
            $('#twt_comments_btn_row').show();
        } else {
            $('#twt_comments_btn_row').hide();
        }
    };
    updateCommentsBtnVisibilityLocal();

    $commentsEnabled.on('change', function () {
        extension_settings.twt.commentsEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateCommentsTabVisibility();
        updateCommentsBtnVisibilityLocal();
        if (window.twtRefreshComments) {
            window.twtRefreshComments();
        }
    });

    // Wire up comments settings overlay button
    $('#twt_comments_open_editor_btn').on('click', () => {
        initCommentsEditor();
    });

    renderMenuOrderList();
}

function renderMenuOrderList() {
    const $container = $('#twt_menu_order_list');
    if (!$container.length) return;
    $container.empty();

    const order = extension_settings.twt.menuOrder || [
        'menuOptRegenerate',
        'menuOptSwipe',
        'menuOptManage',
        'menuOptEdit',
        'menuOptNewChat',
        'menuOptCloseChat',
        'menuOptExcerpt',
        'menuOptFullscreen',
        'menuOptApi',
        'menuOptPurifier',
        'menuOptPurifierDiff',
        'menuOptPromptViewer'
    ];

    const labels = {
        menuOptRegenerate: '重新生成',
        menuOptSwipe: '滑动',
        menuOptManage: '管理消息',
        menuOptEdit: '分段编辑',
        menuOptNewChat: '新对话',
        menuOptCloseChat: '关闭',
        menuOptExcerpt: '摘抄',
        menuOptFullscreen: '全屏',
        menuOptApi: 'API',
        menuOptPurifier: '净化词汇映射',
        menuOptPurifierDiff: '净化前文透视',
        menuOptPromptViewer: '提示词'
    };

    order.forEach((key, index) => {
        const label = labels[key] || key;
        const $row = $(`
            <div class="twt-order-row" data-key="${key}" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--SmartThemeDarkColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; margin-bottom: 5px;">
                <span>${label}</span>
                <div style="display: flex; gap: 8px;">
                    <button class="twt-order-up menu_button" style="padding: 2px 6px; font-size: 0.85em; cursor: pointer;" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button class="twt-order-down menu_button" style="padding: 2px 6px; font-size: 0.85em; cursor: pointer;" ${index === order.length - 1 ? 'disabled' : ''}>▼</button>
                </div>
            </div>
        `);

        $row.find('.twt-order-up').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (index > 0) {
                const temp = order[index];
                order[index] = order[index - 1];
                order[index - 1] = temp;
                extension_settings.twt.menuOrder = order;
                getContext().saveSettingsDebounced();
                renderMenuOrderList();
            }
        });

        $row.find('.twt-order-down').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (index < order.length - 1) {
                const temp = order[index];
                order[index] = order[index + 1];
                order[index + 1] = temp;
                extension_settings.twt.menuOrder = order;
                getContext().saveSettingsDebounced();
                renderMenuOrderList();
            }
        });

        $container.append($row);
    });
}

function initCommentsEditor() {
    const $overlay = getEl('#twt-comments-editor-overlay');
    const $closeBtn = getEl('#twt_comments_editor_close');
    
    updateCommentsBgSolid();
    $overlay.fadeIn(200);

    // Sub-tab switching inside the editor
    $overlay.find('.twt-editor-subtab').off('click').on('click', function() {
        $overlay.find('.twt-editor-subtab').removeClass('active');
        $overlay.find('.twt-subtab-content').hide();
        
        $(this).addClass('active');
        const targetId = $(this).data('subtab');
        $overlay.find('#' + targetId).show();
    });

    $closeBtn.off('click').on('click', () => {
        $overlay.fadeOut(200);
    });

    // ==========================================
    // API Tab Management
    // ==========================================
    let currentlySelectedApiId = extension_settings.twt.commentsSelectedApiId || 'main';
    let localApis = JSON.parse(JSON.stringify(extension_settings.twt.commentsApis || []));

    function renderApisTab() {
        const $select = $('#twt_comments_api_select');
        $select.empty();
        
        $select.append($('<option></option>').val('main').text('沿用酒馆当前主 API'));
        localApis.forEach(api => {
            $select.append($('<option></option>').val(api.id).text(api.name));
        });
        
        $select.val(currentlySelectedApiId);
        
        if (currentlySelectedApiId === 'main') {
            $('#twt_comments_api_edit_section').hide();
        } else {
            const api = localApis.find(a => a.id === currentlySelectedApiId);
            if (api) {
                $('#twt_comments_api_edit_section').show();
                $('#twt_comments_api_form_title').text(`编辑 API 接口: ${api.name}`);
                $('#twt_comments_api_name').val(api.name);
                $('#twt_comments_api_url').val(api.url);
                $('#twt_comments_api_key').val(api.key);
                $('#twt_comments_api_model').val(api.model);
                $('#twt_comments_api_model_select').hide();
                $('#twt_api_test_status').hide();
            } else {
                $('#twt_comments_api_edit_section').hide();
            }
        }
    }

    $('#twt_comments_api_select').off('change').on('change', function() {
        currentlySelectedApiId = $(this).val();
        renderApisTab();
    });

    $('#twt_comments_api_add_btn').off('click').on('click', () => {
        const id = 'api_' + Date.now();
        const newApi = {
            id: id,
            name: '未命名接口',
            url: 'http://localhost:11434/v1',
            key: '',
            model: 'qwen2.5'
        };
        localApis.push(newApi);
        currentlySelectedApiId = id;
        renderApisTab();
    });

    $('#twt_comments_api_delete_btn').off('click').on('click', () => {
        if (currentlySelectedApiId === 'main') return;
        if (confirm('确定要删除这个 API 接口配置吗？')) {
            localApis = localApis.filter(a => a.id !== currentlySelectedApiId);
            currentlySelectedApiId = 'main';
            renderApisTab();
        }
    });

    $('#twt_comments_api_save_btn').off('click').on('click', () => {
        if (currentlySelectedApiId !== 'main') {
            const api = localApis.find(a => a.id === currentlySelectedApiId);
            if (api) {
                api.name = $('#twt_comments_api_name').val().trim() || '未命名接口';
                api.url = $('#twt_comments_api_url').val().trim();
                api.key = $('#twt_comments_api_key').val().trim();
                api.model = $('#twt_comments_api_model').val().trim();
            }
        }
        extension_settings.twt.commentsApis = JSON.parse(JSON.stringify(localApis));
        extension_settings.twt.commentsSelectedApiId = currentlySelectedApiId;
        getContext().saveSettingsDebounced();
        toastr.success('API 接口配置保存成功！', '成功');
        renderApisTab();
    });

    $('#twt_comments_api_test_btn').off('click').on('click', async () => {
        const url = $('#twt_comments_api_url').val().trim();
        const key = $('#twt_comments_api_key').val().trim();
        const $status = $('#twt_api_test_status');
        
        if (!url) {
            toastr.warning('请先输入 API Base URL！', '提示');
            return;
        }

        $status.show().css('color', 'var(--SmartThemeBodyColor)').html('<i class="fa-solid fa-spinner fa-spin"></i> 测试中...');

        try {
            const headers = { 'Accept': 'application/json' };
            if (key) {
                headers['Authorization'] = `Bearer ${key}`;
            }

            const response = await fetch(`${url}/models`, {
                method: 'GET',
                headers: headers
            });

            if (response.ok) {
                $status.css('color', '#4caf50').html('<i class="fa-solid fa-circle-check"></i> 连接成功');
                toastr.success('连接测试成功！', '成功');
            } else {
                const errText = await response.text();
                $status.css('color', '#ff4444').html('<i class="fa-solid fa-circle-xmark"></i> 连接失败');
                toastr.error(`连接失败 (${response.status}): ${errText.substring(0, 100)}`, '错误');
            }
        } catch (err) {
            console.error('API connection test failed:', err);
            $status.css('color', '#ff4444').html('<i class="fa-solid fa-circle-xmark"></i> 连接出错');
            toastr.error(`连接出错: ${err.message || err}`, '错误');
        }
    });

    $('#twt_comments_api_fetch_models_btn').off('click').on('click', async () => {
        const url = $('#twt_comments_api_url').val().trim();
        const key = $('#twt_comments_api_key').val().trim();
        const $select = $('#twt_comments_api_model_select');
        
        if (!url) {
            toastr.warning('请先输入 API Base URL！', '提示');
            return;
        }

        toastr.info('正在获取可用模型列表...', '提示');

        try {
            const headers = { 'Accept': 'application/json' };
            if (key) {
                headers['Authorization'] = `Bearer ${key}`;
            }

            const response = await fetch(`${url}/models`, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
            }

            const json = await response.json();
            const models = (json.data || []).map(m => m.id);

            if (models.length === 0) {
                toastr.info('获取成功，但未找到任何可用模型。', '提示');
                return;
            }

            $select.empty().show();
            $select.append($('<option></option>').val('').text('-- 选择模型 --'));
            models.forEach(model => {
                $select.append($('<option></option>').val(model).text(model));
            });

            $select.off('change').on('change', function() {
                const val = $(this).val();
                if (val) {
                    $('#twt_comments_api_model').val(val);
                }
            });

            toastr.success(`成功拉取到 ${models.length} 个模型！`, '成功');
        } catch (err) {
            console.error('Fetch models failed:', err);
            toastr.error(`获取模型失败: ${err.message || err}`, '错误');
        }
    });

    // ==========================================
    // Prompts Preset Tab Management
    // ==========================================
    let currentPresetName = extension_settings.twt.commentsCurrentPreset || '网络读者弹幕吐槽';
    let localPresets = JSON.parse(JSON.stringify(extension_settings.twt.commentsPromptPresets || {}));

    function renderPromptsTab() {
        const $select = $('#twt_comments_preset_select');
        $select.empty();
        
        Object.keys(localPresets).forEach(name => {
            $select.append($('<option></option>').val(name).text(name));
        });
        
        if (!localPresets[currentPresetName]) {
            currentPresetName = Object.keys(localPresets)[0] || '网络读者弹幕吐槽';
        }
        $select.val(currentPresetName);
        
        renderPromptItemsList();
    }

    $('#twt_comments_preset_select').off('change').on('change', function() {
        saveCurrentPromptItemsToMemory();
        currentPresetName = $(this).val();
        renderPromptsTab();
    });

    $('#twt_comments_preset_add_btn').off('click').on('click', () => {
        const name = prompt('请输入新提示词预设名称：');
        if (name && name.trim().length > 0) {
            saveCurrentPromptItemsToMemory();
            const trimmed = name.trim();
            localPresets[trimmed] = [
                { role: 'system', content: '你是一个小说读者。', enabled: true }
            ];
            currentPresetName = trimmed;
            renderPromptsTab();
        }
    });

    $('#twt_comments_preset_dup_btn').off('click').on('click', () => {
        const name = prompt('请输入复制后的预设名称：', currentPresetName + '_copy');
        if (name && name.trim().length > 0) {
            saveCurrentPromptItemsToMemory();
            const trimmed = name.trim();
            localPresets[trimmed] = JSON.parse(JSON.stringify(localPresets[currentPresetName] || []));
            currentPresetName = trimmed;
            renderPromptsTab();
        }
    });

    $('#twt_comments_preset_rename_btn').off('click').on('click', () => {
        const name = prompt('请输入预设的新名称：', currentPresetName);
        if (name && name.trim().length > 0 && name.trim() !== currentPresetName) {
            const trimmed = name.trim();
            localPresets[trimmed] = localPresets[currentPresetName];
            delete localPresets[currentPresetName];
            currentPresetName = trimmed;
            renderPromptsTab();
        }
    });

    $('#twt_comments_preset_del_btn').off('click').on('click', () => {
        const keys = Object.keys(localPresets);
        if (keys.length <= 1) {
            toastr.warning('必须保留至少一个提示词预设。', '提示');
            return;
        }
        if (confirm(`确定要删除预设 "${currentPresetName}" 吗？`)) {
            delete localPresets[currentPresetName];
            currentPresetName = Object.keys(localPresets)[0];
            renderPromptsTab();
        }
    });

    // 导出预设
    $('#twt_comments_preset_export_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        const presetData = {
            name: currentPresetName,
            messages: localPresets[currentPresetName] || []
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presetData, null, 4));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href",     dataStr);
        downloadAnchor.setAttribute("download", `twt_preset_${currentPresetName}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        toastr.success(`预设 "${currentPresetName}" 已成功导出！`, '导出成功');
    });

    // 导入预设
    $('#twt_comments_preset_import_btn').off('click').on('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    if (!imported || typeof imported.name !== 'string' || !Array.isArray(imported.messages)) {
                        throw new Error('JSON 格式不正确。必须包含 name 和 messages 属性。');
                    }
                    
                    let importName = imported.name.trim();
                    if (!importName) {
                        importName = '未命名导入预设';
                    }
                    
                    // 如果重名，重命名
                    let finalName = importName;
                    let counter = 1;
                    while (localPresets[finalName]) {
                        finalName = `${importName}_${counter}`;
                        counter++;
                    }
                    
                    localPresets[finalName] = imported.messages;
                    currentPresetName = finalName;
                    
                    // 保存到酒馆设置中并重新渲染
                    saveCurrentPromptItemsToMemory();
                    extension_settings.twt.commentsPromptPresets = JSON.parse(JSON.stringify(localPresets));
                    extension_settings.twt.commentsCurrentPreset = currentPresetName;
                    getContext().saveSettingsDebounced();

                    renderPromptsTab();
                    toastr.success(`成功导入预设 "${finalName}"！`, '导入成功');
                } catch (err) {
                    console.error('导入预设失败:', err);
                    toastr.error(`导入失败：${err.message || '文件解析错误'}`, '错误');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    function saveCurrentPromptItemsToMemory() {
        const items = [];
        $('#twt-comments-prompt-items-container .twt-prompt-item-card').each(function() {
            const role = $(this).find('.twt-prompt-item-role-select').val();
            const enabled = $(this).find('.twt-prompt-item-enable-toggle').prop('checked');
            const name = $(this).find('.twt-prompt-item-name-input').val();
            const content = $(this).find('.twt-prompt-item-textarea').val();
            const collapsed = $(this).hasClass('collapsed');
            items.push({ role, enabled, name, content, collapsed });
        });
        if (currentPresetName) {
            localPresets[currentPresetName] = items;
        }
    }

    function renderPromptItemsList() {
        const container = $('#twt-comments-prompt-items-container');
        container.empty();
        
        const items = localPresets[currentPresetName] || [];
        items.forEach((item, index) => {
            const isCollapsed = item.collapsed !== false; // Default to true (collapsed)
            const collapsedClass = isCollapsed ? 'collapsed' : '';
            const textareaStyle = isCollapsed ? 'display: none;' : '';
            const caretIcon = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
            
            const card = $(`
                <div class="twt-prompt-item-card ${collapsedClass}" data-index="${index}" style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="twt-prompt-item-row" style="cursor: pointer; user-select: none;">
                        <div class="twt-prompt-item-left">
                            <span class="twt-prompt-item-toggle-collapse" style="cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;"><i class="fa-solid ${caretIcon}"></i></span>
                            <span style="font-weight: bold; font-size: 0.85em; opacity: 0.5;">#${index + 1}</span>
                            <select class="twt-prompt-item-role-select" style="background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; padding: 3px; font-size: 0.85em; width: auto; max-width: 110px;">
                                <option value="system" ${item.role === 'system' ? 'selected' : ''}>System (系统)</option>
                                <option value="user" ${item.role === 'user' ? 'selected' : ''}>User (用户)</option>
                                <option value="assistant" ${item.role === 'assistant' ? 'selected' : ''}>Assistant (AI)</option>
                            </select>
                            <input type="text" class="twt-prompt-item-name-input" placeholder="条目名称，如：背景上下文" value="${item.name || ''}" style="flex: 1; min-width: 100px; max-width: 250px; font-size: 0.85em; padding: 3px 6px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;" />
                        </div>
                        <div class="twt-prompt-item-right">
                            <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer; margin: 0; white-space: nowrap;">
                                <input type="checkbox" class="twt-prompt-item-enable-toggle" ${item.enabled !== false ? 'checked' : ''} /> 启用
                            </label>
                            <button class="twt-prompt-item-fullscreen-btn menu_button" style="padding: 3px 6px; margin: 0; font-size: 0.8em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="全屏编辑这行内容"><i class="fa-solid fa-expand"></i> 全屏</button>
                            <button class="twt-prompt-item-dup-btn menu_button" style="padding: 3px 6px; margin: 0; font-size: 0.8em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="复制此条目"><i class="fa-regular fa-copy"></i> 复制</button>
                            <button class="twt-prompt-item-del-btn menu_button" style="padding: 3px 6px; margin: 0; color: #ff4444; font-size: 0.8em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="删除此条目"><i class="fa-solid fa-trash"></i> 删除</button>
                        </div>
                    </div>
                    <textarea class="twt-prompt-item-textarea" placeholder="消息内容..." style="width: 100%; height: 80px; box-sizing: border-box; padding: 6px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; resize: vertical; ${textareaStyle}">${item.content || ''}</textarea>
                </div>
            `);
            
            // Prevent event bubbling when clicking inside input, select, label or buttons in header
            card.find('.twt-prompt-item-role-select, .twt-prompt-item-name-input, .twt-prompt-item-enable-toggle, .menu_button').on('click', (e) => {
                e.stopPropagation();
            });

            // Expand/collapse toggling (Accordion style)
            const toggleCollapse = () => {
                const isCollapsed = card.hasClass('collapsed');
                if (isCollapsed) {
                    // Collapse all other sibling items first
                    card.siblings('.twt-prompt-item-card').each(function() {
                        const $sibling = $(this);
                        if (!$sibling.hasClass('collapsed')) {
                            $sibling.addClass('collapsed');
                            $sibling.find('.twt-prompt-item-textarea').slideUp(150);
                            $sibling.find('.twt-prompt-item-toggle-collapse i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
                        }
                    });
                    
                    // Expand this item
                    card.removeClass('collapsed');
                    card.find('.twt-prompt-item-textarea').slideDown(150);
                    card.find('.twt-prompt-item-toggle-collapse i').removeClass('fa-chevron-right').addClass('fa-chevron-down');
                } else {
                    // Collapse this item
                    card.addClass('collapsed');
                    card.find('.twt-prompt-item-textarea').slideUp(150);
                    card.find('.twt-prompt-item-toggle-collapse i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
                }
                saveCurrentPromptItemsToMemory();
            };

            card.find('.twt-prompt-item-row').on('click', (e) => {
                if ($(e.target).closest('.twt-prompt-item-role-select, .twt-prompt-item-name-input, .twt-prompt-item-enable-toggle, .menu_button').length) return;
                toggleCollapse();
            });
            
            card.find('.twt-prompt-item-fullscreen-btn').on('click', (e) => {
                e.stopPropagation();
                saveCurrentPromptItemsToMemory();
                
                const $textarea = card.find('.twt-prompt-item-textarea');
                const currentContent = $textarea.val();
                
                const $fsOverlay = getEl('#twt-comments-text-fullscreen-overlay');
                const $fsTextarea = getEl('#twt_comments_fullscreen_textarea');
                
                $fsTextarea.val(currentContent);
                $fsOverlay.fadeIn(200);
                
                getEl('#twt_comments_fullscreen_save').off('click').on('click', () => {
                    const editedContent = $fsTextarea.val();
                    $textarea.val(editedContent);
                    saveCurrentPromptItemsToMemory();
                    $fsOverlay.fadeOut(200);
                });
                
                getEl('#twt_comments_fullscreen_cancel').off('click').on('click', () => {
                    $fsOverlay.fadeOut(200);
                });
            });

            card.find('.twt-prompt-item-del-btn').on('click', (e) => {
                e.stopPropagation();
                saveCurrentPromptItemsToMemory();
                localPresets[currentPresetName].splice(index, 1);
                renderPromptItemsList();
            });

            card.find('.twt-prompt-item-dup-btn').on('click', (e) => {
                e.stopPropagation();
                saveCurrentPromptItemsToMemory();
                const copiedItem = JSON.parse(JSON.stringify(localPresets[currentPresetName][index]));
                localPresets[currentPresetName].splice(index + 1, 0, copiedItem);
                renderPromptItemsList();
            });

            container.append(card);
        });
    }

    $('#twt_comments_prompt_add_item_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        if (!localPresets[currentPresetName]) {
            localPresets[currentPresetName] = [];
        }
        localPresets[currentPresetName].push({
            role: 'user',
            content: '',
            enabled: true
        });
        renderPromptItemsList();
        
        setTimeout(() => {
            const container = document.getElementById('twt-comments-prompt-items-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 50);
    });

    $('#twt_comments_prompt_save_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        extension_settings.twt.commentsPromptPresets = JSON.parse(JSON.stringify(localPresets));
        extension_settings.twt.commentsCurrentPreset = currentPresetName;
        getContext().saveSettingsDebounced();
        toastr.success('提示词预设保存成功！', '成功');
    });

    // ==========================================
    // Request Preview Dialog
    // ==========================================
    $('#twt_comments_prompt_preview_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        const mockParagraphsInput = JSON.stringify([
            { id: 0, text: "这是小说中被选中进行点评的第一个段落，用来测试 AI 是否能在此处生成有趣的网络读者吐槽。" },
            { id: 1, text: "这是紧接着的第二个段落，通常 AI 需要同时分析这两个段落的上下文来进行对比点评。" }
        ], null, 4);
        const activePreset = localPresets[currentPresetName] || [];
        const enabledMessages = activePreset.filter(m => m.enabled !== false);
        
        if (enabledMessages.length === 0) {
            toastr.warning('当前预设中没有任何已启用的消息条目！', '提示');
            return;
        }

        const context = getContext();
        const userVal = context.name1 || 'User';
        const charVal = context.name2 || 'Char';
        function applyCommentsRegexFilters(text) {
            if (!text) return '';
            const filters = extension_settings.twt.commentsRegexFilters || [];
            let result = text;
            filters.forEach(filter => {
                if (filter.enabled === false || !filter.pattern) return;
                try {
                    const regex = new RegExp(filter.pattern, 'g');
                    if (filter.action === 'remove') {
                        result = result.replace(regex, '');
                    }
                } catch (e) {
                    console.warn(`[TwT Regex Filter Error] Pattern "${filter.pattern}":`, e);
                }
            });
            return result;
        }

        // Get actual chat history context (last 5 messages before preview context)
        let rawContextHistory = '';
        if (context.chat && context.chat.length > 0) {
            // Preview relative to the current chat session or end of chat
            const lastMessages = context.chat.slice(-5);
            rawContextHistory = lastMessages.map(msg => {
                const sender = msg.is_user ? (context.name1 || 'User') : (context.name2 || 'Char');
                return `${sender}: ${msg.mes || ''}`;
            }).join('\n\n');
        } else {
            rawContextHistory = `User: 这是一个测试的前文故事开头。\nChar: 这是一个测试的AI回复内容，里面包含一些需要排除的思考过程 <thought>AI正在思考如何回应用户...</thought> 思考完毕。`;
        }

        const filteredContextHistory = applyCommentsRegexFilters(rawContextHistory);

        const finalMessages = enabledMessages.map(m => {
            let replacedContent = (m.content || '')
                .replace(/{{paragraphs_input}}/g, mockParagraphsInput)
                .replace(/{{context_history}}/g, filteredContextHistory)
                .replace(/{{user}}/g, userVal)
                .replace(/{{char}}/g, charVal);
            return {
                role: m.role,
                content: replacedContent
            };
        });

        let endpointUrl = '';
        let headersStr = '';
        let modelStr = '';

        if (currentlySelectedApiId === 'main') {
            const STModel = (typeof context.getChatCompletionModel === 'function') ? context.getChatCompletionModel(context.chatCompletionSettings) : '酒馆当前主模型';
            endpointUrl = '/api/backends/chat-completions/generate';
            headersStr = JSON.stringify({
                'Content-Type': 'application/json',
                'X-Source': 'SillyTavern-TwT-Extension'
            }, null, 2);
            modelStr = STModel;
        } else {
            const api = localApis.find(a => a.id === currentlySelectedApiId);
            if (api) {
                endpointUrl = `${api.url}/chat/completions`;
                headersStr = JSON.stringify({
                    'Content-Type': 'application/json',
                    'Authorization': api.key ? `Bearer ${api.key.substring(0, 4)}...${api.key.substring(Math.max(0, api.key.length - 4))}` : 'None'
                }, null, 2);
                modelStr = api.model;
            } else {
                endpointUrl = '未知接口';
                headersStr = '无';
                modelStr = '无';
            }
        }

        getEl('#twt_comments_preview_url').text(endpointUrl);
        getEl('#twt_comments_preview_headers').text(headersStr);
        getEl('#twt_comments_preview_model').text(modelStr);

        const $payloadContainer = getEl('#twt_comments_preview_payload_container');
        $payloadContainer.empty();

        finalMessages.forEach(msg => {
            const roleClass = msg.role;
            const $msgDiv = $(`
                <div class="twt-preview-payload-msg">
                    <span class="twt-preview-payload-role ${roleClass}">${msg.role.toUpperCase()}</span>
                    <div class="twt-preview-payload-content">${escapeHtml(msg.content)}</div>
                </div>
            `);
            $payloadContainer.append($msgDiv);
        });

        getEl('#twt-comments-preview-modal').fadeIn(200);
    });

    getEl('#twt_comments_preview_close').off('click').on('click', () => {
        getEl('#twt-comments-preview-modal').fadeOut(200);
    });

    // ==========================================
    // Regex Filters Tab Management
    // ==========================================
    let localFilters = JSON.parse(JSON.stringify(extension_settings.twt.commentsRegexFilters || []));

    function renderRegexFiltersTab() {
        const container = $('#twt-comments-regex-rules-container');
        container.empty();

        localFilters.forEach((filter, index) => {
            const card = $(`
                <div class="twt-prompt-item-card" data-index="${index}" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; background: rgba(255,255,255,0.02);">
                    <div class="twt-prompt-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                        <div class="twt-prompt-item-left" style="display: flex; gap: 6px; align-items: center; flex: 1; min-width: 200px;">
                            <span style="font-weight: bold; font-size: 0.85em; opacity: 0.5;">#${index + 1}</span>
                            <input type="text" class="twt-regex-name-input" placeholder="规则名称" value="${filter.name || ''}" style="flex: 1; min-width: 100px; max-width: 200px; font-size: 0.85em; padding: 3px 6px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;" />
                            <select class="twt-regex-action-select" style="background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; padding: 3px; font-size: 0.85em;">
                                <option value="remove" ${filter.action === 'remove' ? 'selected' : ''}>排除/清除移除</option>
                            </select>
                        </div>
                        <div class="twt-prompt-item-right" style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; white-space: nowrap;">
                            <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer; margin: 0; white-space: nowrap;">
                                <input type="checkbox" class="twt-regex-enable-toggle" ${filter.enabled !== false ? 'checked' : ''} /> 启用
                            </label>
                            <button class="twt-regex-del-btn menu_button" style="padding: 3px 6px; margin: 0; color: #ff4444; font-size: 0.85em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="删除此规则"><i class="fa-solid fa-trash"></i> 删除</button>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                        <span style="font-size: 0.8em; opacity: 0.6;">正则表达式 (Regular Expression Pattern)：</span>
                        <input type="text" class="twt-regex-pattern-input" placeholder="例如：<thought[^>]*>[\\s\\S]*?<\\/thought>" value="${filter.pattern || ''}" style="width: 100%; font-size: 0.9em; padding: 5px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-family: monospace;" />
                    </div>
                </div>
            `);

            card.find('.twt-regex-del-btn').on('click', () => {
                saveCurrentFiltersToMemory();
                localFilters.splice(index, 1);
                renderRegexFiltersTab();
            });

            container.append(card);
        });
    }

    function saveCurrentFiltersToMemory() {
        const filters = [];
        $('#twt-comments-regex-rules-container .twt-prompt-item-card').each(function() {
            const name = $(this).find('.twt-regex-name-input').val().trim();
            const action = $(this).find('.twt-regex-action-select').val();
            const enabled = $(this).find('.twt-regex-enable-toggle').prop('checked');
            const pattern = $(this).find('.twt-regex-pattern-input').val();
            const id = 'filter_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            filters.push({ id, name, action, enabled, pattern });
        });
        localFilters = filters;
    }

    $('#twt_comments_regex_add_btn').off('click').on('click', () => {
        saveCurrentFiltersToMemory();
        localFilters.push({
            id: 'filter_' + Date.now(),
            name: '新规则',
            pattern: '',
            action: 'remove',
            enabled: true
        });
        renderRegexFiltersTab();
    });

    $('#twt_comments_regex_save_btn').off('click').on('click', () => {
        saveCurrentFiltersToMemory();
        extension_settings.twt.commentsRegexFilters = JSON.parse(JSON.stringify(localFilters));
        getContext().saveSettingsDebounced();
        toastr.success('正则过滤规则保存成功！', '成功');
    });

    // ==========================================
    // Layout settings Tab Management
    // ==========================================
    function renderLayoutTab() {
        const currentPos = extension_settings.twt.commentsDrawerPosition || 'right';
        const currentWidth = extension_settings.twt.commentsDrawerWidth || 35; // Default 35%
        
        $('#twt_comments_drawer_position_select').val(currentPos);
        $('#twt_comments_drawer_width_range').val(currentWidth);
        
        $('#twt_comments_drawer_width_display').text(currentWidth + '%');
    }

    // Bind slider input change
    $('#twt_comments_drawer_width_range').off('input').on('input', function() {
        const val = $(this).val();
        $('#twt_comments_drawer_width_display').text(val + '%');
    });

    $('#twt_comments_layout_save_btn').off('click').on('click', () => {
        const pos = $('#twt_comments_drawer_position_select').val();
        const width = parseInt($('#twt_comments_drawer_width_range').val(), 10) || 35;
        
        extension_settings.twt.commentsDrawerPosition = pos;
        extension_settings.twt.commentsDrawerWidth = width;
        
        getContext().saveSettingsDebounced();
        toastr.success('界面布局设置保存成功！', '成功');
    });

    // ==========================================
    // Help Tutorials Modals Logic
    // ==========================================
    const showHelpModal = (title, content) => {
        getEl('#twt_help_modal_title').text(title);
        getEl('#twt_help_modal_content').html(content);
        getEl('#twt-comments-help-modal').fadeIn(200);
    };

    const closeHelpModal = () => {
        getEl('#twt-comments-help-modal').fadeOut(200);
    };

    getEl('#twt_help_modal_close').off('click').on('click', closeHelpModal);
    getEl('#twt-comments-help-modal').off('click').on('click', function(e) {
        if (e.target === this) {
            closeHelpModal();
        }
    });

    // 提示词帮助教程文本
    const promptHelpText = `
<div style="font-weight: bold; font-size: 1.1em; margin-bottom: 10px; color: var(--SmartThemeUnderlineColor, #007aff);">提示词编写指南</div>
您可以通过添加多条“系统 (system)”和“用户 (user)”消息来构建发送给 AI 的提示词预设。

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【支持的占位符】</div>
在发送请求给 AI 时，系统会自动将消息中的以下占位符替换为实际内容：
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{paragraphs_input}}</code>
  <span style="opacity: 0.85;"><b>(必填)</b> 代表当前选中的需要进行点评的小说段落数据，为 JSON 格式。</span>
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{context_history}}</code>
  <span style="opacity: 0.85;">代表当前场景的<b>前文聊天历史</b>（默认取最近 5 条消息）。该内容会自动经过您的“正则过滤规则”处理，清除无关的杂质。</span>
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{char}}</code>
  <span style="opacity: 0.85;">自动替换为酒馆当前 AI 角色名称。</span>
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{user}}</code>
  <span style="opacity: 0.85;">自动替换为您的用户名称。</span>

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【编写建议】</div>
建议在提示词中明确要求 AI 输出包含作者（author）和点评（comment）字段的 JSON 数组。
例如：
<pre style="background: rgba(0,0,0,0.25); border: 1px solid var(--SmartThemeBorderColor); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.9em; white-space: pre-wrap; margin-top: 5px; color: #a6e22e;">
[
  {
    "author": "热心书友",
    "comment": "这段写得真好！"
  }
]
</pre>
`;

    // 正则过滤帮助教程文本
    const regexHelpText = `
<div style="font-weight: bold; font-size: 1.1em; margin-bottom: 10px; color: var(--SmartThemeUnderlineColor, #007aff);">正则过滤配置指南</div>
当您在提示词中使用 <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{context_history}}</code> 引入上下文剧情时，前文通常会带有很多无助于 AI 进行段评生成的杂质数据（例如思考过程、系统设定提示等）。

您可以使用正则过滤规则在发送给 API 之前，对前文进行一轮自动清洗和简化。

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【规则参数说明】</div>
• <b>正则表达式</b>：标准的 JavaScript 正则语法。
• <b>动作 (Action)</b>：
  - <b>排除/清除 (remove)</b>：将正则表达式所匹配到的所有文本，从前文故事文本中直接擦除。
• <b>启用开关</b>：可随时启用或禁用单条规则。
• <b>规则顺序</b>：规则将按照从上至下的顺序依次应用。

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【常见正则表达式示例】</div>
• <b>过滤 AI 的思考过程</b>（即清除 &lt;thought&gt; 标签及其包裹的内容）：
  <code style="display: block; background: rgba(0,0,0,0.25); padding: 6px 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-family: monospace; margin: 5px 0; color: #66d9ef;">&lt;thought&gt;([\\s\\S]*?)&lt;\\/thought&gt;</code>
• <b>过滤括弧内的动作旁白描述</b>：
  <code style="display: block; background: rgba(0,0,0,0.25); padding: 6px 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-family: monospace; margin: 5px 0; color: #66d9ef;">\\([^)]*\\) 或 \\*[^*]*\\*</code>
`;

    $('#twt_prompt_help_icon').off('click').on('click', () => {
        showHelpModal('提示词预设编写教程', promptHelpText);
    });

    $('#twt_regex_help_icon').off('click').on('click', () => {
        showHelpModal('正则过滤规则教程', regexHelpText);
    });

    // Render tabs initially
    renderApisTab();
    renderPromptsTab();
    renderRegexFiltersTab();
    renderLayoutTab();
}

function updateCommentsBgSolid() {
    try {
        const tempEl = document.createElement('div');
        tempEl.style.color = 'var(--SmartThemeBlurTintColor)';
        document.body.appendChild(tempEl);
        const computedColor = getComputedStyle(tempEl).color;
        document.body.removeChild(tempEl);
        
        const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const r = match[1];
            const g = match[2];
            const b = match[3];
            document.documentElement.style.setProperty('--twt-comments-bg-solid', `rgb(${r}, ${g}, ${b})`);
        } else {
            document.documentElement.style.setProperty('--twt-comments-bg-solid', 'var(--SmartThemeBlurTintColor)');
        }
    } catch (e) {
        console.warn("TwT: Failed to parse SmartThemeBlurTintColor:", e);
        document.documentElement.style.setProperty('--twt-comments-bg-solid', 'var(--SmartThemeBlurTintColor)');
    }
}

jQuery(async () => {
    const html = await renderExtensionTemplateAsync('third-party/TwT', 'index');
    $('#extensions_settings').append(html);

    // Teleport editor, text editing, preview, and help overlays to parentDoc.body to escape transform containment
    $('#twt-comments-editor-overlay').appendTo(parentDoc.body);
    $('#twt-comments-text-fullscreen-overlay').appendTo(parentDoc.body);
    $('#twt-comments-preview-modal').appendTo(parentDoc.body);
    $('#twt-comments-help-modal').appendTo(parentDoc.body);
    $('#twt-link-theme-modal').appendTo(parentDoc.body);
    $('#twt-optimize-editor-modal').appendTo(parentDoc.body);

    updateCommentsBgSolid();
    bindUI();
    updatePageTabVisibility();
    updateMenuTabVisibility();
    updateVisualTabVisibility();
    updateMuluTabVisibility();
    updateCommentsTabVisibility();
    
    applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    applyMenuMode(extension_settings.twt.menuEnabled, extension_settings.twt);
    applyFullscreenMode(extension_settings.twt.isFullscreen);
    updateInjectedStyles();
    initMulu();
    initThemeLinkListener();
    initPaginationEvent(() => extension_settings.twt);
    initMenu(() => extension_settings.twt, (active) => {
        isExcerptModeActive = active;
        document.body.classList.toggle('twt-excerpt-active', active);
        if (parentDoc && parentDoc.body) {
            parentDoc.body.classList.toggle('twt-excerpt-active', active);
        }
        updateInjectedStyles();
    });
    parentDoc.addEventListener('contextmenu', (e) => {
        const patches = extension_settings.twt.optimizePatches || {};
        const isEnabled = extension_settings.twt.visualEnabled && patches['禁用聊天区域长按菜单']?.active;
        if (!isEnabled) return;

        const chat = parentDoc.getElementById('chat');
        if (chat && chat.contains(e.target)) {
            const tagName = e.target.tagName.toLowerCase();
            if (tagName !== 'input' && tagName !== 'textarea') {
                e.preventDefault();
            }
        }
    }, true);

    // 聊天切换时重新绑定翻页事件到新的 #chat 元素
    // 解决：旧 #chat 被销毁后事件监听器失效导致翻页失控的竞态问题
    try {
        const ctx = getContext();
        if (ctx && ctx.eventSource && ctx.eventTypes) {
            ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
                if (extension_settings.twt.enabled) {
                    resetPaginationBinding(() => extension_settings.twt);
                }
            });
        }
    } catch (e) {
        console.warn('[TwT] Failed to register CHAT_CHANGED listener for pagination reset:', e);
    }
});
