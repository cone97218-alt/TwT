import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const extensionName = 'cut';
const defaultSettings = {
    enabled: true,
    module1: {
        hideTutorials: true,      // 1. 隐藏教程图标 [CSS]
        hideLanguageSelect: true, // 2. 隐藏语言选择 [CSS]
        hideRedirectLinks: true,  // 3. 隐藏快捷链接 [CSS]
        hideSliderTips: true,     // 4. 隐藏滑块提示 [CSS]
        hideCcInvalid: true,      // 5. 隐藏无效格式 [CSS]
        fixMobileInput: true,     // 6. 手机打字防弹 [JS]
    },
    module2: {
        foldPresets: true,        // 1. 折叠预设参数 [JS]
        foldWorldInfoTop: true,   // 2. 折叠全局世界 [JS]
        foldUserAvatars: true,    // 3. 折叠人设列表 ("人设列表" 4-character drawer) [JS]
        foldPersonaSettings: true,// 4. 折叠设定设置 [JS]
        foldFirstMessage: true,   // 5. 折叠角色开场 ("角色开场" 4-character drawer) [JS]
        foldCustomCss: true,      // 6. 折叠自定义样式 [JS]
        foldUiEffects: true,      // 7. 折叠界面效果 [JS]
        foldThemeToggles: true,   // 8. 折叠主题开关 [JS]
        foldUserAdvanced: true,   // 9. 折叠高级设置 [JS]
        enablePersonaHeight: true,// 10. 人设概述高度 [CSS]
        personaHeight: 450,       // 人设概述高度 (px)
        enableCharDescHeight: true,// 11. 角色描述高度 (#description_textarea) [CSS]
        charDescHeight: 450,      // 角色描述高度 (px)
        enableCssHeight: true,    // 12. 自定义样式高度 [CSS]
        customCssHeight: 500,     // 自定义样式高度 (px)
        enableAvatarHeight: true, // 13. 用户选择高度 [CSS]
        userAvatarHeight: 300,    // 用户选择高度 (#user_avatar_block) (px)
    },
};

// Global state for auto-focus interception (Inspired by SillyTavern-Layout & Mobile-Focus-Interceptor)
const originalFocus = HTMLElement.prototype.focus;
let lastDirectInputInteraction = 0;
let lastTabInteraction = 0;
let isAutoFocusInterceptorBound = false;

// Paste Performance Batching State (Inspired by akira59851/Mobile-Focus-Interceptor)
let isPasteFixInstalled = false;
let pasteBurstTimestamps = [];
let pasteHasSubstantialText = false;
let pasteTextParts = [];
let pasteStartPos = null;
let pasteTarget = null;
let pasteBatching = false;
let pasteFlushTimer = null;
let pasteCurrentTimeout = 300;
let pasteRafId = null;

function isEditableInput(el) {
    return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);
}

/**
 * Merges and flushes accumulated paste chunks in a single rAF frame with visibility suppression to prevent UI freeze
 */
function flushPasteBuffer() {
    pasteBatching = false;
    clearTimeout(pasteFlushTimer);
    pasteFlushTimer = null;
    pasteBurstTimestamps = [];
    pasteHasSubstantialText = false;
    pasteCurrentTimeout = 300;

    if (pasteTextParts.length === 0 || pasteStartPos === null || !pasteTarget) {
        pasteTextParts = [];
        pasteStartPos = null;
        pasteTarget = null;
        return;
    }

    const target = pasteTarget;
    const accumulatedText = pasteTextParts.join('');
    const start = pasteStartPos;
    const before = target.value ? target.value.substring(0, start) : '';
    const after = target.value ? target.value.substring(target.selectionEnd || start) : '';

    pasteTextParts = [];
    pasteStartPos = null;
    pasteTarget = null;

    target.style.visibility = 'hidden';
    target.value = before + accumulatedText + after;
    const newPos = start + accumulatedText.length;
    if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(newPos, newPos);
    }

    pasteRafId = requestAnimationFrame(() => {
        pasteRafId = null;
        target.style.visibility = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/**
 * Initializes mobile large text and rapid burst paste performance optimization
 */
function initPastePerformanceFix() {
    if (isPasteFixInstalled) return;
    isPasteFixInstalled = true;

    document.addEventListener('beforeinput', (e) => {
        const settings = extension_settings[extensionName];
        const isEnabled = settings && settings.enabled && settings.module1 && settings.module1.fixMobileInput;
        if (!isEnabled) return;

        const target = e.target;
        if (!isEditableInput(target) || e.isComposing) return;

        const textInsertTypes = ['insertText', 'insertFromPaste', 'insertCompositionText', 'insertReplacementText'];
        if (textInsertTypes.indexOf(e.inputType) === -1) return;

        let text = '';
        if (e.dataTransfer && e.dataTransfer.getData('text/plain')) {
            text = e.dataTransfer.getData('text/plain');
        } else if (typeof e.data === 'string') {
            text = e.data;
        } else if (e.data !== null && e.data !== undefined) {
            text = String(e.data);
        }

        if (!text) return;

        if (pasteBatching && pasteTarget && pasteTarget !== target) {
            flushPasteBuffer();
        }

        if (text.length >= 3000) {
            if (!pasteBatching) {
                pasteBatching = true;
                pasteTarget = target;
                pasteStartPos = target.selectionStart || 0;
                pasteTextParts = [];
            }
            pasteTextParts.push(text);
            e.preventDefault();

            clearTimeout(pasteFlushTimer);
            pasteFlushTimer = setTimeout(flushPasteBuffer, 100);
            return;
        }

        const now = Date.now();
        pasteBurstTimestamps.push(now);
        if (text.length > 3) pasteHasSubstantialText = true;

        while (pasteBurstTimestamps.length > 0 && now - pasteBurstTimestamps[0] > 200) {
            pasteBurstTimestamps.shift();
        }

        if (pasteBurstTimestamps.length >= 3 && pasteHasSubstantialText) {
            if (!pasteBatching) {
                pasteBatching = true;
                pasteTarget = target;
                pasteStartPos = target.selectionStart || 0;
                pasteTextParts = [];
                pasteCurrentTimeout = 300;
            }

            pasteTextParts.push(text);
            e.preventDefault();

            pasteCurrentTimeout = Math.min(pasteCurrentTimeout * 2, 2000);
            clearTimeout(pasteFlushTimer);
            pasteFlushTimer = setTimeout(flushPasteBuffer, pasteCurrentTimeout);
        } else {
            if (pasteBatching) {
                flushPasteBuffer();
            }
        }
    }, true);
}

/**
 * Initializes the dual interception algorithm for auto-focus protection
 */
function initAutoFocusInterceptor() {
    if (isAutoFocusInterceptorBound) return;
    isAutoFocusInterceptorBound = true;

    const updateInteractionTime = (e) => {
        if (e.target && e.target.closest && e.target.closest('input, textarea, label, button, .menu_button')) {
            lastDirectInputInteraction = Date.now();
        }
    };

    document.addEventListener('pointerdown', updateInteractionTime, { capture: true, passive: true });
    document.addEventListener('touchstart', updateInteractionTime, { capture: true, passive: true });
    document.addEventListener('touchend', updateInteractionTime, { capture: true, passive: true });
    document.addEventListener('mousedown', updateInteractionTime, { capture: true, passive: true });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            lastTabInteraction = Date.now();
        }
    }, { capture: true });

    HTMLElement.prototype.focus = function (options) {
        const settings = extension_settings[extensionName];
        const isEnabled = settings && settings.enabled && settings.module1 && settings.module1.fixMobileInput;

        if (isEnabled) {
            const tag = this.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                const isUserInitiated = (Date.now() - lastDirectInputInteraction < 1000) || (Date.now() - lastTabInteraction < 1000);
                const isAlreadyFocused = (document.activeElement === this);

                if (!isUserInitiated && !isAlreadyFocused) {
                    return;
                }
            }
        }
        return originalFocus.call(this, options);
    };

    document.addEventListener('focus', (e) => {
        const settings = extension_settings[extensionName];
        const isEnabled = settings && settings.enabled && settings.module1 && settings.module1.fixMobileInput;

        if (isEnabled) {
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                const isUserInitiated = (Date.now() - lastDirectInputInteraction < 1000) || (Date.now() - lastTabInteraction < 1000);
                if (!isUserInitiated) {
                    e.target.blur();
                }
            }
        }
    }, true);
}

/**
 * Ensures settings object is populated with default values
 */
function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }

    extension_settings[extensionName] = Object.assign({}, defaultSettings, extension_settings[extensionName]);
    
    if (!extension_settings[extensionName].module1) {
        extension_settings[extensionName].module1 = Object.assign({}, defaultSettings.module1);
    } else {
        extension_settings[extensionName].module1 = Object.assign({}, defaultSettings.module1, extension_settings[extensionName].module1);
    }

    if (!extension_settings[extensionName].module2) {
        extension_settings[extensionName].module2 = Object.assign({}, defaultSettings.module2);
    } else {
        extension_settings[extensionName].module2 = Object.assign({}, defaultSettings.module2, extension_settings[extensionName].module2);
    }
}

/**
 * Optimizes mobile input typing behavior
 */
function applyMobileInputAntiJump() {
    const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const settings = extension_settings[extensionName];
    const isEnabled = settings && settings.enabled && settings.module1 && settings.module1.fixMobileInput;

    document.body.classList.toggle('cut-mobile-anti-jump', isEnabled && isMobile);

    if (isEnabled && isMobile) {
        $(document).off('focusin.cut_mobile focusout.cut_mobile').on('focusin.cut_mobile', '#send_textarea, .text_pole, textarea, input[type="text"]', function () {
            const chatEl = document.getElementById('chat');
            if (chatEl) {
                const scrollTop = chatEl.scrollTop;
                requestAnimationFrame(() => {
                    window.scrollTo(0, 0);
                    chatEl.scrollTop = scrollTop;
                });
            }
        });
    } else {
        $(document).off('focusin.cut_mobile focusout.cut_mobile');
    }
}

/**
 * Right-aligns full-screen editor maximize button in Prompt Manager entry edit form
 */
function applyPromptManagerMaximizeButton() {
    const $overridesBlock = $('#completion_prompt_manager_forbid_overrides_block');
    if ($overridesBlock.length > 0) {
        let $actionsContainer = $overridesBlock.closest('.cut-pm-prompt-actions');
        if ($actionsContainer.length === 0) {
            $overridesBlock.wrap('<div class="cut-pm-prompt-actions"></div>');
            $actionsContainer = $overridesBlock.closest('.cut-pm-prompt-actions');
        }

        if ($actionsContainer.find('.editor_maximize').length === 0) {
            const maximizeBtnHtml = `
                <i class="editor_maximize fa-solid fa-maximize right_menu_button margin0" 
                   data-for="completion_prompt_manager_popup_entry_form_prompt" 
                   title="展开全屏编辑器" 
                   style="cursor: pointer; opacity: 0.85;"></i>
            `;
            $actionsContainer.append(maximizeBtnHtml);
        }
    }
}

/**
 * Folds top parameters in Prompt Manager Edit modal into "条目参数" 4-character drawer
 */
function applyPromptManagerEntryParamsFolding() {
    const $form = $('#completion_prompt_manager_popup_edit form.completion_prompt_manager_popup_entry_form');
    if ($form.length === 0) return;

    let $drawer = $('#cut_m2_pm_entry_params_drawer');
    const $paramRows = $form.find('> .flex-container.gap10px');

    if ($paramRows.length > 0) {
        if ($drawer.length === 0) {
            const drawerHtml = `
            <div id="cut_m2_pm_entry_params_drawer" class="inline-drawer wide100p">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>条目参数</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="display: none;"></div>
            </div>
            `;
            $form.prepend(drawerHtml);
            $drawer = $('#cut_m2_pm_entry_params_drawer');
        }

        const $drawerContent = $drawer.find('>.inline-drawer-content');
        if ($drawerContent.children().length === 0) {
            $drawerContent.append($paramRows);
        }
    }
}

/**
 * Enhances Regex Editor instances by adding full-screen maximize icons
 */
function applyRegexEditorEnhancements() {
    $('.regex_editor, #regex_editor_template').each(function () {
        const $editor = $(this);

        const attachFieldMaximize = ($inputEl, fieldIdPrefix) => {
            if ($inputEl.length === 0) return;

            if (!$inputEl.attr('id')) {
                $inputEl.attr('id', fieldIdPrefix + '_' + Math.random().toString(36).substr(2, 6));
            }
            const fieldId = $inputEl.attr('id');
            const $fieldContainer = $inputEl.closest('.flex1');
            const $label = $fieldContainer.find('label').first();

            if ($label.length > 0) {
                let $labelRow = $fieldContainer.find('.cut-regex-label-row');
                if ($labelRow.length === 0) {
                    $label.wrap('<div class="cut-regex-label-row"></div>');
                    $labelRow = $fieldContainer.find('.cut-regex-label-row');
                }

                if ($labelRow.find('.editor_maximize').length === 0) {
                    $labelRow.append(`
                        <i class="editor_maximize fa-solid fa-maximize right_menu_button margin0" 
                           data-for="${fieldId}" 
                           title="展开全屏编辑器" 
                           style="cursor: pointer; opacity: 0.85;"></i>
                    `);
                }
            }

            $inputEl.addClass('wide100p').css('width', '100%');
            $inputEl.parent().css('width', '100%');
        };

        attachFieldMaximize($editor.find('.find_regex'), 'cut_regex_field_find');
        attachFieldMaximize($editor.find('.regex_replace_string'), 'cut_regex_field_replace');
        attachFieldMaximize($editor.find('.regex_trim_strings'), 'cut_regex_field_trim');
    });
}

/**
 * Injects "一键回顶" & "一键回底" scroll buttons in fullscreen replace textareas
 */
function applyMaximizedEditorScrollActions() {
    $('.maximized_textarea').each(function () {
        const $textarea = $(this);
        const dataFor = $textarea.attr('data-for') || '';
        const isRegexReplace = dataFor.includes('replace') || dataFor.includes('cut_regex_field');
        
        if (isRegexReplace) {
            const $wrapper = $textarea.parent();
            if ($wrapper.length > 0 && $wrapper.find('.cut-editor-scroll-actions').length === 0) {
                const scrollActionsHtml = `
                <div class="cut-editor-scroll-actions" style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; width: 100%; margin-bottom: 6px;">
                    <div class="cut-scroll-btn cut-scroll-top menu_button margin0" title="一键回到顶部">
                        <i class="fa-solid fa-arrow-up"></i>
                    </div>
                    <div class="cut-scroll-btn cut-scroll-bottom menu_button margin0" title="一键回到底部">
                        <i class="fa-solid fa-arrow-down"></i>
                    </div>
                </div>
                `;
                $wrapper.prepend(scrollActionsHtml);

                $wrapper.find('.cut-scroll-top').off('click.cut').on('click.cut', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = $textarea[0];
                    if (el) {
                        el.scrollTop = 0;
                        el.setSelectionRange(0, 0);
                        el.focus();
                    }
                });

                $wrapper.find('.cut-scroll-bottom').off('click.cut').on('click.cut', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = $textarea[0];
                    if (el) {
                        el.scrollTop = el.scrollHeight;
                        el.setSelectionRange(el.value.length, el.value.length);
                        el.focus();
                    }
                });
            }
        }
    });
}

/**
 * Folds User Persona Avatar Gallery (#user_avatar_block & search bar) into "人设列表" 4-character drawer
 */
function applyUserAvatarsFolding() {
    const settings = extension_settings[extensionName];
    const isMasterEnabled = settings && settings.enabled;
    const isModule2Enabled = isMasterEnabled && settings.module2;
    const shouldFoldAvatars = isModule2Enabled && settings.module2.foldUserAvatars;

    const $leftCol = $('.persona_management_left_column');
    const $avatarBlock = $('#user_avatar_block');
    const $topBar = $leftCol.find('.flex-container.marginBot10.alignitemscenter');

    if ($leftCol.length > 0 && $avatarBlock.length > 0) {
        let $drawer = $('#cut_m2_user_avatars_drawer');

        if (shouldFoldAvatars) {
            if ($drawer.length === 0) {
                const drawerHtml = `
                <div id="cut_m2_user_avatars_drawer" class="inline-drawer wide100p">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>人设列表</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none; padding-top: 4px;"></div>
                </div>
                `;
                $leftCol.prepend(drawerHtml);
                $drawer = $('#cut_m2_user_avatars_drawer');
            }

            const $drawerContent = $drawer.find('>.inline-drawer-content');
            if ($drawerContent.find('#user_avatar_block').length === 0) {
                const $itemsToFold = $topBar.add($avatarBlock);
                $drawerContent.append($itemsToFold);
            }
            $drawer.show();
        } else {
            if ($drawer.length > 0 && $drawer.is(':visible')) {
                const $itemsToRestore = $drawer.find('.flex-container.marginBot10.alignitemscenter, #user_avatar_block');
                if ($itemsToRestore.length > 0) {
                    $leftCol.prepend($itemsToRestore);
                }
                $drawer.hide();
            }
        }
    }
}

/**
 * Folds Character First Message / Greetings textarea (#firstmessage_textarea) into "角色开场" 4-character drawer
 */
function applyFirstMessageFolding() {
    const settings = extension_settings[extensionName];
    const isMasterEnabled = settings && settings.enabled;
    const isModule2Enabled = isMasterEnabled && settings.module2;
    const shouldFoldFirstMsg = isModule2Enabled && settings.module2.foldFirstMessage;

    const $wrapper = $('#firstMessageWrapper');
    const $firstMsgDiv = $('#first_message_div');
    const $textarea = $('#firstmessage_textarea');
    const $tokenCounter = $wrapper.find('.extension_token_counter');

    if ($wrapper.length > 0 && $textarea.length > 0) {
        let $drawer = $('#cut_m2_first_msg_drawer');

        if (shouldFoldFirstMsg) {
            if ($drawer.length === 0) {
                const $altBtn = $firstMsgDiv.find('.open_alternate_greetings');

                const drawerHtml = `
                <div id="cut_m2_first_msg_drawer" class="inline-drawer wide100p flexFlowColumn">
                    <div class="inline-drawer-toggle inline-drawer-header userSettingsInnerExpandable">
                        <b>角色开场</b>
                        <div class="cut-first-msg-actions" style="display: flex; align-items: center; gap: 10px; margin-left: auto;">
                            <i class="editor_maximize fa-solid fa-maximize right_menu_button margin0" data-for="firstmessage_textarea" title="展开全屏编辑器" style="cursor: pointer; opacity: 0.85;"></i>
                            <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down margin0"></div>
                        </div>
                    </div>
                    <div class="inline-drawer-content" style="display: none; padding-top: 6px;"></div>
                </div>
                `;
                $wrapper.prepend(drawerHtml);
                $drawer = $('#cut_m2_first_msg_drawer');

                if ($altBtn.length > 0) {
                    $drawer.find('.cut-first-msg-actions').prepend($altBtn);
                }
            }

            const $drawerContent = $drawer.find('>.inline-drawer-content');
            if ($drawerContent.find('#firstmessage_textarea').length === 0) {
                const $itemsToFold = $textarea.add($tokenCounter);
                $drawerContent.append($itemsToFold);
            }
            if ($firstMsgDiv.length > 0) {
                $firstMsgDiv.hide();
            }
            $drawer.show();
        } else {
            if ($drawer.length > 0 && $drawer.is(':visible')) {
                const $altBtn = $drawer.find('.open_alternate_greetings');
                if ($altBtn.length > 0 && $firstMsgDiv.length > 0) {
                    $firstMsgDiv.append($altBtn);
                }
                const $itemsToRestore = $drawer.find('#firstmessage_textarea, .extension_token_counter');
                if ($itemsToRestore.length > 0) {
                    $wrapper.append($itemsToRestore);
                }
                if ($firstMsgDiv.length > 0) {
                    $firstMsgDiv.show();
                }
                $drawer.hide();
            }
        }
    }
}

/**
 * Applies Module 2 folding DOM manipulations [JS 操控]
 */
function applyModule2Settings() {
    const settings = extension_settings[extensionName];
    const isMasterEnabled = settings && settings.enabled;
    const isModule2Enabled = isMasterEnabled && settings.module2;

    applyPromptManagerMaximizeButton();
    applyPromptManagerEntryParamsFolding();
    applyRegexEditorEnhancements();
    applyMaximizedEditorScrollActions();
    applyUserAvatarsFolding();
    applyFirstMessageFolding();

    // Feature 1: Fold Presets (#ai_response_configuration) [JS]
    const shouldFoldPresets = isModule2Enabled && settings.module2.foldPresets;
    const $aiConfig = $('#ai_response_configuration');
    const $presetsBlock = $('#respective-presets-block');

    if ($aiConfig.length > 0 && $presetsBlock.length > 0) {
        let $drawer = $('#cut_m2_gen_params_drawer');
        const $promptManager = $('#completion_prompt_manager').closest('.range-block, #completion_prompt_manager');

        if (shouldFoldPresets) {
            if ($drawer.length === 0) {
                const drawerHtml = `
                <div id="cut_m2_gen_params_drawer" class="inline-drawer wide100p">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>预设参数</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                $presetsBlock.after(drawerHtml);
                $drawer = $('#cut_m2_gen_params_drawer');
            }

            const $drawerContent = $drawer.find('>.inline-drawer-content');
            if ($drawerContent.find('#common-gen-settings-block').length === 0) {
                const $presetItems = $('#common-gen-settings-block, #respective-ranges-and-temps, #advanced-ai-config-block, #kobold_api-settings, #novel_api-settings');
                if ($presetItems.length > 0) {
                    $drawerContent.append($presetItems);
                }
            }
            if ($promptManager.length > 0) {
                $drawer.after($promptManager);
            }
            $drawer.show();
        } else {
            if ($drawer.length > 0 && $drawer.is(':visible')) {
                const $presetItems = $drawer.find('>.inline-drawer-content').children();
                if ($presetItems.length > 0) {
                    $presetsBlock.after($presetItems);
                }
                if ($promptManager.length > 0 && $('#range_block_openai').length > 0) {
                    $('#range_block_openai').append($promptManager);
                }
                $drawer.hide();
            }
        }
    }

    // Feature 2: Fold World Info Top (#wiTopBlock) [JS]
    const shouldFoldWITop = isModule2Enabled && settings.module2.foldWorldInfoTop;
    const $wiHolder = $('#wi-holder');
    const $wiTopBlock = $('#wiTopBlock');

    if ($wiHolder.length > 0 && $wiTopBlock.length > 0) {
        let $wiDrawer = $('#cut_m2_wi_top_drawer');

        if (shouldFoldWITop) {
            if ($wiDrawer.length === 0) {
                const wiDrawerHtml = `
                <div id="cut_m2_wi_top_drawer" class="inline-drawer wide100p">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>全局世界书</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                $wiHolder.prepend(wiDrawerHtml);
                $wiDrawer = $('#cut_m2_wi_top_drawer');
            }

            const $wiDrawerContent = $wiDrawer.find('>.inline-drawer-content');
            if ($wiDrawerContent.find('#wiTopBlock').length === 0) {
                $wiDrawerContent.append($wiTopBlock);
            }
            $wiDrawer.show();
        } else {
            if ($wiDrawer.length > 0 && $wiDrawer.is(':visible')) {
                if ($wiDrawer.find('#wiTopBlock').length > 0) {
                    $wiHolder.prepend($wiTopBlock);
                }
                $wiDrawer.hide();
            }
        }
    }

    // Feature 4: Fold Persona Management Settings ("设定设置") [JS]
    const shouldFoldPersona = isModule2Enabled && settings.module2.foldPersonaSettings;
    const $personaRightCol = $('.persona_management_right_column');

    if ($personaRightCol.length > 0) {
        let $personaDrawer = $('#cut_m2_persona_drawer');

        const $posHeader = $personaRightCol.find('h4[data-i18n="Position"]').closest('.flex-container');
        const $connHeader = $personaRightCol.find('h4[data-i18n="Connections"]');
        const $otherPersonaBlocks = $personaRightCol.find('.persona_management_description_position_container, #persona_depth_position_settings, #persona_connections_buttons, #persona_connections_info_block, #persona_connections_list, .persona_management_global_settings');

        const $personaElements = $posHeader.add($connHeader).add($otherPersonaBlocks);

        if (shouldFoldPersona) {
            if ($personaDrawer.length === 0) {
                const personaDrawerHtml = `
                <div id="cut_m2_persona_drawer" class="inline-drawer wide100p">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>设定设置</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                $personaRightCol.append(personaDrawerHtml);
                $personaDrawer = $('#cut_m2_persona_drawer');
            }

            const $personaDrawerContent = $personaDrawer.find('>.inline-drawer-content');
            if ($personaDrawerContent.find('#persona_depth_position_settings, .persona_management_description_position_container').length === 0) {
                if ($personaElements.length > 0) {
                    $personaDrawerContent.append($personaElements);
                }
            }
            $personaDrawer.show();
        } else {
            if ($personaDrawer.length > 0 && $personaDrawer.is(':visible')) {
                const $itemsToRestore = $personaDrawer.find('>.inline-drawer-content').children();
                if ($itemsToRestore.length > 0) {
                    $personaRightCol.append($itemsToRestore);
                }
                $personaDrawer.hide();
            }
        }
    }

    // Feature 5: Fold Custom CSS ("自定义样式") [JS]
    const shouldFoldCustomCss = isModule2Enabled && settings.module2.foldCustomCss;
    const $customCssBlock = $('#CustomCSS-block');
    const $uiPresetsBlock = $('#UI-presets-block');
    const $col1 = $('div[name="UserSettingsFirstColumn"]');

    if ($customCssBlock.length > 0) {
        let $cssDrawer = $('#cut_m2_custom_css_drawer');

        if (shouldFoldCustomCss) {
            if ($cssDrawer.length === 0) {
                const cssDrawerHtml = `
                <div id="cut_m2_custom_css_drawer" class="inline-drawer wide100p flexFlowColumn">
                    <div class="inline-drawer-toggle inline-drawer-header userSettingsInnerExpandable">
                        <b>自定义样式</b>
                        <div class="cut-css-header-actions">
                            <i class="editor_maximize fa-solid fa-maximize right_menu_button text_pole margin0" data-for="customCSS" title="展开全屏编辑器" style="cursor: pointer;"></i>
                            <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down margin0"></div>
                        </div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                if ($uiPresetsBlock.length > 0) {
                    $uiPresetsBlock.after(cssDrawerHtml);
                } else if ($col1.length > 0) {
                    $col1.prepend(cssDrawerHtml);
                }
                $cssDrawer = $('#cut_m2_custom_css_drawer');
            } else {
                if ($uiPresetsBlock.length > 0) {
                    $uiPresetsBlock.after($cssDrawer);
                }
            }

            const $cssDrawerContent = $cssDrawer.find('>.inline-drawer-content');
            if ($cssDrawerContent.find('#CustomCSS-block').length === 0) {
                $cssDrawerContent.append($customCssBlock);
            }
            $cssDrawer.show();
        } else {
            if ($cssDrawer.length > 0 && $cssDrawer.is(':visible')) {
                const $col2 = $('div[name="UserSettingsSecondColumn"]');
                if ($cssDrawer.find('#CustomCSS-block').length > 0 && $col2.length > 0) {
                    $col2.append($customCssBlock);
                }
                $cssDrawer.hide();
            }
        }
    }

    // Feature 6: Fold UI Effects ("界面效果") [JS]
    const shouldFoldUiEffects = isModule2Enabled && settings.module2.foldUiEffects;
    const $avatarChatDisplay = $('div[name="AvatarAndChatDisplay"]');
    if ($avatarChatDisplay.length > 0) {
        let $effectsDrawer = $('#cut_m2_ui_effects_drawer');

        if (shouldFoldUiEffects) {
            if ($effectsDrawer.length === 0) {
                const effectsDrawerHtml = `
                <div id="cut_m2_ui_effects_drawer" class="inline-drawer wide100p flexFlowColumn">
                    <div class="inline-drawer-toggle inline-drawer-header userSettingsInnerExpandable">
                        <b>界面效果</b>
                        <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                const $cssDrawer = $('#cut_m2_custom_css_drawer');
                if ($cssDrawer.length > 0) {
                    $cssDrawer.after(effectsDrawerHtml);
                } else if ($uiPresetsBlock.length > 0) {
                    $uiPresetsBlock.after(effectsDrawerHtml);
                } else if ($col1.length > 0) {
                    $col1.prepend(effectsDrawerHtml);
                }
                $effectsDrawer = $('#cut_m2_ui_effects_drawer');
            } else {
                const $cssDrawer = $('#cut_m2_custom_css_drawer');
                if ($cssDrawer.length > 0) {
                    $cssDrawer.after($effectsDrawer);
                }
            }

            const $effectsDrawerContent = $effectsDrawer.find('>.inline-drawer-content');
            if ($effectsDrawerContent.find('div[name="AvatarAndChatDisplay"]').length === 0) {
                $effectsDrawerContent.append($avatarChatDisplay);
            }
            $effectsDrawer.show();
        } else {
            if ($effectsDrawer.length > 0 && $effectsDrawer.is(':visible')) {
                if ($effectsDrawer.find('div[name="AvatarAndChatDisplay"]').length > 0) {
                    if ($uiPresetsBlock.length > 0) {
                        $uiPresetsBlock.after($avatarChatDisplay);
                    }
                }
                $effectsDrawer.hide();
            }
        }
    }

    // Feature 7: Fold Theme Toggles ("主题开关") [JS]
    const shouldFoldThemeToggles = isModule2Enabled && settings.module2.foldThemeToggles;
    const $fontBlurBlock = $('div[name="FontBlurChatWidthBlock"]');
    const $themeToggles = $('div[name="themeToggles"]');

    if ($fontBlurBlock.length > 0 || $themeToggles.length > 0) {
        let $togglesDrawer = $('#cut_m2_theme_toggles_drawer');

        if (shouldFoldThemeToggles) {
            if ($togglesDrawer.length === 0) {
                const togglesDrawerHtml = `
                <div id="cut_m2_theme_toggles_drawer" class="inline-drawer wide100p flexFlowColumn">
                    <div class="inline-drawer-toggle inline-drawer-header userSettingsInnerExpandable">
                        <b>主题开关</b>
                        <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                if ($col1.length > 0) {
                    $col1.append(togglesDrawerHtml);
                }
                $togglesDrawer = $('#cut_m2_theme_toggles_drawer');
            }

            const $togglesDrawerContent = $togglesDrawer.find('>.inline-drawer-content');
            $col1.find('hr').hide();
            if ($togglesDrawerContent.find('div[name="FontBlurChatWidthBlock"], div[name="themeToggles"]').length === 0) {
                const $itemsToAppend = $fontBlurBlock.add($themeToggles);
                if ($itemsToAppend.length > 0) {
                    $togglesDrawerContent.append($itemsToAppend);
                }
            }
            $togglesDrawer.show();
        } else {
            if ($togglesDrawer.length > 0 && $togglesDrawer.is(':visible')) {
                const $itemsToRestore = $togglesDrawer.find('div[name="FontBlurChatWidthBlock"], div[name="themeToggles"]');
                if ($itemsToRestore.length > 0 && $col1.length > 0) {
                    $col1.append($itemsToRestore);
                }
                $col1.find('hr').show();
                $togglesDrawer.hide();
            }
        }
    }

    // Feature 8: Fold User Advanced ("高级设置") [JS]
    const shouldFoldUserAdvanced = isModule2Enabled && settings.module2.foldUserAdvanced;
    const $col2 = $('div[name="UserSettingsSecondColumn"]');
    const $col3 = $('div[name="UserSettingsThirdColumn"]');

    if ($col2.length > 0 || $col3.length > 0) {
        let $advDrawer = $('#cut_m2_user_advanced_drawer');
        const $togglesDrawer = $('#cut_m2_theme_toggles_drawer');

        if (shouldFoldUserAdvanced) {
            if ($advDrawer.length === 0) {
                const advDrawerHtml = `
                <div id="cut_m2_user_advanced_drawer" class="inline-drawer wide100p flexFlowColumn">
                    <div class="inline-drawer-toggle inline-drawer-header userSettingsInnerExpandable">
                        <b>高级设置</b>
                        <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: none;"></div>
                </div>
                `;
                if ($togglesDrawer.length > 0) {
                    $togglesDrawer.after(advDrawerHtml);
                } else if ($col1.length > 0) {
                    $col1.append(advDrawerHtml);
                } else if ($col2.length > 0) {
                    $col2.prepend(advDrawerHtml);
                }
                $advDrawer = $('#cut_m2_user_advanced_drawer');
            } else {
                if ($togglesDrawer.length > 0) {
                    $togglesDrawer.after($advDrawer);
                }
            }

            const $advDrawerContent = $advDrawer.find('>.inline-drawer-content');
            
            if ($advDrawerContent.children().length === 0) {
                const $col2Children = $col2.children().not('#cut_m2_user_advanced_drawer, #CustomCSS-block, #cut_m2_custom_css_drawer');
                const $col3Children = $col3.children().not('#cut_m2_user_advanced_drawer, #CustomCSS-block, #cut_m2_custom_css_drawer');
                
                const $allAdvItems = $col2Children.add($col3Children);
                if ($allAdvItems.length > 0) {
                    $advDrawerContent.append($allAdvItems);
                }
            }

            if ($col3.length > 0) {
                $col3.hide();
            }

            $advDrawer.show();
        } else {
            if ($advDrawer.length > 0 && $advDrawer.is(':visible')) {
                const $advItemsToRestore = $advDrawer.find('>.inline-drawer-content').children();
                if ($advItemsToRestore.length > 0) {
                    if ($col2.length > 0) {
                        $col2.append($advItemsToRestore);
                    }
                    if ($col3.length > 0) {
                        $col3.show();
                    }
                }
                $advDrawer.hide();
            }
        }
    }
}

/**
 * Applies CSS classes and dynamic CSS variables according to settings
 */
function applySettings() {
    const settings = extension_settings[extensionName];
    const body = document.body;

    if (!settings || !settings.enabled) {
        body.classList.remove(
            'cut-hide-tutorials', 'cut-hide-language-select', 'cut-hide-redirect-links', 
            'cut-hide-slider-tips', 'cut-hide-cc-invalid', 'cut-mobile-anti-jump',
            'cut-persona-height-active', 'cut-char-desc-height-active', 'cut-css-height-active', 'cut-avatar-height-active'
        );
        applyModule2Settings();
        applyMobileInputAntiJump();
        return;
    }

    // Module 1 Features [CSS & JS]
    body.classList.toggle('cut-hide-tutorials', !!settings.module1.hideTutorials);
    body.classList.toggle('cut-hide-language-select', !!settings.module1.hideLanguageSelect);
    body.classList.toggle('cut-hide-redirect-links', !!settings.module1.hideRedirectLinks);
    body.classList.toggle('cut-hide-slider-tips', !!settings.module1.hideSliderTips);
    body.classList.toggle('cut-hide-cc-invalid', !!settings.module1.hideCcInvalid);

    // Module 2 Dynamic Height Features [CSS Variables]
    const pHeight = parseInt(settings.module2.personaHeight) || 450;
    const cdHeight = parseInt(settings.module2.charDescHeight) || 450;
    const cHeight = parseInt(settings.module2.customCssHeight) || 500;
    const aHeight = parseInt(settings.module2.userAvatarHeight) || 300;

    document.documentElement.style.setProperty('--cut-persona-height', `${pHeight}px`);
    document.documentElement.style.setProperty('--cut-char-desc-height', `${cdHeight}px`);
    document.documentElement.style.setProperty('--cut-css-height', `${cHeight}px`);
    document.documentElement.style.setProperty('--cut-avatar-height', `${aHeight}px`);

    body.classList.toggle('cut-persona-height-active', !!(settings.module2 && settings.module2.enablePersonaHeight));
    body.classList.toggle('cut-char-desc-height-active', !!(settings.module2 && settings.module2.enableCharDescHeight));
    body.classList.toggle('cut-css-height-active', !!(settings.module2 && settings.module2.enableCssHeight));
    body.classList.toggle('cut-avatar-height-active', !!(settings.module2 && settings.module2.enableAvatarHeight));

    applyModule2Settings();
    applyMobileInputAntiJump();
}

/**
 * Renders the extension configuration panel inside the Extensions drawer with sub-tabs
 */
function renderSettingsUI() {
    const containerId = 'cut_container';
    let $container = $(`#${containerId}`);

    if ($container.length === 0) {
        const html = `
        <div id="${containerId}" class="inline-drawer extension_container">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>页面精简</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>

            <div class="inline-drawer-content" style="display: none;">
                <div class="cut-master-row">
                    <span>启用 页面精简 拓展</span>
                    <label class="checkbox_label margin0" title="开启/关闭精简拓展总开关">
                        <input type="checkbox" id="cut_master_toggle">
                    </label>
                </div>

                <div id="cut_modules_wrapper">
                    <!-- 模块切换 Tab 标签页 -->
                    <div class="cut-tabs">
                        <div class="cut-tab active" data-tab="cut_tab_m1">模块一：元素精简</div>
                        <div class="cut-tab" data-tab="cut_tab_m2">模块二：界面收纳</div>
                    </div>

                    <!-- 模块一 Tab 内容 -->
                    <div id="cut_tab_m1" class="cut-tab-content active">
                        <div class="cut-module-section">
                            <div class="cut-module-title"><b>模块一：页面元素精简</b></div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m1_tutorials">
                                    <input type="checkbox" id="cut_m1_tutorials">
                                    <span>隐藏教程图标</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">隐藏设置项旁、标题栏及页面各处的问号帮助与教程图标</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m1_language">
                                    <input type="checkbox" id="cut_m1_language">
                                    <span>隐藏语言选择</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">隐藏用户设置及初始引导页中的界面语言选择框 (Language Selector)</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m1_redirects">
                                    <input type="checkbox" id="cut_m1_redirects">
                                    <span>隐藏快捷链接</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">隐藏欢迎面板与顶部三连快捷图标（Docs、GitHub、Discord 链接）</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m1_slidertips">
                                    <input type="checkbox" id="cut_m1_slidertips">
                                    <span>隐藏滑块提示</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">隐藏“单击滑块以手动输入值”提示框 (#clickSlidersTips)</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m1_ccinvalid">
                                    <input type="checkbox" id="cut_m1_ccinvalid">
                                    <span>隐藏无效格式</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">隐藏高级格式化中聊天补全用不了的设置项 ([data-cc-null]) 与提示</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m1_mobile_input">
                                    <input type="checkbox" id="cut_m1_mobile_input">
                                    <span>手机打字防弹</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">双重拦截机制与分段粘贴渲染合并，彻底解决移动端代码自动聚焦拉起键盘、打字弹跳、长文本粘贴卡顿与视口抖动问题</div>
                        </div>
                    </div>

                    <!-- 模块二 Tab 内容 -->
                    <div id="cut_tab_m2" class="cut-tab-content">
                        <div class="cut-module-section">
                            <div class="cut-module-title"><b>模块二：界面收纳与高度配置</b></div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_presets">
                                    <input type="checkbox" id="cut_m2_fold_presets">
                                    <span>折叠预设参数</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将预设面板中平铺的生成参数收纳进“预设参数”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_witop">
                                    <input type="checkbox" id="cut_m2_fold_witop">
                                    <span>折叠全局世界</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将世界书顶部的激活选择与设置收纳进“全局世界书”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_user_avatars">
                                    <input type="checkbox" id="cut_m2_fold_user_avatars">
                                    <span>折叠人设列表</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将用户设定面板左侧的人设选择网格与搜索栏收纳进“人设列表”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_persona">
                                    <input type="checkbox" id="cut_m2_fold_persona">
                                    <span>折叠设定设置</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将用户设定面板中的“插入位置”、“链接”收纳进“设定设置”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_first_message">
                                    <input type="checkbox" id="cut_m2_fold_first_message">
                                    <span>折叠角色开场</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将角色详情编辑页中的开场白文本框与 Token 统计收纳进“角色开场”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_custom_css">
                                    <input type="checkbox" id="cut_m2_fold_custom_css">
                                    <span>折叠自定义样式</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将自定义 CSS 框收纳进“界面效果”正上方的“自定义样式”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_ui_effects">
                                    <input type="checkbox" id="cut_m2_fold_ui_effects">
                                    <span>折叠界面效果</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将用户设置中的头像/聊天/媒体/通知收纳进“界面效果”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_theme_toggles">
                                    <input type="checkbox" id="cut_m2_fold_theme_toggles">
                                    <span>折叠主题开关</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将用户设置中的宽度/缩放/模糊/阴影滑块与复选开关收纳进“主题开关”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_fold_user_advanced">
                                    <input type="checkbox" id="cut_m2_fold_user_advanced">
                                    <span>折叠高级设置</span>
                                    <span class="cut-option-tag tag-js">JS</span>
                                </label>
                            </div>
                            <div class="cut-option-desc">将用户设置右侧的角色处理与聊天/消息处理收纳进“高级设置”折叠条</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_persona_height_toggle">
                                    <input type="checkbox" id="cut_m2_persona_height_toggle">
                                    <span>人设概述高度</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                                <div class="flex-container alignItemsCenter gap5">
                                    <input type="number" id="cut_m2_persona_height_val" class="text_pole textarea_compact" min="100" max="2000" style="width: 75px; text-align: center;">
                                    <small>px</small>
                                </div>
                            </div>
                            <div class="cut-option-desc">自定义用户设定概述编辑框 (#persona_description) 的高矮</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_char_desc_height_toggle">
                                    <input type="checkbox" id="cut_m2_char_desc_height_toggle">
                                    <span>角色描述高度</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                                <div class="flex-container alignItemsCenter gap5">
                                    <input type="number" id="cut_m2_char_desc_height_val" class="text_pole textarea_compact" min="100" max="2000" style="width: 75px; text-align: center;">
                                    <small>px</small>
                                </div>
                            </div>
                            <div class="cut-option-desc">自定义角色详情编辑页中的角色描述/人设框 (#description_textarea) 的高矮</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_css_height_toggle">
                                    <input type="checkbox" id="cut_m2_css_height_toggle">
                                    <span>自定义样式高度</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                                <div class="flex-container alignItemsCenter gap5">
                                    <input type="number" id="cut_m2_css_height_val" class="text_pole textarea_compact" min="100" max="2000" style="width: 75px; text-align: center;">
                                    <small>px</small>
                                </div>
                            </div>
                            <div class="cut-option-desc">自定义 CSS 代码编辑框 (#customCSS) 的高矮</div>

                            <div class="cut-option-item">
                                <label class="cut-option-label" for="cut_m2_avatar_height_toggle">
                                    <input type="checkbox" id="cut_m2_avatar_height_toggle">
                                    <span>用户选择高度</span>
                                    <span class="cut-option-tag tag-css">CSS</span>
                                </label>
                                <div class="flex-container alignItemsCenter gap5">
                                    <input type="number" id="cut_m2_avatar_height_val" class="text_pole textarea_compact" min="100" max="2000" style="width: 75px; text-align: center;">
                                    <small>px</small>
                                </div>
                            </div>
                            <div class="cut-option-desc">自定义用户人设头像选择栏 (#user_avatar_block) 的最大显示高度</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        if ($('#extensions_settings').length > 0) {
            $('#extensions_settings').append(html);
        } else {
            $('#rm_extensions_block .extensions_block').append(html);
        }

        $container = $(`#${containerId}`);
    }

    // Bind Tab switching logic
    $container.find('.cut-tab').off('click').on('click', function () {
        const tabId = $(this).attr('data-tab');
        $container.find('.cut-tab').removeClass('active');
        $(this).addClass('active');

        $container.find('.cut-tab-content').removeClass('active').hide();
        $container.find(`#${tabId}`).addClass('active').show();
    });

    // Bind values
    const settings = extension_settings[extensionName];
    $('#cut_master_toggle').prop('checked', settings.enabled);
    $('#cut_m1_tutorials').prop('checked', settings.module1.hideTutorials);
    $('#cut_m1_language').prop('checked', settings.module1.hideLanguageSelect);
    $('#cut_m1_redirects').prop('checked', settings.module1.hideRedirectLinks);
    $('#cut_m1_slidertips').prop('checked', settings.module1.hideSliderTips);
    $('#cut_m1_ccinvalid').prop('checked', settings.module1.hideCcInvalid);
    $('#cut_m1_mobile_input').prop('checked', settings.module1.fixMobileInput);

    $('#cut_m2_fold_presets').prop('checked', settings.module2.foldPresets);
    $('#cut_m2_fold_witop').prop('checked', settings.module2.foldWorldInfoTop);
    $('#cut_m2_fold_user_avatars').prop('checked', settings.module2.foldUserAvatars);
    $('#cut_m2_fold_persona').prop('checked', settings.module2.foldPersonaSettings);
    $('#cut_m2_fold_first_message').prop('checked', settings.module2.foldFirstMessage);
    $('#cut_m2_fold_custom_css').prop('checked', settings.module2.foldCustomCss);
    $('#cut_m2_fold_ui_effects').prop('checked', settings.module2.foldUiEffects);
    $('#cut_m2_fold_theme_toggles').prop('checked', settings.module2.foldThemeToggles);
    $('#cut_m2_fold_user_advanced').prop('checked', settings.module2.foldUserAdvanced);

    // Height Toggles & Input Values
    $('#cut_m2_persona_height_toggle').prop('checked', settings.module2.enablePersonaHeight);
    $('#cut_m2_persona_height_val').val(settings.module2.personaHeight || 450);

    $('#cut_m2_char_desc_height_toggle').prop('checked', settings.module2.enableCharDescHeight);
    $('#cut_m2_char_desc_height_val').val(settings.module2.charDescHeight || 450);

    $('#cut_m2_css_height_toggle').prop('checked', settings.module2.enableCssHeight);
    $('#cut_m2_css_height_val').val(settings.module2.customCssHeight || 500);

    $('#cut_m2_avatar_height_toggle').prop('checked', settings.module2.enableAvatarHeight);
    $('#cut_m2_avatar_height_val').val(settings.module2.userAvatarHeight || 300);

    // Event Handlers
    $('#cut_master_toggle').off('change').on('change', function () {
        settings.enabled = $(this).prop('checked');
        $('#cut_modules_wrapper').toggle(settings.enabled);
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m1_tutorials').off('change').on('change', function () {
        settings.module1.hideTutorials = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m1_language').off('change').on('change', function () {
        settings.module1.hideLanguageSelect = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m1_redirects').off('change').on('change', function () {
        settings.module1.hideRedirectLinks = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m1_slidertips').off('change').on('change', function () {
        settings.module1.hideSliderTips = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m1_ccinvalid').off('change').on('change', function () {
        settings.module1.hideCcInvalid = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m1_mobile_input').off('change').on('change', function () {
        settings.module1.fixMobileInput = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_presets').off('change').on('change', function () {
        settings.module2.foldPresets = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_witop').off('change').on('change', function () {
        settings.module2.foldWorldInfoTop = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_user_avatars').off('change').on('change', function () {
        settings.module2.foldUserAvatars = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_persona').off('change').on('change', function () {
        settings.module2.foldPersonaSettings = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_first_message').off('change').on('change', function () {
        settings.module2.foldFirstMessage = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_custom_css').off('change').on('change', function () {
        settings.module2.foldCustomCss = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_ui_effects').off('change').on('change', function () {
        settings.module2.foldUiEffects = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_theme_toggles').off('change').on('change', function () {
        settings.module2.foldThemeToggles = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_fold_user_advanced').off('change').on('change', function () {
        settings.module2.foldUserAdvanced = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    // Height Event Handlers
    $('#cut_m2_persona_height_toggle').off('change').on('change', function () {
        settings.module2.enablePersonaHeight = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_persona_height_val').off('input change').on('input change', function () {
        const val = parseInt($(this).val()) || 450;
        settings.module2.personaHeight = val;
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_char_desc_height_toggle').off('change').on('change', function () {
        settings.module2.enableCharDescHeight = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_char_desc_height_val').off('input change').on('input change', function () {
        const val = parseInt($(this).val()) || 450;
        settings.module2.charDescHeight = val;
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_css_height_toggle').off('change').on('change', function () {
        settings.module2.enableCssHeight = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_css_height_val').off('input change').on('input change', function () {
        const val = parseInt($(this).val()) || 500;
        settings.module2.customCssHeight = val;
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_avatar_height_toggle').off('change').on('change', function () {
        settings.module2.enableAvatarHeight = $(this).prop('checked');
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_m2_avatar_height_val').off('input change').on('input change', function () {
        const val = parseInt($(this).val()) || 300;
        settings.module2.userAvatarHeight = val;
        applySettings();
        saveSettingsDebounced();
    });

    $('#cut_modules_wrapper').toggle(settings.enabled);
}

// Initialize Extension
jQuery(async () => {
    loadSettings();
    initAutoFocusInterceptor();
    initPastePerformanceFix();
    applySettings();

    const checkDrawerInterval = setInterval(() => {
        applyPromptManagerMaximizeButton();
        applyPromptManagerEntryParamsFolding();
        applyRegexEditorEnhancements();
        applyMaximizedEditorScrollActions();

        if ($('#extensions_settings').length > 0 || $('#rm_extensions_block').length > 0) {
            renderSettingsUI();
        }
        if ($('#ai_response_configuration').length > 0 || $('#wi-holder').length > 0 || $('.persona_management_right_column').length > 0 || $('#user-settings-block-content').length > 0 || $('.persona_management_left_column').length > 0 || $('#firstMessageWrapper').length > 0) {
            applyModule2Settings();
        }
        if ($('#cut_container').length > 0 && $('#cut_m2_gen_params_drawer').length > 0) {
            // keep polling lightly for dynamic DOM drawer updates
        }
    }, 500);

    console.log('[UI Trimmer] Extension "cut" (页面精简) initialized successfully.');
});
