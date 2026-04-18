'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification, dialog, Tray, Menu, nativeImage } = require('electron');
const path   = require('path');
const os     = require('os');
const { exec, execSync } = require('child_process');
const Store  = require('electron-store');
const fs     = require('fs');
const Engine = require('./boostEngine');

// ── OPTIMIZATIONS (from document) ─────────────────────────────────────────────
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const isDev    = process.argv.includes('--dev');
const API_URL  = 'https://api.valcrown.com';
const LOG_FILE = path.join(app.getPath('userData'), 'valcrown.log');

// ── ENCRYPTED STORE ───────────────────────────────────────────────────────────
const store = new Store({
  name: 'valcrown-data',
  encryptionKey: 'vc-secure-xogamesltd-2026'
});

// ── LOGGER ────────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch(e) {}
  if (isDev) console.log(msg);
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let mainWindow    = null;
let onboardWindow = null;
let tray          = null;
let currentGame   = null;
let gameDetectInterval = null;
let boostActive   = false;

// ── ANTI-CHEAT SAFE LIST ──────────────────────────────────────────────────────
const ANTI_CHEAT = new Set([
  'easyanticheat.exe','battleye.exe','be_service.exe','vgc.exe','vanguard.exe',
  'faceitclient.exe','esea.exe','punkbuster.exe','eac_launcher.exe'
]);

const PROTECTED = new Set([
  'system','smss.exe','csrss.exe','wininit.exe','winlogon.exe',
  'services.exe','lsass.exe','svchost.exe','dwm.exe','explorer.exe',
  'taskmgr.exe','valcrown.exe'
]);

// ── GAME DATABASE ─────────────────────────────────────────────────────────────
const GAME_MAP = {
  'valorant.exe':      { name:'Valorant',      icon:'🎯', genre:'FPS' },
  'csgo.exe':          { name:'CS:GO',          icon:'🔫', genre:'FPS' },
  'cs2.exe':           { name:'CS2',            icon:'🔫', genre:'FPS' },
  'fortnite.exe':      { name:'Fortnite',       icon:'🏗️', genre:'Battle Royale' },
  'fortniteclient-win64-shipping.exe': { name:'Fortnite', icon:'🏗️', genre:'Battle Royale' },
  'r5apex.exe':        { name:'Apex Legends',   icon:'🦾', genre:'Battle Royale' },
  'gta5.exe':          { name:'GTA V',          icon:'🚗', genre:'Action' },
  'rdr2.exe':          { name:'RDR2',           icon:'🤠', genre:'Action' },
  'rocketleague.exe':  { name:'Rocket League',  icon:'🚀', genre:'Sports' },
  'overwatch.exe':     { name:'Overwatch 2',    icon:'⚡', genre:'FPS' },
  'overwatch2.exe':    { name:'Overwatch 2',    icon:'⚡', genre:'FPS' },
  'destiny2.exe':      { name:'Destiny 2',      icon:'🌌', genre:'FPS' },
  'eldenring.exe':     { name:'Elden Ring',     icon:'⚔️', genre:'RPG' },
  'cyberpunk2077.exe': { name:'Cyberpunk 2077', icon:'🌆', genre:'RPG' },
  'minecraft.exe':     { name:'Minecraft',      icon:'⛏️', genre:'Sandbox' },
  'javaw.exe':         { name:'Minecraft',      icon:'⛏️', genre:'Sandbox' },
  'leagueclient.exe':  { name:'League of Legends', icon:'⚔️', genre:'MOBA' },
  'league of legends.exe': { name:'League of Legends', icon:'⚔️', genre:'MOBA' },
  'dota2.exe':         { name:'Dota 2',         icon:'🛡️', genre:'MOBA' },
  'pubg.exe':          { name:'PUBG',           icon:'🎯', genre:'Battle Royale' },
  'tslgame.exe':       { name:'PUBG',           icon:'🎯', genre:'Battle Royale' },
  'warzone.exe':       { name:'Warzone',        icon:'🎖️', genre:'Battle Royale' },
  'rainbow6.exe':      { name:'Rainbow Six',    icon:'🔰', genre:'FPS' },
  'thefinals.exe':     { name:'The Finals',     icon:'🏆', genre:'FPS' },
  'geforcenow.exe':    { name:'GeForce NOW',    icon:'☁️', genre:'Cloud Gaming' },
  'shadow.exe':        { name:'Shadow PC',      icon:'👤', genre:'Cloud Gaming' },
};

// ── GAME DETECTION ────────────────────────────────────────────────────────────
function startGameDetection() {
  if (gameDetectInterval) clearInterval(gameDetectInterval);
  let sessionStart = null;

  gameDetectInterval = setInterval(() => {
    if (os.platform() !== 'win32') return;
    exec('tasklist /fo csv /nh 2>nul', { windowsHide: true }, (err, stdout) => {
      if (err) return;
      const procs = stdout.toLowerCase();
      let found = null;
      for (const [proc, game] of Object.entries(GAME_MAP)) {
        if (procs.includes(proc)) { found = game; break; }
      }

      // Custom target
      const targetApp = store.get('targetApp');
      if (!found && targetApp) {
        const tname = targetApp.name.toLowerCase().replace(/ /g,'') + '.exe';
        if (procs.includes(tname)) found = targetApp;
      }

      if (found && !currentGame) {
        currentGame  = found;
        sessionStart = Date.now();
        applyBoost(found.name);
        mainWindow?.webContents.send('game-detected', found);
        updateTray(found);
        showNotif(`${found.name} Detected`, `Boost activated for ${found.name}`);
        log(`[Game] Detected: ${found.name}`);
      } else if (!found && currentGame) {
        const durationMs  = sessionStart ? Date.now() - sessionStart : 0;
        const durationMin = Math.round(durationMs / 60000);
        const session     = { game: currentGame, durationFormatted: durationMin + 'm', durationMin };
        mainWindow?.webContents.send('game-ended', session);
        saveSession(session);
        revertBoost();
        updateTray(null);
        showNotif('Session Ended', `${currentGame.name} — ${durationMin}m`);
        log(`[Game] Ended: ${currentGame.name} — ${durationMin}m`);
        currentGame  = null;
        sessionStart = null;
      }
    });
  }, 8000);
}

function stopGameDetection() {
  if (gameDetectInterval) { clearInterval(gameDetectInterval); gameDetectInterval = null; }
}

// ── SESSION HISTORY ───────────────────────────────────────────────────────────
function saveSession(session) {
  const history = store.get('sessionHistory', []);
  history.unshift({ game: session.game, duration: session.durationFormatted, date: new Date().toLocaleDateString() });
  store.set('sessionHistory', history.slice(0, 20));
}

// ── BOOST ─────────────────────────────────────────────────────────────────────
function applyBoost(gameName, mode = 'safe') {
  if (os.platform() !== 'win32') return;
  boostActive = true;
  const cmds = [
    'powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
    'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f',
    'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f',
    'netsh int tcp set global autotuninglevel=normal',
    'netsh int tcp set global rss=enabled',
  ];
  if (gameName) cmds.push(`wmic process where name="${gameName}.exe" CALL setpriority "high priority"`);
  if (mode === 'aggressive') {
    cmds.push('sc stop SysMain', 'sc stop WSearch');
    cmds.push('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f');
    cmds.push('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f');
  }
  exec(cmds.join(' & '), { windowsHide: true }, (err) => {
    if (err) log('[Boost] Error: ' + err.message);
    else log('[Boost] Applied: ' + mode);
  });
}

function revertBoost() {
  if (os.platform() !== 'win32') return;
  boostActive = false;
  exec([
    'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e',
    'sc start SysMain',
  ].join(' & '), { windowsHide: true });
  log('[Boost] Reverted');
}

// ── TRAY ──────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('ValCrown');
  updateTray(null);
  tray.on('click', () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    else createMainWindow();
  });
}

function updateTray(game) {
  if (!tray) return;
  const items = [
    { label: game ? `🎮 Boosting ${game.name}` : 'ValCrown — Idle', enabled: false },
    { type: 'separator' },
    { label: 'Open ValCrown', click: () => { mainWindow?.show() || createMainWindow(); } },
    { label: 'Quit', click: () => app.quit() }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(game ? `ValCrown — Boosting ${game.name}` : 'ValCrown');
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
function showNotif(title, body) {
  try { new Notification({ title: `ValCrown — ${title}`, body }).show(); } catch(e) {}
}

// ── WINDOWS ───────────────────────────────────────────────────────────────────
function createOnboardWindow() {
  onboardWindow = new BrowserWindow({
    width: 520, height: 680,
    frame: false, resizable: false,
    backgroundColor: '#080808',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    center: true, show: false,
  });
  onboardWindow.loadFile(path.join(__dirname, '../renderer/src/onboard.html'));
  onboardWindow.once('ready-to-show', () => onboardWindow.show());
  onboardWindow.on('closed', () => { onboardWindow = null; });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 720,
    minWidth: 900, minHeight: 600,
    frame: false,
    backgroundColor: '#080808',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
    center: true, show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/src/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
    if (currentGame) mainWindow.webContents.send('game-detected', currentGame);
    log('[App] Main window ready');
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── APP READY ─────────────────────────────────────────────────────────────────

ipcMain.handle('get-device-vid', async () => {
  return getMachineId();
});

ipcMain.handle('get-os-info', async () => {
  return {
    platform: os.platform(),
    release:  os.release(),
    arch:     os.arch(),
    hostname: os.hostname(),
  };
});
app.whenReady().then(() => {
  log('[App] Starting ValCrown');
  createTray();

  const token = store.get('accessToken');
  if (!token || token === '') {
    createOnboardWindow();
  } else {
    createMainWindow();
    startGameDetection();
  }
});

app.on('window-all-closed', () => { /* stay in tray */ });

app.on('before-quit', () => {
  stopGameDetection();
  if (boostActive) revertBoost();
  log('[App] Quitting');
});

// ── IPC HANDLERS ──────────────────────────────────────────────────────────────

// Window controls

function getMachineId() {
  const crypto = require('crypto');
  const parts  = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'cpu',
    String(os.totalmem()),
    os.userInfo().username || 'user',
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32).toUpperCase();
}
ipcMain.on('window-minimize',      () => (mainWindow || onboardWindow)?.minimize());
ipcMain.on('window-maximize',      () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close',         () => (mainWindow || onboardWindow)?.hide());
ipcMain.on('window-close-onboard', () => onboardWindow?.close());

// Storage
ipcMain.handle('store-get',    (_, key)        => store.get(key));
ipcMain.handle('store-set',    (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('store-delete', (_, key)        => { store.delete(key); return true; });
ipcMain.handle('store-clear',  ()              => { store.clear(); return true; });

// Auth
ipcMain.on('onboard-complete', (_, data) => {
  store.set('accessToken',  data.accessToken);
  store.set('refreshToken', data.refreshToken);
  store.set('user',         data.user);
  store.set('license',      data.license);
  createMainWindow();
  startGameDetection();
  setTimeout(() => onboardWindow?.close(), 300);
  log('[Auth] Login complete');
});

ipcMain.on('logout', () => {
  stopGameDetection();
  if (boostActive) revertBoost();
  store.clear();
  updateTray(null);
  createOnboardWindow();
  setTimeout(() => { mainWindow?.destroy(); mainWindow = null; }, 400);
  log('[Auth] Logout');
});

// System info
ipcMain.handle('get-system-info', async () => {
  return Engine.getSystemInfo();
});

// CPU/RAM
ipcMain.handle('get-cpu-usage', async () => {
  return Engine.getCpuUsage();
});

ipcMain.handle('get-ram-usage', () => {
  const total = os.totalmem();
  const free  = os.freemem();
  return { usedPct: Math.round(((total - free) / total) * 100), totalGb: Math.round(total/1073741824), freeGb: Math.round(free/1073741824), usedGb: Math.round((total-free)/1073741824) };
});

// Processes
ipcMain.handle('get-processes', async () => {
  return Engine.getProcesses();
});

ipcMain.handle('kill-process', (_, pid) => new Promise((resolve) => {
  if (pid <= 4) { resolve({ success: false, reason: 'System process' }); return; }
  exec(`taskkill /PID ${pid} /F`, { windowsHide: true }, (err) => {
    resolve({ success: !err, reason: err?.message });
  });
}));

ipcMain.handle('clean-ram', () => new Promise((resolve) => {
  exec('wmic process get WorkingSetSize 2>nul', { windowsHide: true }, () => {});
  resolve({ success: true });
}));

// Anti-cheat check
ipcMain.handle('check-anticheat', async () => {
  return Engine.checkAntiCheat();
});

// Network
ipcMain.handle('ping-host', (_, host = '8.8.8.8') => new Promise((resolve) => {
  const start = Date.now();
  exec(`ping -n 1 ${host}`, { windowsHide: true }, (err, stdout) => {
    if (err) { resolve({ ms: 999, host, success: false }); return; }
    const match = stdout.match(/time[<=](\d+\.?\d*)\s*ms/i) || stdout.match(/(\d+\.?\d*)\s*ms/);
    resolve({ ms: match ? Math.round(parseFloat(match[1])) : Date.now()-start, host, success: true });
  });
}));

ipcMain.handle('flush-dns', async () => {
  const r = await Engine.flushDns();
  log('[Net] DNS flushed: ' + r.steps.filter(s=>s.ok).map(s=>s.label).join(', '));
  return r;
});

ipcMain.handle('optimize-tcp', async () => {
  const r = await Engine.optimizeNetwork();
  log('[Net] TCP optimized: ' + (r.applied||[]).join(', '));
  return r;
});

ipcMain.handle('set-dns', (_, primary, secondary) => new Promise((resolve) => {
  exec(`netsh interface ip set dns "Ethernet" static ${primary} && netsh interface ip add dns "Ethernet" ${secondary} index=2`, { windowsHide: true }, (err) => {
    resolve({ success: !err });
  });
}));

// Boost
ipcMain.handle('apply-boost', async (_, targetName, mode) => {
  const m = mode || 'safe';
  const result = await Engine.apply(targetName, m);
  boostActive = result.success;
  log('[Engine] Boost: ' + (result.applied||[]).join(', '));
  return result;
});

ipcMain.handle('revert-boost', async () => {
  const result = await Engine.revert();
  boostActive = false;
  log('[Engine] Boost reverted');
  return result;
});

ipcMain.handle('boost-isactive', () => boostActive);

// Startup
ipcMain.handle('set-startup', (_, enabled) => {
  const r = Engine.setStartup(enabled);
  if (r.success) store.set('startupEnabled', enabled);
  return r;
});

ipcMain.handle('get-startup', () => Engine.getStartupEnabled());

// Game
ipcMain.handle('get-current-game',   () => currentGame);
ipcMain.handle('get-session-history',() => store.get('sessionHistory', []));

// App selector
ipcMain.handle('select-app', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select game or app',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['exe'] }],
  });
  if (!result.canceled && result.filePaths[0]) {
    const p = result.filePaths[0];
    return { path: p, name: path.basename(p, '.exe'), icon: '🎮' };
  }
  return null;
});

// Misc
// Guest mode check
ipcMain.handle('is-guest', () => store.get('accessToken') === 'GUEST');

ipcMain.handle('get-api-url',        () => API_URL);
ipcMain.handle('get-version',        () => app.getVersion());
ipcMain.on('open-external',          (_, url) => shell.openExternal(url));
ipcMain.on('show-notification',      (_, { title, body }) => showNotif(title, body));
ipcMain.on('update-tray',            (_, game) => updateTray(game));
