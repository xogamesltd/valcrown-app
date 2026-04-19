'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vc', {
  // Window controls
  minimize:     () => ipcRenderer.send('win-min'),
  maximize:     () => ipcRenderer.send('win-max'),
  hide:         () => ipcRenderer.send('win-hide'),
  closeOnboard: () => ipcRenderer.send('ob-close'),

  // Store
  store: {
    get:    (k)   => ipcRenderer.invoke('s-get', k),
    set:    (k,v) => ipcRenderer.invoke('s-set', k, v),
    clear:  ()    => ipcRenderer.invoke('s-clear'),
  },

  // Auth
  login:  (d) => ipcRenderer.send('auth-login', d),
  logout: ()  => ipcRenderer.send('auth-logout'),

  // System info
  sysInfo:  () => ipcRenderer.invoke('sys-info'),
  cpuUsage: () => ipcRenderer.invoke('cpu-usage'),
  ramUsage: () => ipcRenderer.invoke('ram-usage'),
  version:  () => ipcRenderer.invoke('app-version'),

  // Processes
  getProcs:   () => ipcRenderer.invoke('get-procs'),
  killProc:   (p) => ipcRenderer.invoke('kill-proc', p),
  cleanRam:   () => ipcRenderer.invoke('clean-ram'),

  // Boost engine
  boost:       (n, m) => ipcRenderer.invoke('boost', n, m),
  revert:      () => ipcRenderer.invoke('revert'),
  boostActive: () => ipcRenderer.invoke('boost-active'),

  // Network engine
  ping:        (h) => ipcRenderer.invoke('ping', h),
  flushDns:    () => ipcRenderer.invoke('flush-dns'),
  tcpOpt:      () => ipcRenderer.invoke('tcp-opt'),
  setDns:      (p,s) => ipcRenderer.invoke('set-dns', p, s),

  // Anti-cheat
  acCheck: () => ipcRenderer.invoke('ac-check'),

  // Startup
  setStartup: (e) => ipcRenderer.invoke('set-startup', e),
  getStartup: () => ipcRenderer.invoke('get-startup'),

  // Games
  currentGame:  () => ipcRenderer.invoke('current-game'),
  sessions:     () => ipcRenderer.invoke('sessions'),
  steamGames:   () => ipcRenderer.invoke('steam-games'),
  pickApp:      () => ipcRenderer.invoke('pick-app'),

  // Events from main
  onGame:    (cb) => ipcRenderer.on('ev-game',    (_, d) => cb(d)),
  onEnd:     (cb) => ipcRenderer.on('ev-end',     (_, d) => cb(d)),
  onTick:    (cb) => ipcRenderer.on('ev-tick',    (_, d) => cb(d)),
  onUpdate:  (cb) => ipcRenderer.on('ev-update',  (_, d) => cb(d)),

  // Misc
  isGuest:    () => ipcRenderer.invoke('is-guest'),
  openUrl:    (u) => ipcRenderer.send('open-url', u),
  notify:     (t,b) => ipcRenderer.send('notify', t, b),
});
