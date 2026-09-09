(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const uploadArea = $('uploadArea');
  const fileInput = $('fileInput');
  const uploadText = $('uploadText');
  const delayInput = $('delayInput');
  const rowsInfo = $('rowsInfo');
  const startBtn = $('startBtn');
  const pauseBtn = $('pauseBtn');
  const stopBtn = $('stopBtn');
  const currentRowEl = $('currentRow');
  const totalRowsEl = $('totalRows');
  const progressFill = $('progressFill');
  const statusEl = $('status');
  const statusText = $('statusText');
  const errorSection = $('errorSection');
  const errorCountEl = $('errorCount');
  const exportBtn = $('exportBtn');
  const auditSection = $('auditSection');
  const auditExportBtn = $('auditExportBtn');
  const logBox = $('logBox');

  let rows = [];
  let errors = [];
  let auditLog = [];
  let running = false;
  let paused = false;
  let stopped = false;
  let currentIdx = 0;
  let activeTabId = null;

  // ---- Logging ----
  function log(msg, type) {
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (type ? ' ' + type : '');
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${msg}`;
    logBox.appendChild(entry);
    logBox.classList.remove('hidden');
    logBox.scrollTop = logBox.scrollHeight;
    // Keep log bounded
    while (logBox.children.length > 200) {
      logBox.removeChild(logBox.firstChild);
    }
  }

  function setStatus(text, cls) {
    statusText.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  function updateProgress(idx, total) {
    currentRowEl.textContent = idx;
    totalRowsEl.textContent = total;
    const pct = total > 0 ? Math.round((idx / total) * 100) : 0;
    progressFill.style.width = pct + '%';
  }

  // ---- Excel parsing ----
  uploadArea.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        rows = json
          .map((r) => ({
            seq: String(r['SEQ #'] ?? r['SEQ'] ?? r['seq'] ?? '').trim(),
            newSeq: String(r['New Seq #'] ?? r['New Seq'] ?? r['newSeq'] ?? '').trim(),
            pan: String(r['PAN'] ?? r['pan'] ?? '').trim(),
          }))
          .filter((r) => r.pan);
        rowsInfo.value = rows.length;
        totalRowsEl.textContent = rows.length;
        if (rows.length > 0) {
          startBtn.disabled = false;
          uploadArea.classList.add('has-file');
          uploadText.innerHTML = `<strong>${file.name}</strong><br/>${rows.length} rows loaded`;
          log(`Loaded ${rows.length} rows from ${file.name}`, 'ok');
          setStatus(`${rows.length} rows ready`, '');
        } else {
          startBtn.disabled = true;
          log('No valid rows found in file', 'err');
          setStatus('No data', 'error');
        }
      } catch (err) {
        log('Failed to read Excel: ' + err.message, 'err');
        setStatus('File error', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  });

  // ---- Tab detection ----
  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) throw new Error('No active tab found');
    return tabs[0];
  }

  // ---- Communication with content script ----
  function sendCommand(cmd, data) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(activeTabId, { cmd, data }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, error: 'No response' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // Inject content.js + xlsx library into the active tab
  async function injectContentScript() {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['lib/xlsx.full.min.js'],
    });
  }

  // Ensure content script is loaded — ping first, inject on failure, then re-ping
  async function ensureContentScript() {
    const tab = await getActiveTab();
    activeTabId = tab.id;

    // Skip restricted pages where injection is not allowed
    const url = tab.url || '';
    if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)) {
      throw new Error('Cannot run on this page. Open the EvAN intranet tab first.');
    }

    // Try pinging the content script
    let ping = await sendCommand('ping', {});
    if (ping.ok) return;

    // Content script not present — inject it
    log('Injecting content script into active tab...');
    try {
      await injectContentScript();
    } catch (e) {
      throw new Error('Injection failed: ' + e.message + '. Make sure you are on the EvAN intranet page.');
    }

    // Wait briefly for the script to initialize, then re-ping
    await delay(400);
    ping = await sendCommand('ping', {});
    if (!ping.ok) {
      throw new Error('Content script did not respond after injection.');
    }
    log('Content script injected successfully');
  }

  // ---- Automation loop ----
  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Wait for the active tab to finish loading (after a JSF postback reload)
  function waitForTabLoad(timeout) {
    timeout = timeout || 30000;
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(ok);
      };
      const listener = (tabId, info) => {
        if (tabId === activeTabId && info.status === 'complete') finish(true);
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Also check current status immediately (may already be loading)
      chrome.tabs.get(activeTabId, (tab) => {
        if (chrome.runtime.lastError) return finish(false);
        if (tab.status === 'complete') finish(true);
      });
      setTimeout(() => finish(false), timeout);
    });
  }

  // Send a command with automatic re-injection if the content script is gone
  // (happens after JSF postbacks reload the page)
  async function sendCommandWithRetry(cmd, data) {
    let res = await sendCommand(cmd, data);
    if (res.ok) return res;

    // Content script may have been lost after a page reload — re-inject and retry
    log('Reconnecting to tab...');
    try {
      await injectContentScript();
      await delay(400);
    } catch (e) {
      return { ok: false, error: 'Re-injection failed: ' + e.message };
    }
    res = await sendCommand(cmd, data);
    return res;
  }

  // Send a command that triggers a page navigation (JSF postback).
  // The content script will be destroyed, so we: send the command, wait for
  // the new page to load, re-inject the content script, then resolve.
  async function sendNavigatingCommand(cmd, data) {
    let res = await sendCommand(cmd, data);
    if (!res.ok) {
      // Content script may already be gone — try re-injecting and retrying
      try {
        await injectContentScript();
        await delay(400);
        res = await sendCommand(cmd, data);
      } catch (e) {
        return { ok: false, error: 'Re-injection failed: ' + e.message };
      }
    }
    if (!res.ok) return res;

    // Wait for the JSF postback to reload the page
    log('Waiting for page to load...');
    const loaded = await waitForTabLoad(30000);
    if (!loaded) return { ok: false, error: 'Page did not reload after ' + cmd };

    // Re-inject content script into the freshly loaded page
    try {
      await injectContentScript();
      await delay(400);
    } catch (e) {
      return { ok: false, error: 'Re-injection after navigation failed: ' + e.message };
    }
    return { ok: true };
  }

  async function processRow(row, idx) {
    const delayMs = parseInt(delayInput.value, 10) || 800;

    // Step 1: Transaction entry — type "PCRA <PAN>" and press Enter
    setStatus(`Row ${idx + 1}: navigating to PCRA ${row.pan}...`, 'running');
    log(`Row ${idx + 1}/${rows.length} — PAN ${row.pan}`);

    let res = await sendNavigatingCommand('enterTransaction', { pan: row.pan, delay: delayMs });
    if (!res.ok) throw new Error('Transaction entry failed: ' + (res.error || 'unknown'));

    // Step 2: Field updates (page has reloaded — content script was re-injected)
    setStatus(`Row ${idx + 1}: updating fields...`, 'running');

    res = await sendCommandWithRetry('updateSequenceNo', { newSeq: row.newSeq, delay: delayMs });
    if (!res.ok) throw new Error('Sequence update failed: ' + (res.error || 'unknown'));
    const previousSeq = res.previousSeq || '';
    await delay(Math.max(200, delayMs / 2));

    res = await sendCommandWithRetry('updateCompany', {});
    if (!res.ok) throw new Error('Company update failed: ' + (res.error || 'unknown'));
    const companyDecision = res.company || '';
    const ownerText = res.owner || '';
    if (companyDecision) log(`  Company set to ${companyDecision} (owner: ${ownerText || 'n/a'})`);
    await delay(Math.max(200, delayMs / 2));

    // Record audit data for this row
    auditLog.push({
      pan: row.pan,
      previousSeq: previousSeq,
      newSeq: row.newSeq,
      owner: ownerText,
      company: companyDecision,
    });

    // Step 3: Save (triggers another JSF postback reload)
    setStatus(`Row ${idx + 1}: saving...`, 'running');
    res = await sendNavigatingCommand('clickSave', { delay: delayMs });
    if (!res.ok) throw new Error('Save failed: ' + (res.error || 'unknown'));

    log(`Row ${idx + 1} complete`, 'ok');
  }

  async function runAutomation() {
    running = true;
    paused = false;
    stopped = false;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;

    try {
      await ensureContentScript();
      log('Connected to active tab');
    } catch (e) {
      log('Cannot connect to tab: ' + e.message, 'err');
      setStatus('Connection error', 'error');
      running = false;
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      stopBtn.disabled = true;
      return;
    }

    while (currentIdx < rows.length && !stopped) {
      // Pause loop
      while (paused && !stopped) {
        setStatus('Paused', 'paused');
        await delay(300);
      }
      if (stopped) break;

      const row = rows[currentIdx];
      updateProgress(currentIdx + 1, rows.length);

      try {
        await processRow(row, currentIdx);
      } catch (err) {
        log(`Row ${currentIdx + 1} ERROR: ${err.message}`, 'err');
        errors.push({
          row: currentIdx + 1,
          seq: row.seq,
          newSeq: row.newSeq,
          pan: row.pan,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
        errorCountEl.textContent = errors.length;
        errorSection.classList.remove('hidden');
        const auditCountEl = $('auditCount');
        if (auditCountEl) auditCountEl.textContent = auditLog.length;
        setStatus(`Row ${currentIdx + 1} failed — skipping`, 'error');
        await delay(parseInt(delayInput.value, 10) || 800);
      }

      currentIdx++;
    }

    running = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;

    if (stopped) {
      setStatus('Stopped', '');
      log('Automation stopped by user');
    } else if (errors.length > 0) {
      setStatus(`Done — ${errors.length} error(s)`, 'error');
      log(`Completed with ${errors.length} error(s)`, 'err');
    } else {
      setStatus('Completed successfully', '');
      log('All rows processed successfully', 'ok');
    }

    // Show audit export if any rows were processed
    if (auditLog.length > 0) {
      auditSection.classList.remove('hidden');
    }

    // Keep Start enabled to allow re-run; reset index if finished
    if (currentIdx >= rows.length) {
      startBtn.textContent = 'Restart';
      startBtn.disabled = false;
      startBtn.onclick = () => {
        currentIdx = 0;
        errors = [];
        auditLog = [];
        errorCountEl.textContent = '0';
        errorSection.classList.add('hidden');
        auditSection.classList.add('hidden');
        updateProgress(0, rows.length);
        startBtn.textContent = 'Start';
        startBtn.onclick = null;
        runAutomation();
      };
    }
  }

  // ---- Button handlers ----
  startBtn.addEventListener('click', () => {
    if (rows.length === 0) return;
    runAutomation();
  });

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    if (paused) {
      pauseBtn.textContent = 'Resume';
      setStatus('Paused', 'paused');
      log('Automation paused');
    } else {
      pauseBtn.textContent = 'Pause';
      log('Automation resumed');
    }
  });

  stopBtn.addEventListener('click', () => {
    stopped = true;
    paused = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pause';
  });

  // ---- Error CSV export ----
  exportBtn.addEventListener('click', () => {
    if (errors.length === 0) return;
    const headers = ['Row', 'SEQ #', 'New Seq #', 'PAN', 'Error', 'Timestamp'];
    const csv = [
      headers.join(','),
      ...errors.map((e) =>
        [e.row, e.seq, e.newSeq, e.pan, `"${e.error.replace(/"/g, '""')}"`, e.timestamp].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      chrome.downloads.download({
        url: url,
        filename: 'pcra_error_log.csv',
        saveAs: true,
      });
    };
    reader.readAsDataURL(blob);
  });

  // ---- Audit CSV export ----
  auditExportBtn.addEventListener('click', () => {
    if (auditLog.length === 0) return;
    const headers = ['PAN', 'Previous SEQ #', 'New SEQ #', 'Owner', 'Company Decision'];
    const csv = [
      headers.join(','),
      ...auditLog.map((a) =>
        [
          a.pan,
          `"${(a.previousSeq || '').replace(/"/g, '""')}"`,
          `"${(a.newSeq || '').replace(/"/g, '""')}"`,
          `"${(a.owner || '').replace(/"/g, '""')}"`,
          a.company || '',
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      chrome.downloads.download({
        url: url,
        filename: 'pcra_audit_log.csv',
        saveAs: true,
      });
    };
    reader.readAsDataURL(blob);
  });

  // Initial state
  setStatus('Idle', '');
})();
