'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification, dialog } = require('electron');
const path      = require('path');
const os        = require('os');
const https     = require('https');
const Store     = require('electron-store');
const Scanner   = require('../engines/scanner');
const Optimizer = require('../engines/optimizer');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const IS_DEV  = process.argv.includes('--dev');
const API     = 'https://api.valcrown.com';
const VER     = app.getVersion();

// ── STORE ─────────────────────────────────────────────────────────────────────
const store = new Store({ name: 'valcrown', encryptionKey: process.env.VC_KEY || 'vc-xogamesltd-2026' });

// ── STATE ─────────────────────────────────────────────────────────────────────
let mainWin   = null;
let obWin     = null;
let tray      = null;
let boosted   = false;
let curGame   = null;
let sessStart = null;
let sessTick  = null;
let watchLoop = null;

// ── LOG ───────────────────────────────────────────────────────────────────────
const log = (m) => console.log('[' + new Date().toISOString().substr(11,8) + '] ' + m);

// ── WINDOWS ───────────────────────────────────────────────────────────────────
function createOnboard() {
  obWin = new BrowserWindow({
    width: 420, height: 580, resizable: false, frame: false,
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false },
    show: false,
  });
  obWin.loadFile(path.join(__dirname,'../renderer/src/onboard.html'));
  obWin.once('ready-to-show', () => obWin.show());
  obWin.on('closed', () => { obWin = null; });
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1020, height: 680, minWidth: 820, minHeight: 560, frame: false,
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false },
    show: false,
  });
  mainWin.loadFile(path.join(__dirname,'../renderer/src/index.html'));
  if (IS_DEV) mainWin.webContents.openDevTools({ mode: 'detach' });
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    initTray();
    startWatch();
    versionCheck();
  });
  mainWin.on('close', (e) => { e.preventDefault(); mainWin.hide(); });
  mainWin.on('closed', () => { mainWin = null; });
}

// ── TRAY ──────────────────────────────────────────────────────────────────────
function initTray() {
  try {
    const iconPath = path.join(__dirname,'../renderer/src/assets/icon.png');
    const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.on('click', () => { if(mainWin){ mainWin.show(); mainWin.focus(); } });
    setTray(null);
  } catch(e) { log('[Tray] ' + e.message); }
}

function setTray(game) {
  if (!tray) return;
  tray.setToolTip(game ? 'ValCrown — Boosting ' + game.name : 'ValCrown');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: game ? '⚡ ' + game.name : '🎮 No game running', enabled: false },
    { type: 'separator' },
    { label: 'Open',  click: () => { if(mainWin){ mainWin.show(); mainWin.focus(); } } },
    { label: 'Quit',  click: () => app.exit(0) },
  ]));
}

// ── GAME WATCHER ──────────────────────────────────────────────────────────────
function startWatch() {
  watchLoop = setInterval(async () => {
    const procs = await Scanner.getProcesses();
    const names = procs.map(p => p.name.toLowerCase());
    const found = Optimizer.KNOWN_GAMES.find(g => names.includes(g.exe.toLowerCase()));

    if (found && (!curGame || curGame.exe !== found.exe)) {
      curGame   = found;
      sessStart = Date.now();
      if (!boosted) {
        const r = await Optimizer.apply(found.exe, store.get('boostMode','safe'));
        boosted = r.success;
      }
      if (mainWin) mainWin.webContents.send('ev-game', found);
      setTray(found);
      startTick();
      log('[Watch] Game: ' + found.name);
    } else if (!found && curGame) {
      const dur = sessStart ? Math.floor((Date.now()-sessStart)/1000) : 0;
      const sess = { game: curGame.name, duration: dur, date: new Date().toISOString() };
      const hist = store.get('sessions', []);
      hist.unshift(sess);
      store.set('sessions', hist.slice(0, 30));
      if (mainWin) mainWin.webContents.send('ev-end', sess);
      await Optimizer.revert();
      boosted   = false;
      curGame   = null;
      sessStart = null;
      setTray(null);
      stopTick();
      log('[Watch] Game ended (' + dur + 's)');
    }
  }, 3000);
}

function startTick() {
  stopTick();
  sessTick = setInterval(() => {
    if (!sessStart || !mainWin) return;
    mainWin.webContents.send('ev-tick', Math.floor((Date.now()-sessStart)/1000));
  }, 1000);
}

function stopTick() {
  if (sessTick) { clearInterval(sessTick); sessTick = null; }
}

// ── VERSION CHECK ─────────────────────────────────────────────────────────────
function versionCheck() {
  https.get(API + '/api/app/version', { headers: { 'User-Agent': 'ValCrown/' + VER } }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const latest = JSON.parse(d).version || VER;
        const parse  = v => v.replace(/^v/,'').split('.').map(Number);
        const [lM,lN,lP] = parse(latest);
        const [cM,cN,cP] = parse(VER);
        const old = lM>cM||(lM===cM&&lN>cN)||(lM===cM&&lN===cN&&lP>cP);
        if (old && mainWin) mainWin.webContents.send('ev-update', { latest });
      } catch {}
    });
  }).on('error', () => {});
}

// ── APP LIFECYCLE ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const token = store.get('accessToken');
  if (token) createMain(); else createOnboard();
});
app.on('window-all-closed', () => {});
app.on('before-quit', async () => {
  if (watchLoop) clearInterval(watchLoop);
  stopTick();
  if (boosted) await Optimizer.revert();
});

// ── IPC ───────────────────────────────────────────────────────────────────────
// Window
ipcMain.on('win-min',   () => (mainWin||obWin)?.minimize());
ipcMain.on('win-max',   () => { if(mainWin) mainWin.isMaximized()?mainWin.unmaximize():mainWin.maximize(); });
ipcMain.on('win-hide',  () => (mainWin||obWin)?.hide());
ipcMain.on('ob-close',  () => obWin?.close());

// Store — whitelist only
const KEYS = ['accessToken','refreshToken','user','license','targetApp','sessions',
  'boostMode','startupEnabled','deviceId','userEmail','settings'];
ipcMain.handle('s-get',   (_, k)   => store.get(k));
ipcMain.handle('s-set',   (_, k,v) => { if(!KEYS.includes(k)) return false; store.set(k,v); return true; });
ipcMain.handle('s-clear', ()       => { store.clear(); return true; });

// Auth
ipcMain.on('auth-login', (_, d) => {
  store.set('accessToken',  d.accessToken);
  store.set('refreshToken', d.refreshToken);
  store.set('user',         JSON.stringify(d.user||{}));
  store.set('license',      JSON.stringify(d.license||{}));
  obWin?.close();
  createMain();
});
ipcMain.on('auth-logout', () => {
  store.clear();
  if (mainWin) { mainWin.destroy(); mainWin = null; }
  createOnboard();
});

// System
ipcMain.handle('sys-info',    () => Scanner.getSystemInfo());
ipcMain.handle('cpu-usage',   () => Scanner.getCpuUsage());
ipcMain.handle('ram-usage',   () => Scanner.getRamUsage());
ipcMain.handle('app-version', () => VER);
ipcMain.handle('get-procs',   () => Scanner.getProcesses());
ipcMain.handle('kill-proc',   (_, p) => Optimizer.killProcess(p));
ipcMain.handle('clean-ram',   () => Optimizer.cleanRam());
ipcMain.handle('ac-check',    () => Scanner.checkAntiCheat());
ipcMain.handle('ping',        (_, h) => Scanner.ping(h));
ipcMain.handle('flush-dns',   () => Optimizer.flushDns());
ipcMain.handle('tcp-opt',     () => Optimizer.optimizeTcp());
ipcMain.handle('set-dns',     (_, p,s) => Optimizer.setDns(p, s));
ipcMain.handle('boost',       (_, n,m) => { return Optimizer.apply(n,m).then(r => { if(r.success) boosted=true; return r; }); });
ipcMain.handle('revert',      () => Optimizer.revert().then(r => { boosted=false; return r; }));
ipcMain.handle('boost-active',() => boosted);
ipcMain.handle('set-startup', (_, e) => Optimizer.setStartup(e, process.execPath).then(r => { if(r.ok) store.set('startupEnabled',e); return r; }));
ipcMain.handle('get-startup', () => Optimizer.getStartupEnabled());
ipcMain.handle('current-game',() => curGame);
ipcMain.handle('sessions',    () => store.get('sessions', []));
ipcMain.handle('steam-games', () => Scanner.getSteamGames());
ipcMain.handle('is-guest',    () => !store.get('accessToken'));
ipcMain.handle('pick-app',    async () => {
  if (!mainWin) return null;
  const r = await dialog.showOpenDialog(mainWin, { properties:['openFile'], filters:[{name:'Apps',extensions:['exe']}] });
  return r.canceled ? null : { path: r.filePaths[0], name: require('path').basename(r.filePaths[0]) };
});

ipcMain.on('open-url', (_, u) => {
  try { const p = new URL(u); if(['https:','http:','mailto:'].includes(p.protocol)) shell.openExternal(u); } catch {}
});
ipcMain.on('notify', (_, t, b) => {
  if (Notification.isSupported()) new Notification({ title: String(t||'').slice(0,100), body: String(b||'').slice(0,200) }).show();
});
