(function () {
  'use strict';

  // This script runs in the MAIN page world (injected via <script> tag).
  // Its job: override window.alert so JSF modal popups are auto-dismissed
  // during automation, and relay any alert text back to the content script.

  const TAG = '[EvAN-PCRA-inject]';

  // Override window.alert to auto-accept and capture the message
  const originalAlert = window.alert;
  let lastAlertMessage = null;

  window.alert = function (message) {
    lastAlertMessage = String(message || '');
    console.log(TAG, 'Auto-dismissed alert:', lastAlertMessage);
    // Relay to content script
    window.postMessage({ source: 'evan-pcra-inject', type: 'alert', message: lastAlertMessage }, '*');
    // Do NOT call originalAlert — we suppress the modal
  };

  // Also override window.confirm to auto-accept
  const originalConfirm = window.confirm;
  window.confirm = function (message) {
    console.log(TAG, 'Auto-confirmed:', String(message || ''));
    window.postMessage({ source: 'evan-pcra-inject', type: 'confirm', message: String(message || '') }, '*');
    return true;
  };

  console.log(TAG, 'Page inject script loaded — alert/confirm auto-dismiss active');
})();
