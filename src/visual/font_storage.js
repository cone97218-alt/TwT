// font_storage.js — 本地字体 IndexedDB 存储管理

const DB_NAME = 'twt_font_db';
const STORE_NAME = 'fonts';
const DB_VERSION = 1;

let dbPromise = null;
const activeBlobUrls = new Map();

function getDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    return dbPromise;
}

export async function saveFontToStorage(id, arrayBuffer, mime = 'font/ttf') {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
            id,
            data: arrayBuffer,
            mime,
            updatedAt: Date.now()
        };
        const req = store.put(record);
        req.onsuccess = () => {
            if (activeBlobUrls.has(id)) {
                try {
                    URL.revokeObjectURL(activeBlobUrls.get(id));
                } catch (e) {}
                activeBlobUrls.delete(id);
            }
            resolve(true);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function getFontFromStorage(id) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('[TwT] getFontFromStorage failed:', e);
        return null;
    }
}

export async function getFontBlobUrl(id) {
    if (activeBlobUrls.has(id)) {
        return activeBlobUrls.get(id);
    }
    const record = await getFontFromStorage(id);
    if (!record || !record.data) return null;
    const blob = record.data instanceof Blob ? record.data : new Blob([record.data], { type: record.mime || 'font/ttf' });
    const url = URL.createObjectURL(blob);
    activeBlobUrls.set(id, url);
    return url;
}

export async function deleteFontFromStorage(id) {
    try {
        if (activeBlobUrls.has(id)) {
            try {
                URL.revokeObjectURL(activeBlobUrls.get(id));
            } catch (e) {}
            activeBlobUrls.delete(id);
        }
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('[TwT] deleteFontFromStorage failed:', e);
        return false;
    }
}

export function revokeAllFontBlobUrls() {
    for (const [id, url] of activeBlobUrls.entries()) {
        try {
            URL.revokeObjectURL(url);
        } catch (e) {}
    }
    activeBlobUrls.clear();
}
