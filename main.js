const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { scrapeAllRates } = require('./scraper');

let mainWin;
let tray;

app.setName('Rate Widget');

function createWindow() {
  mainWin = new BrowserWindow({
    width: 320,
    height: 620,
    minHeight: 620,
    maxHeight: 720,
    frame: true,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Position bottom-right of primary display
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWin.setPosition(width - 340, height - 580);

  // Hide from dock — pure widget behaviour
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  mainWin.on('closed', () => { mainWin = null; });
}

function createTray() {
  // 16x16 transparent icon fallback (no icon file needed)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('USD/INR Widget');
  const menu = Menu.buildFromTemplate([
    { label: 'Show Widget', click: () => { if (mainWin) mainWin.show(); else createWindow(); } },
    { label: 'Hide Widget', click: () => { if (mainWin) mainWin.hide(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWin) {
      if (mainWin.isVisible()) mainWin.hide();
      else mainWin.show();
    }
  });
}

ipcMain.handle('fetch-rates', async () => {
  try {
    const rates = await scrapeAllRates();
    return { ok: true, rates };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('quit-app', () => app.quit());
ipcMain.on('hide-window', () => { if (mainWin) mainWin.hide(); });

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep app alive in tray even when window is closed
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWin) createWindow();
});