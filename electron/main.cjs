// Windows/desktop shell: serves the web app from an app:// origin so IndexedDB
// storage is persistent and isolated, like a normal installed app. Newer web
// bundles downloaded over the air live in userData/web and take precedence.
const { app, BrowserWindow, protocol, net, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { unzipSync } = require('fflate');

const BUNDLED = path.join(__dirname, '..', 'dist');
const UPDATES_URL = 'https://github.com/kla1mmor/chat-archive/releases/download/latest/';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function buildOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).build || 0;
  } catch {
    return -1;
  }
}

/** The newest usable web bundle: downloaded update or the one shipped with the app. */
function webRoot() {
  const updatesDir = path.join(app.getPath('userData'), 'web');
  let best = BUNDLED;
  let bestBuild = buildOf(BUNDLED);
  if (fs.existsSync(updatesDir)) {
    for (const name of fs.readdirSync(updatesDir)) {
      const dir = path.join(updatesDir, name);
      const b = buildOf(dir);
      if (b > bestBuild && fs.existsSync(path.join(dir, 'index.html'))) {
        best = dir;
        bestBuild = b;
      }
    }
  }
  return best;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    title: 'Архив чатов',
    icon: path.join(BUNDLED, 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Links from messages open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:|^tel:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://archive/index.html');
}

ipcMain.handle('update:get-text', async (_e, url) => {
  if (!String(url).startsWith(UPDATES_URL)) throw new Error('URL not allowed');
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
});

ipcMain.handle('update:install', async (_e, url, build) => {
  if (!String(url).startsWith(UPDATES_URL)) throw new Error('URL not allowed');
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  if (!files['index.html']) throw new Error('Bundle has no index.html');

  const updatesDir = path.join(app.getPath('userData'), 'web');
  const target = path.join(updatesDir, String(Number(build)));
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const out = path.normalize(path.join(tmp, name));
    if (!out.startsWith(tmp + path.sep)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  // Keep only the newest downloaded bundle.
  for (const name of fs.readdirSync(updatesDir)) {
    if (name !== String(Number(build))) fs.rmSync(path.join(updatesDir, name), { recursive: true, force: true });
  }
});

ipcMain.on('update:restart', () => {
  app.relaunch();
  app.exit(0);
});

app.whenReady().then(() => {
  const root = webRoot();
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
