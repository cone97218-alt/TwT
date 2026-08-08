export function applyVisualMode(enabled, settings) {
    if (enabled) {
        document.body.classList.add('twt-visual-mode');
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            chatContainer.style.setProperty('--twt-padding-top', `${settings.paddingTop}px`, 'important');
            chatContainer.style.setProperty('--twt-padding-bottom', `${settings.paddingBottom}px`, 'important');
            chatContainer.style.setProperty('--twt-padding-left', `${settings.paddingLeft}px`, 'important');
            chatContainer.style.setProperty('--twt-padding-right', `${settings.paddingRight}px`, 'important');
            chatContainer.style.setProperty('--twt-font-size', `${settings.fontSize}px`, 'important');
            chatContainer.style.setProperty('--twt-line-height', `${settings.lineHeight}`, 'important');
            chatContainer.style.setProperty('--twt-text-indent', `${settings.textIndent ?? 0}em`, 'important');
            chatContainer.style.setProperty('--twt-text-align', `${settings.textAlign ?? 'left'}`, 'important');

            const pSpacing = Number(settings.paragraphSpacing);
            if (!isNaN(pSpacing) && settings.paragraphSpacing !== '' && settings.paragraphSpacing !== null && settings.paragraphSpacing !== undefined) {
                chatContainer.style.setProperty('--twt-paragraph-spacing', `${pSpacing}px`, 'important');
            } else {
                chatContainer.style.removeProperty('--twt-paragraph-spacing');
            }

            chatContainer.style.setProperty('--twt-letter-spacing', `${settings.letterSpacing ?? 0}px`, 'important');
            chatContainer.style.setProperty('--twt-font-weight', `${settings.fontWeight ?? 'normal'}`, 'important');
        }
        if (settings.fontFamily && settings.fontFamily !== 'inherit') {
            const cleanFont = settings.fontFamily.replace(/"/g, '');
            document.documentElement.style.setProperty('--twt-global-font-family', `"${cleanFont}", sans-serif`);
            document.body.classList.add('twt-custom-font-active');
        } else {
            document.documentElement.style.removeProperty('--twt-global-font-family');
            document.body.classList.remove('twt-custom-font-active');
        }
    } else {
        document.body.classList.remove('twt-visual-mode');
        document.documentElement.style.removeProperty('--twt-global-font-family');
        document.body.classList.remove('twt-custom-font-active');
    }
}

