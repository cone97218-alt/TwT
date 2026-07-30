// @ts-nocheck
import { getContext } from '../../../extensions.js';

export class TauriTavernBridge {
    /**
     * Check if TauriTavern backend API is ready and accessible.
     * @returns {Promise<boolean>}
     */
    static async isAvailable() {
        try {
            if (window.__TAURITAVERN__?.ready) {
                await window.__TAURITAVERN__.ready;
                return !!(window.__TAURITAVERN__?.api?.chat?.current);
            }
            if (window.__TAURITAVERN_MAIN_READY__) {
                await window.__TAURITAVERN_MAIN_READY__;
                return !!(window.__TAURITAVERN__?.api?.chat?.current);
            }
        } catch (e) {
            console.warn('TwT [TauriTavernBridge]: Readiness check error', e);
        }
        return false;
    }

    /**
     * Get TauriTavern current chat handle.
     * @returns {Promise<any|null>}
     */
    static async getHandle() {
        const available = await this.isAvailable();
        if (!available) return null;
        try {
            return window.__TAURITAVERN__.api.chat.current.handle();
        } catch (e) {
            console.warn('TwT [TauriTavernBridge]: Failed to get chat handle', e);
            return null;
        }
    }

    /**
     * Read paragraph comments for a specific message index.
     * @param {number} msgIndex 
     * @returns {Promise<Array>}
     */
    static async getComments(msgIndex) {
        const handle = await this.getHandle();
        if (handle?.store) {
            try {
                const storedComments = await handle.store.getJson({
                    namespace: 'twt-comments',
                    key: `msg_${msgIndex}`
                });
                if (storedComments && Array.isArray(storedComments)) {
                    return storedComments;
                }
            } catch (e) {
                console.warn(`TwT [TauriTavernBridge]: Error reading comments from store for msg ${msgIndex}`, e);
            }
        }
        // Fallback: Read from message.extra
        const context = typeof getContext === 'function' ? getContext() : null;
        const chatArray = context ? context.chat : (window.chat || []);
        const msg = chatArray[msgIndex];
        return msg?.extra?.twt_comments || [];
    }

    /**
     * Save paragraph comments for a specific message index.
     * @param {number} msgIndex 
     * @param {Array} comments 
     */
    static async saveComments(msgIndex, comments) {
        const handle = await this.getHandle();
        const context = typeof getContext === 'function' ? getContext() : null;
        const chatArray = context ? context.chat : (window.chat || []);
        const msg = chatArray[msgIndex];

        if (handle?.store) {
            try {
                await handle.store.setJson({
                    namespace: 'twt-comments',
                    key: `msg_${msgIndex}`,
                    value: comments
                });
                if (msg) {
                    msg.extra = msg.extra || {};
                    msg.extra.has_twt_comments = (comments && comments.length > 0);
                }
                return;
            } catch (e) {
                console.warn(`TwT [TauriTavernBridge]: Error saving comments to store for msg ${msgIndex}`, e);
            }
        }

        // Fallback: Save to message.extra
        if (msg) {
            msg.extra = msg.extra || {};
            msg.extra.twt_comments = comments;
        }
    }

    /**
     * Full-text CJK search messages using TauriTavern backend or fallback to JS search.
     * @param {Object} options 
     * @param {string} options.query 
     * @param {number} [options.limit=20] 
     * @param {Object} [options.filters] 
     * @returns {Promise<Array>} List of hit objects { index, score, snippet, role, text }
     */
    static async searchMessages({ query, limit = 20, filters = {} } = {}) {
        const handle = await this.getHandle();
        if (handle?.searchMessages) {
            try {
                const hits = await handle.searchMessages({
                    query,
                    limit,
                    filters
                });
                if (hits && Array.isArray(hits)) {
                    return hits;
                }
            } catch (e) {
                console.warn('TwT [TauriTavernBridge]: searchMessages error', e);
            }
        }

        // Fallback: Basic JS text filter
        const context = typeof getContext === 'function' ? getContext() : null;
        const chatArray = context ? context.chat : (window.chat || []);
        const hits = [];
        const lowerQuery = (query || '').toLowerCase();
        
        for (let i = 0; i < chatArray.length; i++) {
            const msg = chatArray[i];
            if (!msg || !msg.mes) continue;
            if (filters.role && msg.is_user && filters.role === 'assistant') continue;
            if (filters.role && !msg.is_user && filters.role === 'user') continue;
            
            const text = msg.mes;
            if (text.toLowerCase().includes(lowerQuery)) {
                hits.push({
                    index: i,
                    score: 1.0,
                    snippet: text.length > 100 ? text.substring(0, 100) + '...' : text,
                    role: msg.is_user ? 'user' : (msg.is_system ? 'system' : 'assistant'),
                    text: text
                });
                if (hits.length >= limit) break;
            }
        }
        return hits;
    }

    /**
     * Fast scan for the last message satisfying given criteria.
     * @param {Object} options 
     * @param {string} [options.role] 
     * @param {Array<string>} [options.hasExtraKeys] 
     * @param {number} [options.scanLimit=2000] 
     * @returns {Promise<{ index: number, message: any }|null>}
     */
    static async findLastMessage({ role, hasExtraKeys, scanLimit = 2000 } = {}) {
        const handle = await this.getHandle();
        if (handle?.locate?.findLastMessage) {
            try {
                const hit = await handle.locate.findLastMessage({
                    role,
                    hasExtraKeys,
                    scanLimit
                });
                if (hit) return hit;
            } catch (e) {
                console.warn('TwT [TauriTavernBridge]: findLastMessage error', e);
            }
        }

        // Fallback: Reverse scan in JS
        const context = typeof getContext === 'function' ? getContext() : null;
        const chatArray = context ? context.chat : (window.chat || []);
        let scanned = 0;
        
        for (let i = chatArray.length - 1; i >= 0; i--) {
            if (scanned >= scanLimit) break;
            scanned++;
            const msg = chatArray[i];
            if (!msg) continue;
            
            if (role) {
                if (role === 'assistant' && (msg.is_user || msg.is_system)) continue;
                if (role === 'user' && !msg.is_user) continue;
            }

            if (hasExtraKeys && Array.isArray(hasExtraKeys)) {
                const extra = msg.extra || {};
                const hasAll = hasExtraKeys.every(k => extra[k] !== undefined);
                if (!hasAll) continue;
            }

            return { index: i, message: msg };
        }
        return null;
    }

    /**
     * Save reading progress / configuration in chat_metadata extensions.
     * @param {Object} progress 
     */
    static async saveReadingProgress(progress) {
        const handle = await this.getHandle();
        if (handle?.metadata?.setExtension) {
            try {
                await handle.metadata.setExtension({
                    namespace: 'TwT',
                    value: progress
                });
                return;
            } catch (e) {
                console.warn('TwT [TauriTavernBridge]: Error saving metadata', e);
            }
        }
    }

    /**
     * Get reading progress / configuration from chat_metadata extensions.
     * @returns {Promise<Object|null>}
     */
    static async getReadingProgress() {
        const handle = await this.getHandle();
        if (handle?.metadata?.get) {
            try {
                const meta = await handle.metadata.get();
                return meta?.extensions?.TwT || null;
            } catch (e) {
                console.warn('TwT [TauriTavernBridge]: Error reading metadata', e);
            }
        }
        return null;
    }
}
