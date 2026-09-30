// Runs a separate Electron process with sample data, no game connection or user database.
const path = require('node:path');
const fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
const screenshotVersion = require(path.join(root, 'package.json')).version;
const screenshotName = (name) => `${name}-v${screenshotVersion}.png`;

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env, TZ: 'UTC' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, session } = require('electron');
  const output = path.join(root, 'docs', 'images');
  app.setPath('userData', path.join(root, '.screenshots-cache'));
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.whenReady().then(async () => {
    await fs.mkdir(output, { recursive: true });
    // The renderer may reference Google Fonts. Captures use its local font fallback.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /^https?:|^wss?:/.test(details.url) });
    });
    const window = new BrowserWindow({ width: 1280, height: 1200, useContentSize: true,
      frame: false, show: false, webPreferences: { preload: path.join(__dirname, 'screenshots', 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    window.webContents.on('console-message', details => {
      if (details.level === 'error' && !details.message.includes('ERR_BLOCKED_BY_CLIENT')) errors.push(details.message);
    });
    await window.loadFile(path.join(root, 'dist', 'index.html'));
    await window.webContents.insertCSS('* { animation: none !important; transition: none !important; }');
    for (const page of ['Dashboard', 'Listings', 'History']) {
      console.log(`Preparing ${page} capture`);
      window.setContentSize(1280, page === 'Dashboard' ? 1200 : 820);
      await window.webContents.executeJavaScript(`
        (() => {
          const button = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === ${JSON.stringify(page)});
          if (!button) throw new Error('Missing navigation: ' + ${JSON.stringify(page)});
          button.click();
        })()
      `).catch(async (error) => {
        const state = await window.webContents.executeJavaScript(`({ title: document.title, body: document.body?.innerText?.slice(0, 500), nav: [...document.querySelectorAll('nav button')].map(b => b.textContent.trim()) })`).catch(() => null);
        console.error('Capture navigation failed:', page, state, errors);
        throw error;
      });
      // Wait for React effects and image decoding, with a bounded render readiness check.
      await window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000;
          const check = () => {
            const heading = document.querySelector('main h1');
            const ready = heading?.textContent === ${JSON.stringify(page)} &&
              [...document.images].every(image => image.complete) &&
              document.querySelector('main').textContent.includes(${JSON.stringify(page === 'Dashboard' ? '187.5M' : page === 'Listings' ? 'Ancient Hy-Brasyl Azoth' : 'Rowan')}) &&
              (${JSON.stringify(page)} !== 'Listings' || document.querySelectorAll('[title="Synced to AislingExchange"]').length === 5);
            if (ready) requestAnimationFrame(() => requestAnimationFrame(resolve));
            else if (Date.now() > deadline) reject(new Error('Capture did not become ready'));
            else setTimeout(check, 50);
          }; check();
        })
      `).catch(async (error) => {
        const state = await window.webContents.executeJavaScript(`({ title: document.title, heading: document.querySelector('main h1')?.textContent, body: document.body?.innerText?.slice(0, 500) })`).catch(() => null);
        console.error('Capture readiness failed:', page, state, errors);
        throw error;
      });
      const brokenImages = await window.webContents.executeJavaScript(`
        [...document.images].filter(image => !image.naturalWidth).map(image => image.getAttribute('src'))
      `);
      if (brokenImages.length) throw new Error(`Broken images: ${brokenImages.join(', ')}`);
      const image = await window.webContents.capturePage();
      await fs.writeFile(path.join(output, screenshotName(page.toLowerCase())), image.toPNG());
      console.log(`Captured ${page}: ${image.getSize().width} × ${image.getSize().height}`);
      if (page === 'Dashboard') {
        await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Custom');
          if (!button) return reject(new Error('Missing custom group mode'));
          button.click();
          requestAnimationFrame(() => {
            const labels = [...document.querySelectorAll('label')].map(label => label.textContent.trim());
            if (labels.some(label => label.includes('Group title')) && labels.some(label => label.includes('Group description'))) resolve();
            else reject(new Error('Custom group fields did not appear'));
          });
        })`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    // Compose a cover around an unmodified UI capture using HTML/CSS.
    const cover = new BrowserWindow({ width: 1600, height: 1200, frame: false, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    cover.setContentSize(1600, 1200);
    const listingImage = (await fs.readFile(path.join(output, screenshotName('listings')))).toString('base64');
    await cover.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <!doctype html><html lang="en"><meta charset="utf-8"><title>DAMerchant</title>
      <style>
        * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; padding: 48px 140px; color: #ebe7dd;
          font-family: 'Segoe UI', sans-serif; background: radial-gradient(ellipse at 85% 0%, #343026 0%, #14151b 46%, #0a0b0f 100%); }
        header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 40px; }
        .eyebrow { color: #d6b45d; font-size: 13px; letter-spacing: 3px; font-weight: 600; margin-bottom: 12px; }
        h1 { font-size: 60px; line-height: 1.1; letter-spacing: -2px; margin: 0 0 12px; font-weight: 650; }
        p { font-size: 21px; color: #a8a7a5; margin: 0; }
        .edition { font-size: 13px; color: #aaa59b; text-align: right; line-height: 1.8; padding-bottom: 3px; }
        .frame { border: 1px solid #4b4432; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px #0008; }
        .bar { height: 34px; display: flex; align-items: center; padding: 0 15px; gap: 7px;
          background: #1c1d24; border-bottom: 1px solid #30303a; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #55515b; }
        .bar span { color: #8e8a80; font-size: 11px; margin-left: 12px; }
        img { display: block; width: 100%; }
        footer { display: flex; justify-content: space-between; margin-top: 22px; color: #878783; font-size: 12px; letter-spacing: 1px; }
      </style><body>
        <header><div><div class="eyebrow">DARK AGES / AISLINGEXCHANGE</div><h1>Set up shop. Step away.</h1>
          <p>Your listings. Your characters. One merchant desk.</p></div>
          <div class="edition">DAMERCHANT<br>Windows desktop companion</div></header>
        <div class="frame"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>DAMerchant — Listings</span></div>
          <img alt="DAMerchant listings" src="data:image/png;base64,${listingImage}"></div>
        <footer><span>SELL · BUY · TRADE</span><span>ACTUAL APP CAPTURE · SAMPLE DATA</span></footer>
      </body></html>`));
    await cover.webContents.executeJavaScript('Promise.all([...document.images].map(image => image.decode()))');
    const overflow = await cover.webContents.executeJavaScript('document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth');
    if (overflow) throw new Error('Documentation cover overflows its canvas');
    await fs.writeFile(path.join(output, screenshotName('cover')), (await cover.webContents.capturePage()).toPNG());
    console.log('Captured documentation cover: 1600 × 1200');
    cover.destroy();
    window.destroy();
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
