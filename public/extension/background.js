// Background service worker for EvAN PCRA Automation
// Handles extension lifecycle and tab reload re-injection.
// No top-level await or async — all async work is inside event listeners.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[EvAN-PCRA] Extension installed');
});

// When a tab finishes loading, ensure the content script is present.
// If the content_scripts manifest entry already injected it, this is a no-op.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const url = tab.url || '';
  // Skip restricted pages where injection is not allowed
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)) return;

  // Ping the content script; if no response, inject it programmatically
  chrome.tabs.sendMessage(tabId, { cmd: 'ping', data: {} }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            console.log('[EvAN-PCRA] Auto-inject skipped:', chrome.runtime.lastError.message);
          } else {
            console.log('[EvAN-PCRA] Auto-injected content script into tab', tabId);
          }
        }
      );
    }
  });
});

// Relay messages between popup and content script if needed
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.cmd === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] || null });
    });
    return true; // async response
  }
});
