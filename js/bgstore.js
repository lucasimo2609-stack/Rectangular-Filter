// Persists the background plate (a JPEG data URL) so it is ready before the next call.
// In the extension it lives in chrome.storage.local, shared by the in-call panel and
// the full-tab app; on the web it falls back to localStorage.

const KEY = 'rectfilter.background.v1';
const ext = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

export const bgStore = {
  async load() {
    try {
      if (ext) return (await chrome.storage.local.get(KEY))[KEY] || null;
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch { return null; }
  },

  /** value: { dataUrl, kind: 'upload' | 'capture' } */
  async save(value) {
    try {
      if (ext) await chrome.storage.local.set({ [KEY]: value });
      else localStorage.setItem(KEY, JSON.stringify(value));
      return true;
    } catch { return false; }
  },

  async clear() {
    try {
      if (ext) await chrome.storage.local.remove(KEY);
      else localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  },

  /** Calls back when another page of the extension changes the background. */
  onChange(cb) {
    if (!ext) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) cb(changes[KEY].newValue || null);
    });
  },
};
