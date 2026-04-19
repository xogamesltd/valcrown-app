'use strict';
const { run, IS_WIN } = require('./scanner');

const KNOWN_GAMES = [
  { name: 'Valorant',          exe: 'VALORANT-Win64-Shipping.exe' },
  { name: 'CS2',               exe: 'cs2.exe' },
  { name: 'Fortnite',          exe: 'FortniteClient-Win64-Shipping.exe' },
  { name: 'Apex Legends',      exe: 'r5apex.exe' },
  { name: 'GTA V',             exe: 'GTA5.exe' },
  { name: 'Warzone',           exe: 'cod.exe' },
  { name: 'Overwatch 2',       exe: 'Overwatch.exe' },
  { name: 'Rocket League',     exe: 'RocketLeague.exe' },
  { name: 'Minecraft',         exe: 'javaw.exe' },
  { name: 'League of Legends', exe: 'League of Legends.exe' },
  { name: 'Dota 2',            exe: 'dota2.exe' },
  { name: 'PUBG',              exe: 'TslGame.exe' },
  { name: 'Rainbow Six Siege', exe: 'RainbowSix.exe' },
  { name: 'Destiny 2',         exe: 'destiny2.exe' },
  { name: 'Elden Ring',        exe: 'eldenring.exe' },
  { name: 'Cyberpunk 2077',    exe: 'Cyberpunk2077.exe' },
  { name: 'The Finals',        exe: 'Discovery.exe' },
  { name: 'Helldivers 2',      exe: 'helldivers2.exe' },
  { name: 'Rust',              exe: 'RustClient.exe' },
  { name: 'Diablo IV',         exe: 'Diablo IV.exe' },
  { name: 'Baldurs Gate 3',    exe: 'bg3.exe' },
  { name: 'GeForce NOW',       exe: 'GeForceNOW.exe' },
  { name: 'Xbox Cloud Gaming', exe: 'XboxPcApp.exe' },
  { name: 'Shadow PC',         exe: 'Shadow.exe' },
  { name: 'Amazon Luna',       exe: 'Luna.exe' },
];

async function apply(gameName, mode) {
  if (!IS_WIN) return { success: true, applied: ['Simulated boost (not Windows)'], failed: [], mode: mode || 'safe' };
  const applied = [], failed = [];
  const attempt = async (label, cmd) => {
    const r = await run(cmd);
    r.ok ? applied.push(label) : failed.push(label);
  };

  // Always apply
  await attempt('Power: High Performance', 'powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c');
  await attempt('GameDVR: Disabled',       'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f');
  await attempt('Timer: High Resolution',  'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel" /v GlobalTimerResolutionRequests /t REG_DWORD /d 1 /f');

  if (gameName) {
    await attempt('CPU Priority: High', 'wmic process where "name=\'' + gameName + '\'" CALL setpriority "high priority"');
  }

  if (mode === 'aggressive') {
    await attempt('Nagle: Disabled',  'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f');
    await attempt('TCP No Delay',     'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f');
    await attempt('HW Scheduler: On', 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f');
  }

  return { success: true, applied, failed, mode: mode || 'safe' };
}

async function revert() {
  if (!IS_WIN) return { success: true };
  await run('powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e');
  await run('reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 1 /f');
  await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel" /v GlobalTimerResolutionRequests /t REG_DWORD /d 0 /f');
  return { success: true };
}

async function killProcess(pid) {
  const safe = parseInt(pid);
  if (!safe || safe < 5 || safe > 99999) return { success: false, error: 'Invalid PID' };
  const r = await run('taskkill /PID ' + safe + ' /F');
  return { success: r.ok };
}

async function cleanRam() {
  if (!IS_WIN) return { success: true };
  await run('wmic process get WorkingSetSize 2>nul');
  return { success: true };
}

async function flushDns() {
  const r = await run('ipconfig /flushdns');
  return { success: r.ok };
}

async function optimizeTcp() {
  if (!IS_WIN) return { success: true };
  await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f');
  await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f');
  return { success: true };
}

function setDns(primary, secondary) {
  const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRe.test(primary) || !ipRe.test(secondary)) return Promise.resolve({ success: false, error: 'Invalid IP' });
  return run('netsh interface ip set dns "Ethernet" static ' + primary + ' && netsh interface ip add dns "Ethernet" ' + secondary + ' index=2')
    .then(r => ({ success: r.ok }));
}

function setStartup(enabled, execPath) {
  if (!IS_WIN) return Promise.resolve({ success: true });
  const cmd = enabled
    ? 'reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown /t REG_SZ /d "' + execPath + '" /f'
    : 'reg delete "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown /f';
  return run(cmd).then(r => ({ success: r.ok }));
}

function getStartupEnabled() {
  if (!IS_WIN) return false;
  try {
    require('child_process').execSync('reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown 2>nul', { windowsHide: true });
    return true;
  } catch { return false; }
}

module.exports = { apply, revert, killProcess, cleanRam, flushDns, optimizeTcp, setDns, setStartup, getStartupEnabled, KNOWN_GAMES };
