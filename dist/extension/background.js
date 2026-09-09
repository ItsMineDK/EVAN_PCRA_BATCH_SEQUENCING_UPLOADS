// Background service worker for EvAN PCRA Automation
// Handles extension lifecycle and tab reload re-injection

chrome.runtime.onInstalled.addListener(() => {
  console.log('[EvAN-PCRA] Extension installed');
});

// When a tab finishes loading, ensure the content script is present.
// If the content_scripts manifest entry already injected it, this is a no-op ping.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab.url || '';
  // Skip restricted pages
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)) return;

  // Ping the content script; if no response, inject it
  chrome.tabs.sendMessage(tabId, { cmd: 'ping', data: {} }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] },
        () => {
          if (chrome.runtime.lastError) {
            console.log('[EvAN-PCRA] Auto-inject skipped:', chrome.runtime.lastError.message);
          } else {\n            console.log('[EvAN-PCRA] Auto-injected content script into tab', tabId);\n          }\n        }\n      );\n    }\n  });\n});\n\n// Relay messages between popup and content script if needed\nchrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {\n  if (msg && msg.cmd === 'getActiveTab') {\n    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {\n      sendResponse({ tab: tabs[0] || null });\n    });\n    return true;\n  }\n});\n