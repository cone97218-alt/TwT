// @ts-nocheck
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { applyPaginationMode, initPaginationEvent } from './pagination.js';
import { applyVisualMode } from './visual.js';
import { initMulu, applyMuluSettings } from './mulu.js';
import { initMenu, applyMenuMode } from './menu.js';

const extensionName = 'TwT';

const defaultSettings = {
    enabled: true,
    swipeEnabled: true,
    messagePageEnabled: false,
    customWhitelist: '.mes_reasoning_details, .thought-block',
    menuEnabled: false,
    menuOptRegenerate: true,
    menuOptSwipe: true,
    menuOptDelete: false,
    menuOptHide: false,
    menuOptEdit: true,
    paragraphToolbarBottom: 15,
    paragraphIconSize: 20,
    paragraphXmlWhitelist: 'thought, TavernThought, reasoning, details',
    menuOptEditFiltered: false,
    menuOptExcerpt: false,
    menuInvokeMethod: 'longpress',
    menuLongpressDelay: 500,
    menuDirection: 'bottom-right',
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
    visualPresets: {}, 
    currentPreset: 'custom',
    
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
    optimizePatches: {}
};

const defaultPatches = {
    '隐藏滚动条': {
        active: false,
        code: `/* 隐藏全局滚动条及聊天区域滚动条 */\n::-webkit-scrollbar {\n    display: none !important;\n    width: 0 !important;\n    height: 0 !important;\n}\nbody, html, #chat, #chat-container, .twt-mulu-list {\n    scrollbar-width: none !important; /* Firefox */\n    -ms-overflow-style: none !important; /* IE/Edge */\n}`
    },
    '禁用聊天区域长按菜单': {
        active: false,
        code: `/* 禁用聊天区域文本选中与移动端长按呼出菜单 */\n#chat {\n    -webkit-touch-callout: none !important; /* 禁用iOS长按菜单 */\n    -webkit-user-select: none !important;   /* 禁用选中 */\n    user-select: none !important;\n}\n/* 如果有输入框在聊天区内，允许选中 */\n#chat input, #chat textarea {\n    -webkit-touch-callout: default !important;\n    -webkit-user-select: text !important;\n    user-select: text !important;\n}`
    },
    '收藏栏左侧图标缩小': {
        active: false,
        code: `/* 收藏栏左侧图标缩小 */\nbody #rm_button_characters {\n    font-size: 16px !important;\n    width: 32px !important;\n    height: 32px !important;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}`
    },
    '收藏栏下方空隙缩小': {
        active: false,
        code: `/* 收藏栏下方空隙缩小 */\nbody #CharListButtonAndHotSwaps {\n    margin-bottom: -20px;\n}`
    },
    'Spreset': {
        active: false,
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
        }
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

function updateOptimizeTabVisibility() {
    const $tabBtn = $('#tab-btn-optimize');
    const $tabContent = $('#twt-tab-optimize');
    
    if (extension_settings.twt.optimizeEnabled) {
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

function updateParagraphSubOptionsVisibility() {
    const $subOptions = $('#twt_paragraph_edit_sub_options');
    if (extension_settings.twt.menuOptEdit) {
        $subOptions.show();
    } else {
        $subOptions.hide();
    }
}

let currentlyEditingPatchName = null;

function renderOptimizePatchList() {
    const $list = $('#twt_optimize_list');
    $list.empty();

    const patches = extension_settings.twt.optimizePatches || {};
    const patchNames = Object.keys(patches);

    if (patchNames.length === 0) {
        $list.append(`
            <div id="twt_optimize_empty_hint" style="text-align: center; opacity: 0.5; padding: 15px; font-size: 0.9em; border: 1px dashed var(--SmartThemeBorderColor); border-radius: 6px; width: 100%; box-sizing: border-box;">
                暂无自定义补丁，点击“新建补丁”开始吧！
            </div>
        `);
        return;
    }

    for (const name of patchNames) {
        const patch = patches[name];
        const isEditingThis = currentlyEditingPatchName === name;
        const $item = $(`
            <div class="twt-optimize-item" data-name="${name}" style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.15); padding: 6px 10px; border-radius: 6px; border: 1px solid ${isEditingThis ? 'var(--SmartThemeUnderlineColor)' : 'var(--SmartThemeBorderColor)'}; gap: 10px; width: 100%; box-sizing: border-box; box-shadow: none !important;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; min-width: 0; margin: 0; user-select: none; box-shadow: none !important;">
                    <input type="checkbox" class="twt-patch-checkbox" ${patch.active ? 'checked' : ''} style="margin: 0; flex-shrink: 0; box-shadow: none !important;" />
                    <span class="twt-patch-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; font-size: 0.95em; ${isEditingThis ? 'font-weight: bold; color: var(--SmartThemeUnderlineColor, #fff);' : ''}">${name}</span>
                </label>
                <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; box-shadow: none !important;">
                    <button class="twt-patch-edit" style="padding: 4px 6px; margin: 0; font-size: 0.85em; background: ${isEditingThis ? 'var(--SmartThemeUnderlineColor)' : 'rgba(255, 255, 255, 0.08)'}; color: ${isEditingThis ? 'var(--SmartThemeDarkColor)' : 'var(--SmartThemeBodyColor)'}; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important; transition: all 0.15s ease;" title="编辑代码"><i class="fa-solid fa-code"></i></button>
                    <button class="twt-patch-rename" style="padding: 4px 6px; margin: 0; font-size: 0.85em; background: rgba(255, 255, 255, 0.08); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important; transition: all 0.15s ease;" title="重命名补丁"><i class="fa-solid fa-pen"></i></button>
                    <button class="twt-patch-delete" style="padding: 4px 6px; margin: 0; font-size: 0.85em; background: rgba(255, 255, 255, 0.08); color: #ff4444; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important; transition: all 0.15s ease;" title="删除补丁"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `);
        $list.append($item);
    }
}

function openOptimizeEditor(name) {
    const patches = extension_settings.twt.optimizePatches || {};
    const patch = patches[name];
    if (!patch) return;

    currentlyEditingPatchName = name;
    $('#twt_optimize_editor_title').text(`正在编辑: ${name}`);
    $('#twt_optimize_code').val(patch.code || '');
    $('#twt_optimize_editor_container').css('display', 'flex');
    
    renderOptimizePatchList();
}

function closeOptimizeEditor() {
    currentlyEditingPatchName = null;
    $('#twt_optimize_editor_container').css('display', 'none');
    renderOptimizePatchList();
}

export function updateInjectedStyles() {
    const doc = window.parent && window.parent.document ? window.parent.document : document;
    let style = doc.getElementById('twt-optimize-styles');
    if (!style) {
        style = doc.createElement('style');
        style.id = 'twt-optimize-styles';
        doc.head.appendChild(style);
    }

    if (!extension_settings.twt.optimizeEnabled) {
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
        extension_settings.twt.paddingTop = preset.paddingTop;
        extension_settings.twt.paddingBottom = preset.paddingBottom;
        extension_settings.twt.paddingLeft = preset.paddingLeft;
        extension_settings.twt.paddingRight = preset.paddingRight;
        extension_settings.twt.fontSize = preset.fontSize;
        extension_settings.twt.lineHeight = preset.lineHeight;
        
        $('#twt_padding_top').val(preset.paddingTop);
        $('#twt_padding_bottom').val(preset.paddingBottom);
        $('#twt_padding_left').val(preset.paddingLeft);
        $('#twt_padding_right').val(preset.paddingRight);
        $('#twt_font_size').val(preset.fontSize);
        $('#twt_line_height').val(preset.lineHeight);
        
        getContext().saveSettingsDebounced();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    }
}

function saveCurrentToPreset(name) {
    extension_settings.twt.visualPresets[name] = {
        paddingTop: extension_settings.twt.paddingTop,
        paddingBottom: extension_settings.twt.paddingBottom,
        paddingLeft: extension_settings.twt.paddingLeft,
        paddingRight: extension_settings.twt.paddingRight,
        fontSize: extension_settings.twt.fontSize,
        lineHeight: extension_settings.twt.lineHeight
    };
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

function bindUI() {
    const $enabled = $('#twt_enabled');
    const $swipeEnabled = $('#twt_swipe_enabled');
    const $messagePageEnabled = $('#twt_message_page_enabled');
    const $customWhitelist = $('#twt_custom_whitelist');
    const $menuEnabled = $('#twt_menu_enabled');
    const $menuInvokeMethod = $('#twt_menu_invoke_method');
    const $menuLongpressDelay = $('#twt_menu_longpress_delay');
    const $menuDirection = $('#twt_menu_direction');
    const $menuOptRegenerate = $('#twt_menu_opt_regenerate');
    const $menuOptSwipe = $('#twt_menu_opt_swipe');
    const $menuOptDelete = $('#twt_menu_opt_delete');
    const $menuOptHide = $('#twt_menu_opt_hide');
    const $menuOptEdit = $('#twt_menu_opt_edit');
    const $paragraphToolbarBottom = $('#twt_paragraph_toolbar_bottom');
    const $paragraphIconSize = $('#twt_paragraph_icon_size');
    const $paragraphXmlWhitelist = $('#twt_paragraph_xml_whitelist');
    const $menuOptEditFiltered = $('#twt_menu_opt_edit_filtered');
    const $menuOptExcerpt = $('#twt_menu_opt_excerpt');
    const $visualEnabled = $('#twt_visual_enabled');
    const $muluEnabled = $('#twt_mulu_enabled');
    const $optimizeEnabled = $('#twt_optimize_enabled');
    
    const $paddingTop = $('#twt_padding_top');
    const $paddingBottom = $('#twt_padding_bottom');
    const $paddingLeft = $('#twt_padding_left');
    const $paddingRight = $('#twt_padding_right');
    const $fontSize = $('#twt_font_size');
    const $lineHeight = $('#twt_line_height');

    const $muluBtnStart = $('#twt_mulu_btn_start');
    const $muluBtnToc = $('#twt_mulu_btn_toc');
    const $muluBtnEnd = $('#twt_mulu_btn_end');

    // UI初始化
    $enabled.prop('checked', extension_settings.twt.enabled);
    $swipeEnabled.prop('checked', extension_settings.twt.swipeEnabled);
    $messagePageEnabled.prop('checked', extension_settings.twt.messagePageEnabled);
    $customWhitelist.val(extension_settings.twt.customWhitelist || '');
    $menuEnabled.prop('checked', extension_settings.twt.menuEnabled);
    $menuInvokeMethod.val(extension_settings.twt.menuInvokeMethod || 'longpress');
    $menuLongpressDelay.val(extension_settings.twt.menuLongpressDelay || 500);
    $menuDirection.val(extension_settings.twt.menuDirection || 'bottom-right');
    $menuOptRegenerate.prop('checked', extension_settings.twt.menuOptRegenerate);
    $menuOptSwipe.prop('checked', extension_settings.twt.menuOptSwipe);
    $menuOptDelete.prop('checked', extension_settings.twt.menuOptDelete);
    $menuOptHide.prop('checked', extension_settings.twt.menuOptHide);
    $menuOptEdit.prop('checked', extension_settings.twt.menuOptEdit);
    $paragraphToolbarBottom.val(extension_settings.twt.paragraphToolbarBottom !== undefined ? extension_settings.twt.paragraphToolbarBottom : 15);
    $paragraphIconSize.val(extension_settings.twt.paragraphIconSize !== undefined ? extension_settings.twt.paragraphIconSize : 20);
    $paragraphXmlWhitelist.val(extension_settings.twt.paragraphXmlWhitelist !== undefined ? extension_settings.twt.paragraphXmlWhitelist : 'thought, TavernThought, reasoning, details');
    $menuOptEditFiltered.prop('checked', extension_settings.twt.menuOptEditFiltered ?? false);
    $menuOptExcerpt.prop('checked', extension_settings.twt.menuOptExcerpt);
    
    updateParagraphSubOptionsVisibility();
    
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
    $optimizeEnabled.prop('checked', extension_settings.twt.optimizeEnabled);

    $paddingTop.val(extension_settings.twt.paddingTop);
    $paddingBottom.val(extension_settings.twt.paddingBottom);
    $paddingLeft.val(extension_settings.twt.paddingLeft);
    $paddingRight.val(extension_settings.twt.paddingRight);
    $fontSize.val(extension_settings.twt.fontSize);
    $lineHeight.val(extension_settings.twt.lineHeight);

    $muluBtnStart.prop('checked', extension_settings.twt.muluBtnStart);
    $muluBtnToc.prop('checked', extension_settings.twt.muluBtnToc);
    $muluBtnEnd.prop('checked', extension_settings.twt.muluBtnEnd);

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

    $('#twt_preset_save').on('click', function() {
        const currentName = extension_settings.twt.currentPreset !== 'custom' ? extension_settings.twt.currentPreset : '新预设';
        const name = prompt('请输入预设名称：', currentName);
        if (name && name.trim().length > 0) {
            saveCurrentToPreset(name.trim());
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
            extension_settings.twt.optimizePatches[trimmedName] = { code: '', active: true };
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
            openOptimizeEditor(trimmedName);
            updateInjectedStyles();
        }
    });

    $('#twt_optimize_close_editor').on('click', function() {
        closeOptimizeEditor();
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
                $('#twt_optimize_editor_title').text(`正在编辑: ${trimmedName}`);
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

    $('#twt_optimize_code').on('input', function() {
        if (currentlyEditingPatchName) {
            const name = currentlyEditingPatchName;
            const code = $(this).val();
            if (extension_settings.twt.optimizePatches[name]) {
                extension_settings.twt.optimizePatches[name].code = code;
                getContext().saveSettingsDebounced();
                updateInjectedStyles();
            }
        }
    });

    function markAsCustom() {
        if (extension_settings.twt.currentPreset !== 'custom') {
            extension_settings.twt.currentPreset = 'custom';
            $('#twt_visual_preset').val('custom');
        }
    }

    const handleVisualChange = () => {
        markAsCustom();
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

    $menuOptDelete.on('change', function () {
        extension_settings.twt.menuOptDelete = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptHide.on('change', function () {
        extension_settings.twt.menuOptHide = $(this).prop('checked');
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
    });

    $visualEnabled.on('change', function () {
        extension_settings.twt.visualEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateVisualTabVisibility();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    });

    $muluEnabled.on('change', function () {
        extension_settings.twt.muluEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateMuluTabVisibility();
        applyMuluSettings();
    });

    $optimizeEnabled.on('change', function () {
        extension_settings.twt.optimizeEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateOptimizeTabVisibility();
        updateInjectedStyles();
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

    $('#twt-settings').on('click', '.twt-tab', function() {
        $('#twt-settings .twt-tab').removeClass('active');
        $('#twt-settings .twt-tab-content').hide().removeClass('active');

        $(this).addClass('active');
        const targetId = $(this).data('tab');
        $('#' + targetId).show().addClass('active');
    });
}

jQuery(async () => {
    const html = await renderExtensionTemplateAsync('third-party/TwT', 'index');
    $('#extensions_settings').append(html);

    bindUI();
    updatePageTabVisibility();
    updateMenuTabVisibility();
    updateVisualTabVisibility();
    updateMuluTabVisibility();
    updateOptimizeTabVisibility();
    
    applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    applyMenuMode(extension_settings.twt.menuEnabled, extension_settings.twt);
    updateInjectedStyles();
    initMulu();
    initPaginationEvent(() => extension_settings.twt);
    initMenu(() => extension_settings.twt);

    // 监听聊天区域右键/长按菜单事件以禁用长按菜单
    const parentDoc = window.parent && window.parent.document ? window.parent.document : document;
    parentDoc.addEventListener('contextmenu', (e) => {
        const patches = extension_settings.twt.optimizePatches || {};
        const isEnabled = extension_settings.twt.optimizeEnabled && patches['禁用聊天区域长按菜单']?.active;
        if (!isEnabled) return;

        const chat = parentDoc.getElementById('chat');
        if (chat && chat.contains(e.target)) {
            const tagName = e.target.tagName.toLowerCase();
            if (tagName !== 'input' && tagName !== 'textarea') {
                e.preventDefault();
            }
        }
    }, true);
});
