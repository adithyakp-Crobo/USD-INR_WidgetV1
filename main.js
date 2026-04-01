const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { scrapeAllRates } = require('./scraper');

let mainWin;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 320,
    height: 500,
    minHeight: 420,
    maxHeight: 620,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'renderer/index.html'));

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWin.setPosition(width - 340, height - 540);

  if (process.platform === 'darwin') app.dock.hide();
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
