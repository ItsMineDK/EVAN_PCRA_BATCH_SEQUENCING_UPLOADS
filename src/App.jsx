import { useState, useCallback } from 'react';

const EXTENSION_FILES = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'background.js',
  'content.js',
  'inject.js',
  'lib/xlsx.full.min.js',
  'icon-16.png',
  'icon-48.png',
  'icon-128.png',
];

function Step({ n, title, children }) {
  return (
    <div className="step">
      <div className="step-num">{n}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Feat({ icon, title, children }) {
  return (
    <div className="feat-item">
      <div className="feat-icon">{icon}</div>
      <div className="feat-text">
        <h4>{title}</h4>
        <p>{children}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder('evan-pcra-automation');

      for (const file of EXTENSION_FILES) {
        const res = await fetch(`./extension/${file}`);
        if (!res.ok) throw new Error(`Missing: ${file}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        folder.file(file, buf);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'evan-pcra-automation.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Extension ZIP downloaded. Unzip and load in Chrome.');
    } catch (e) {
      showToast('Download failed: ' + e.message);
    }
  }, [showToast]);

  return (
    <div>
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <div className="brand-logo">E</div>
            <div>
              <div className="brand-name">EvAN PCRA Automation</div>
              <div className="brand-sub">Local Chrome Extension</div>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="badge">Manifest V3</span>
            <button className="btn btn-primary btn-sm" onClick={handleDownloadAll}>
              Download Extension
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <span className="hero-eyebrow">Runs 100% locally in your browser</span>
          <h1>Automate PCRA data entry from Excel into the EvAN intranet app</h1>
          <p className="lead">
            A Chrome Extension that reads your <code>.xlsx</code> file, navigates the PCRA screen for each row,
            updates the Sequence No and Company dropdown, saves, and tracks progress — all inside your own
            browser session with access to your internal network.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={handleDownloadAll}>
              Download Extension (.zip)
            </button>
            <a className="btn btn-ghost" href="#install">Installation guide</a>
          </div>
          <div className="note">
            <span className="note-icon">!</span>
            <span>
              This tool runs entirely on your machine. No data is sent to any cloud service. The extension
              only operates on the intranet tab you have open.
            </span>
          </div>
        </section>

        <section className="section">
          <div className="section-title">How it works</div>
          <div className="steps">
            <Step n="1" title="Upload Excel">
              Load your <code>.xlsx</code> file with columns: SEQ #, New Seq #, and PAN.
            </Step>
            <Step n="2" title="Start automation">
              The tool navigates to each PAN, updates Sequence No and Company, then clicks Save.
            </Step>
            <Step n="3" title="Track progress">
              Watch live progress (Current Row / Total Rows) and adjust delay speed on the fly.
            </Step>
            <Step n="4" title="Export errors">
              Any failed rows are logged and can be downloaded as a CSV error report.
            </Step>
          </div>
        </section>

        <section className="section">
          <div className="grid-2">
            <div className="card">
              <div className="section-title">Input Excel format</div>
              <div className="tbl-wrap">
                <table className="preview">
                  <thead>
                    <tr>
                      <th>SEQ #</th>
                      <th>New Seq #</th>
                      <th>PAN</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>A001</td>
                      <td>A168</td>
                      <td>4315198</td>
                    </tr>
                    <tr>
                      <td>A002</td>
                      <td>A205</td>
                      <td>4315220</td>
                    </tr>
                    <tr>
                      <td>A003</td>
                      <td>A311</td>
                      <td>4315301</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="note">
                <span className="note-icon">i</span>
                <span>
                  The Company dropdown is set automatically based on the owner name shown on the PCRA screen:
                  names containing a comma set it to <b>N</b> (Person); names without a comma set it to <b>Y</b> (Company).
                </span>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Features</div>
              <div className="feat">
                <Feat icon="L" title="Local execution only">
                  Runs in your browser session — reaches internal IPs without any cloud relay.
                </Feat>
                <Feat icon="P" title="Pause / Stop / Resume">
                  Full control to pause, stop, and resume the automation at any point.
                </Feat>
                <Feat icon="S" title="Adjustable speed">
                  Set the delay between steps in milliseconds to match your network speed.
                </Feat>
                <Feat icon="E" title="Error log export">
                  Failed rows are captured and exportable as a downloadable CSV file.
                </Feat>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="install">
          <div className="card">
            <div className="section-title">Installation guide</div>
            <div className="steps">
              <Step n="1" title="Download & unzip">
                Click <b>Download Extension</b> above and unzip the folder.
              </Step>
              <Step n="2" title="Open Chrome extensions">
                Go to <code>chrome://extensions</code> in your browser.
              </Step>
              <Step n="3" title="Enable Developer mode">
                Toggle <b>Developer mode</b> on (top-right corner).
              </Step>
              <Step n="4" title="Load unpacked">
                Click <b>Load unpacked</b> and select the unzipped folder.
              </Step>
            </div>
            <div className="code" style={{ marginTop: 18 }}>
              <span className="cmt"># After loading, pin the extension, then open your EvAN PCRA tab and click the extension icon.</span><br />
              <span className="cmt"># Upload your .xlsx, set the delay, and press Start.</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        EvAN PCRA Automation — Local Chrome Extension (Manifest V3). No cloud, no data leaves your machine.
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
