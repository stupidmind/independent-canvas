const { app, BrowserWindow, Menu, shell, dialog, globalShortcut } = require('electron');
const { join } = require('node:path');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

const config = JSON.parse(readFileSync(join(__dirname, 'desktop-config.json'), 'utf8'));
app.setName('独立画布');
const profile = config.portable
  ? join(app.getPath('appData'), 'Independent Canvas')
  : join(config.projectRoot, '.desktop-profile');
const data = config.portable ? join(profile, 'data') : join(config.projectRoot, 'data');
mkdirSync(profile, { recursive: true, mode: 0o700 });
app.setPath('userData', profile);

let window, serverModule, quitting = false, baseURL;
let settings = {};
try {
  settings = JSON.parse(readFileSync(join(data, 'desktop-settings.json'), 'utf8'));
} catch {}

function persist() {
  mkdirSync(data, { recursive: true, mode: 0o700 });
  writeFileSync(join(data, 'desktop-settings.json'), JSON.stringify(settings), { mode: 0o600 });
}

function legacyHealth() {
  return new Promise(resolve => {
    const request = http.get('http://127.0.0.1:4317/api/health', response => {
      let value = '';
      response.on('data', chunk => { value += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(value)); } catch { resolve(null); }
      });
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

async function ensureServer() {
  if (!config.portable && (await legacyHealth())?.version >= 3) {
    baseURL = 'http://127.0.0.1:4317';
    return;
  }
  process.env.PLAYGROUND_DATA_DIR = data;
  process.env.PORT = config.portable ? '0' : '4317';
  if (config.portable) {
    process.env.PYTHON_BIN = join(process.resourcesPath, 'python', 'bin', 'python3.12');
    process.env.PYTHONNOUSERSITE = '1';
    process.env.PYTHONDONTWRITEBYTECODE = '1';
    delete process.env.PYTHONHOME;
    delete process.env.PYTHONPATH;
    if (!existsSync(process.env.PYTHON_BIN)) throw Error('应用内的文件处理组件缺失，请重新解压。');
  }
  serverModule = await import(pathToFileURL(join(__dirname, 'server.mjs')));
  baseURL = await serverModule.applicationReady;
}

function show() {
  if (!baseURL || quitting) return;
  if (!window || window.isDestroyed()) return createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function shortcut(enabled) {
  globalShortcut.unregister('CommandOrControl+Shift+Space');
  if (enabled && !globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (window?.isVisible() && window.isFocused()) window.hide();
    else show();
  })) {
    settings.shortcut = false;
    dialog.showErrorBox('快捷键已占用', '此快捷键未启用。');
  } else {
    settings.shortcut = enabled;
  }
  persist();
}

function isCanvasURL(url) {
  try { return new URL(url).origin === baseURL; } catch { return false; }
}

function openExternal(url) {
  try {
    if (['http:', 'https:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {}
}

function createWindow() {
  window = new BrowserWindow({
    width: Math.max(760, settings.bounds?.width || 1240),
    height: Math.max(600, settings.bounds?.height || 840),
    ...(Number.isFinite(settings.bounds?.x) ? { x: settings.bounds.x, y: settings.bounds.y } : {}),
    minWidth: 680,
    minHeight: 500,
    title: '独立画布',
    backgroundColor: '#f5f5f4',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
      spellcheck: false
    }
  });
  window.loadURL(baseURL + '/');
  window.once('ready-to-show', () => window?.show());
  let timer;
  const remember = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window && !window.isDestroyed()) {
        settings.bounds = window.getBounds();
        persist();
      }
    }, 350);
  };
  window.on('resize', remember);
  window.on('move', remember);
  window.on('closed', () => { window = null; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isCanvasURL(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (contents !== window?.webContents || !isCanvasURL(contents.getURL())
      || (details?.requestingUrl && !isCanvasURL(details.requestingUrl)) || permission !== 'media') {
      return callback(false);
    }
    dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['允许麦克风', '取消'],
      defaultId: 1,
      cancelId: 1,
      message: '允许独立画布使用麦克风？',
      detail: '录音在你点击开始后采集，点击停止并转写时发给所选服务。'
    }).then(result => callback(result.response === 0), () => callback(false));
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.whenReady().then(async () => {
    await ensureServer();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [
        { role: 'about' },
        { label: '全局唤出快捷键 ⌘⇧Space', type: 'checkbox', checked: !!settings.shortcut,
          click: item => shortcut(item.checked) },
        { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { role: 'quit' }
      ] },
      { label: '文件', submenu: [
        { label: '新建画布', accelerator: 'CommandOrControl+N',
          click: () => { show(); window?.webContents.send('canvas:new'); } },
        { label: '打开本地保存目录', click: () => { mkdirSync(data, { recursive: true }); shell.openPath(data); } },
        { label: '导出完整备份', click: () => { show(); window?.webContents.downloadURL(baseURL + '/api/backup/export'); } },
        { type: 'separator' }, { role: 'close' }
      ] },
      { label: '编辑', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' },
        { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ] },
      { label: '显示', submenu: [
        { role: 'reload' }, { role: 'togglefullscreen' },
        { label: '回到画布全景', accelerator: 'CommandOrControl+1',
          click: () => window?.webContents.send('canvas:fit') }
      ] },
      { role: 'windowMenu' }
    ]));
    createWindow();
    if (settings.shortcut) shortcut(true);
  }).catch(error => {
    dialog.showErrorBox('独立画布无法启动', error.message);
    app.quit();
  });
  app.on('before-quit', event => {
    globalShortcut.unregisterAll();
    if (!serverModule || quitting) return;
    event.preventDefault();
    quitting = true;
    serverModule.closeApplication().finally(() => app.quit());
  });
}
