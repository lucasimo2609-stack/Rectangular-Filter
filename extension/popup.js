const box = document.getElementById('enabled');
chrome.storage.local.get({ enabled: true }, (v) => { box.checked = v.enabled !== false; });
box.addEventListener('change', () => chrome.storage.local.set({ enabled: box.checked }));
document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  window.close();
});
