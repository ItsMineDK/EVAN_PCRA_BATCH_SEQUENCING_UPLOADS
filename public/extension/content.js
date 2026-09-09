(function () {
  'use strict';

  // Content script runs in isolated world by default.
  // We use a page-injected script (inject.js) to interact with page-level
  // JSF state and window.alert overrides. This script relays commands
  // from the popup to the page via window.postMessage.

  const TAG = '[EvAN-PCRA]';

  function injectPageScript() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  injectPageScript();

  // ---- Helpers ----
  function waitForSelector(selector, timeout) {
    timeout = timeout || 15000;
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          obs.disconnect();
          resolve(found);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error('Timeout waiting for ' + selector));
      }, timeout);
    });
  }

  function setNativeValue(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setNativeSelect(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---- Command handlers (run in content script isolated world) ----
  // We delegate DOM work to the injected page script via postMessage,
  // but since the selectors are in the main page DOM (accessible from
  // content script too), we do the DOM work directly here for reliability.
  // The inject.js script handles alert() dismissal only.

  async function enterTransaction(data) {
    const { pan, delay } = data;
    const selector = 'input[id="xact_quicknav_form:transLineField"]';
    const field = await waitForSelector(selector, 10000);
    field.focus();
    field.value = '';
    setNativeValue(field, '');
    await sleep(Math.max(100, delay / 4));

    const target = 'PCRA ' + pan;
    setNativeValue(field, target);
    await sleep(Math.max(100, delay / 4));

    // Click the "Go" button to submit — this triggers a JSF postback that reloads the page.
    // We respond immediately and let the popup-side wait for the new page to load.
    const goBtn = document.querySelector('input[id="xact_quicknav_form:goButton"]');
    if (goBtn) {
      goBtn.focus();
      goBtn.click();
    } else {
      // Fallback: submit the form directly if the Go button is not found
      const form = field.form;
      if (form) {
        try {
          form.requestSubmit();
        } catch (e) {
          form.submit();
        }
      }
    }

    // Return immediately — the page will reload and this content script will be destroyed.
    // The popup waits for the new page to load and re-injects the content script.
    return { ok: true, navigating: true };
  }

  async function updateSequenceNo(data) {
    const { newSeq } = data;
    const selector = 'input[id="screen_form:sequenceNo"]';
    const field = await waitForSelector(selector, 10000);
    const previousSeq = (field.value || '').trim();
    field.focus();
    field.select();
    setNativeValue(field, newSeq);
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, previousSeq: previousSeq };
  }

  async function updateCompany() {
    // Read the owner text from the page DOM and decide Company vs Person:
    //   Contains "," -> Person (N)
    //   No ","      -> Company (Y)
    const ownerEl = document.querySelector('span[id="screen_form:outputOwner"]');
    const ownerText = ownerEl ? (ownerEl.textContent || '').trim() : '';
    const value = ownerText.includes(',') ? 'N' : 'Y';

    const selector = 'select[id="screen_form:companyCode"]';
    const select = await waitForSelector(selector, 10000);
    setNativeSelect(select, value);
    return { ok: true, company: value, owner: ownerText };
  }

  async function clickSave(data) {
    const { delay } = data;
    const selector = 'input[id="screen_form:save"]';
    const btn = await waitForSelector(selector, 10000);
    btn.focus();
    btn.click();
    // The save triggers a JSF postback that reloads the page.
    // Return immediately — do NOT wait, since the content script will be destroyed.
    // The popup waits for the new page to load and re-injects the content script.
    return { ok: true, navigating: true };
  }

  // ---- Message router ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.cmd) return;

    (async () => {
      try {
        let result;
        switch (msg.cmd) {
          case 'ping':
            result = { ok: true };
            break;
          case 'enterTransaction':
            result = await enterTransaction(msg.data);
            break;
          case 'updateSequenceNo':
            result = await updateSequenceNo(msg.data);
            break;
          case 'updateCompany':
            result = await updateCompany(msg.data);
            break;
          case 'clickSave':
            result = await clickSave(msg.data);
            break;
          default:
            result = { ok: false, error: 'Unknown command: ' + msg.cmd };
        }
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true; // async response
  });

  console.log(TAG, 'Content script loaded');
})();
