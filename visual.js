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
        }
    } else {
        document.body.classList.remove('twt-visual-mode');
    }
}
