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
            chatContainer.style.setProperty('--twt-paragraph-spacing', `${settings.paragraphSpacing ?? 0}px`, 'important');
            chatContainer.style.setProperty('--twt-letter-spacing', `${settings.letterSpacing ?? 0}px`, 'important');
        }
    } else {
        document.body.classList.remove('twt-visual-mode');
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            chatContainer.style.removeProperty('--twt-padding-top');
            chatContainer.style.removeProperty('--twt-padding-bottom');
            chatContainer.style.removeProperty('--twt-padding-left');
            chatContainer.style.removeProperty('--twt-padding-right');
            chatContainer.style.removeProperty('--twt-font-size');
            chatContainer.style.removeProperty('--twt-line-height');
            chatContainer.style.removeProperty('--twt-text-indent');
            chatContainer.style.removeProperty('--twt-text-align');
            chatContainer.style.removeProperty('--twt-paragraph-spacing');
            chatContainer.style.removeProperty('--twt-letter-spacing');
        }
    }
}
