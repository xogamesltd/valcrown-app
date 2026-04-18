'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('valcrown', {
  // Window
  minimize:          () => ipcRenderer.send('window-minimize'),
  maximize:          () => ipcRenderer.send('window-maximize'),
  close:             () => ipcRenderer.send('window-close'),
  closeOnboard:      () => ipcRenderer.send('window-close-onboard'),

  // Storage
  store: {
    get:    (key)        => ipcRenderer.invoke('store-get', key),
    set:    (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key)        => ipcRenderer.invoke('store-delete', key),
    clear:  ()           => ipcRenderer.invoke('store-clear'),
  },

  // Auth
  onboardComplete: (data) => ipcRenderer.send('onboard-complete', data),
  logout:          ()     => ipcRenderer.send('logout'),

  // System
  getApiUrl:        () => ipcRenderer.invoke('get-api-url'),
  getVersion:       () => ipcRenderer.invoke('get-version'),
  getSystemInfo:    () => ipcRenderer.invoke('get-system-info'),
  getCpuUsage:      () => ipcRenderer.invoke('get-cpu-usage'),
  getRamUsage:      () => ipcRenderer.invoke('get-ram-usage'),

  // Processes
  getProcesses:     () => ipcRenderer.invoke('get-processes'),
  killProcess:      (pid) => ipcRenderer.invoke('kill-process', pid),
  cleanRam:         () => ipcRenderer.invoke('clean-ram'),

  // Anti-cheat — BOTH names work
  checkAntiCheat:    () => ipcRenderer.invoke('check-anticheat'),
  checkAntiCheatSvc: () => ipcRenderer.invoke('check-anticheat'),

  // Network
  pingHost:         (host) => ipcRenderer.invoke('ping-host', host),
  getPing:          () => ipcRenderer.invoke('ping-host', '8.8.8.8'),
  flushDns:         () => ipcRenderer.invoke('flush-dns'),
  optimizeTcp:      () => ipcRenderer.invoke('optimize-tcp'),
  setDns:           (p, s) => ipcRenderer.invoke('set-dns', p, s),

  // Boost
  applyBoost:       (app, mode) => ipcRenderer.invoke('apply-boost', app, mode),
  revertBoost:      () => ipcRenderer.invoke('revert-boost'),
  boostIsActive:    () => ipcRenderer.invoke('boost-isactive'),

  // Startup
  setStartup:       (e) => ipcRenderer.invoke('set-startup', e),
  getStartup:       () => ipcRenderer.invoke('get-startup'),
  getStartupEnabled:() => ipcRenderer.invoke('get-startup'),

  // Game detection
  getCurrentGame:      () => ipcRenderer.invoke('get-current-game'),
  getSessionHistory:   () => ipcRenderer.invoke('get-session-history'),
  getSteamGames:       () => ipcRenderer.invoke('get-steam-games'),
  checkForUpdates:     () => ipcRenderer.invoke('check-for-updates'),
  onGameDetected:      (cb) => ipcRenderer.on('game-detected', (_, g) => cb(g)),
  onGameEnded:         (cb) => ipcRenderer.on('game-ended',    (_, s) => cb(s)),
  onSessionTick:       (cb) => ipcRenderer.on('session-tick',  (_, t) => cb(t)),

  // App selector
  selectApp:           () => ipcRenderer.invoke('select-app'),

  // Guest mode
  isGuest:             () => ipcRenderer.invoke('is-guest'),

  // Device
  getDeviceVid:        () => ipcRenderer.invoke('get-device-vid'),
  getOsInfo:           () => ipcRenderer.invoke('get-os-info'),

  // Misc
  openExternal:        (url) => ipcRenderer.send('open-external', url),
  notify:              (title, body) => ipcRenderer.send('show-notification', { title, body }),
  updateTray:          (game) => ipcRenderer.send('update-tray', game),
});
