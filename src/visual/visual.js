function getAllDocs() {
    const docs = [document];
    try {
        if (window.parent && window.parent.document && !docs.includes(window.parent.document)) {
            docs.push(window.parent.document);
        }
    } catch (e) {}
    try {
        if (window.top && window.top.document && !docs.includes(window.top.document)) {
            docs.push(window.top.document);
        }
    } catch (e) {}
    return docs;
}

export function applyVisualMode(enabled, settings) {
    const docs = getAllDocs();
    docs.forEach(doc => {
        try {
            if (enabled) {
                if (doc.body) doc.body.classList.add('twt-visual-mode');
                const chatContainer = doc.getElementById('chat');
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
                    if (doc.documentElement) {
                        doc.documentElement.style.setProperty('--twt-global-font-family', `"${cleanFont}", sans-serif`);
                    }
                    if (doc.body) {
                        doc.body.classList.add('twt-custom-font-active');
                    }
                } else {
                    if (doc.documentElement) {
                        doc.documentElement.style.removeProperty('--twt-global-font-family');
                    }
                    if (doc.body) {
                        doc.body.classList.remove('twt-custom-font-active');
                    }
                }
            } else {
                if (doc.body) {
                    doc.body.classList.remove('twt-visual-mode');
                    doc.body.classList.remove('twt-custom-font-active');
                }
                if (doc.documentElement) {
                    doc.documentElement.style.removeProperty('--twt-global-font-family');
                }
            }
        } catch (e) {
            console.warn('[TwT] applyVisualMode failed for document:', e);
        }
    });
}

