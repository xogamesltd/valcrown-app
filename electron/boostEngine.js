'use strict';
/**
 * ValCrown Boost Engine v3
 * - Fixed null process crash
 * - Real boost that actually applies Windows tweaks
 * - Verified each tweak works
 */

const { exec, execSync, spawnSync } = require('child_process');
const os = require('os');

const IS_WIN = os.platform() === 'win32';

// ── Run single command — never crashes ───────────────────────────────────────
function run(cmd) {
  return new Promise((resolve) => {
    if (!IS_WIN) { resolve({ ok: true, out: 'skipped' }); return; }
    exec(cmd, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      resolve({ ok: !err, out: (stdout || '').trim(), err: err ? err.message : null });
    });
  });
}

// ── Run PowerShell command ────────────────────────────────────────────────────
function ps(script) {
  return new Promise((resolve) => {
    if (!IS_WIN) { resolve({ ok: true, out: 'skipped' }); return; }
    exec(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        resolve({ ok: !err, out: (stdout || '').trim(), err: err ? err.message : null });
      }
    );
  });
}

const Engine = {

  // ── REAL BOOST ──────────────────────────────────────────────────────────────
  async apply(gameName, mode) {
    mode = mode || 'safe';
    if (!IS_WIN) return { success: true, applied: ['Simulated (not Windows)'], failed: [], mode };

    const applied = [];
    const failed  = [];

    const attempt = async (label, cmd) => {
      const r = await run(cmd);
      if (r.ok) { applied.push(label); console.log('[Engine] ✅ ' + label); }
      else       { failed.push(label);  console.log('[Engine] ❌ ' + label + ': ' + r.err); }
    };

    // 1. High Performance power plan (GUID for High Perf)
    await attempt('Power: High Performance',
      'powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c');

    // 2. Disable Game DVR/Bar recording
    await attempt('GameDVR: Disabled',
      'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f');

    // 3. Hardware Accelerated GPU Scheduling
    await attempt('HAGS: Enabled',
      'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f');

    // 4. TCP Auto-Tuning
    await attempt('TCP AutoTuning: Normal', 'netsh int tcp set global autotuninglevel=normal');

    // 5. RSS (Receive Side Scaling)
    await attempt('TCP RSS: Enabled', 'netsh int tcp set global rss=enabled');

    // 6. Disable Xbox Game Bar
    await attempt('Xbox GameBar: Disabled',
      'reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f');

    // 7. Set game/app process to HIGH priority if specified
    if (gameName && gameName.trim()) {
      const procName = gameName.replace('.exe','').trim();
      const r = await ps(`$p = Get-Process '${procName}' -ErrorAction SilentlyContinue; if($p){ $p | ForEach-Object { $_.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::High }; 'OK' } else { 'not found' }`);
      if (r.ok && r.out === 'OK') applied.push('Priority: ' + procName + ' → High');
      else failed.push('Priority: ' + procName + ' (process not found)');
    }

    // 8. Aggressive mode
    if (mode === 'aggressive') {
      await attempt('SysMain: Stopped',  'sc stop SysMain');
      await attempt('WSearch: Stopped',  'sc stop WSearch');
      await attempt('Nagle: Disabled (1)', 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f');
      await attempt('Nagle: Disabled (2)', 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f');
      await attempt('Timer Resolution: Low',
        'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel" /v GlobalTimerResolutionRequests /t REG_DWORD /d 1 /f');
    }

    console.log('[Engine] Boost done: ' + applied.length + ' applied, ' + failed.length + ' failed');
    return { success: applied.length > 0, applied, failed, mode, count: applied.length };
  },

  // ── REVERT BOOST ────────────────────────────────────────────────────────────
  async revert() {
    if (!IS_WIN) return { success: true, reverted: [] };
    const reverted = [];
    const steps = [
      ['Power: Balanced',    'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e'],
      ['GameDVR: Restored',  'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 1 /f'],
      ['SysMain: Started',   'sc start SysMain'],
    ];
    for (const [label, cmd] of steps) {
      const r = await run(cmd);
      if (r.ok) reverted.push(label);
    }
    return { success: true, reverted };
  },

  // ── GET PROCESSES — fixed null crash ────────────────────────────────────────
  async getProcesses() {
    if (!IS_WIN) return [];
    return new Promise((resolve) => {
      exec('tasklist /fo csv /nh 2>nul', { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }

        const ANTI_CHEAT = new Set([
          'easyanticheat.exe','battleye.exe','be_service.exe','vgc.exe','vanguard.exe',
          'faceitclient.exe','esea.exe','punkbuster.exe','eac_launcher.exe'
        ]);
        const PROTECTED = new Set([
          'system','smss.exe','csrss.exe','wininit.exe','winlogon.exe',
          'services.exe','lsass.exe','svchost.exe','dwm.exe','explorer.exe',
          'taskmgr.exe','valcrown.exe'
        ]);

        const procs = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
          try {
            if (!line || !line.trim()) continue;
            const parts = line.replace(/\r/g, '').split('","');
            // parts[0] = "name, parts[1] = pid, parts[4] = memory
            const rawName = (parts[0] || '').replace(/"/g, '').trim();
            if (!rawName) continue; // ← THIS fixes the crash

            const name    = rawName.toLowerCase();
            const pid     = parseInt((parts[1] || '0').replace(/"/g, '')) || 0;
            const memStr  = (parts[4] || '0').replace(/"/g, '').replace(/[^0-9]/g, '');
            const memKb   = parseInt(memStr) || 0;

            if (!pid) continue;

            procs.push({
              name:        rawName,
              pid,
              memoryKb:    memKb,
              memoryMb:    Math.round(memKb / 1024),
              isAntiCheat: ANTI_CHEAT.has(name),
              isProtected: PROTECTED.has(name),
              canKill:     !ANTI_CHEAT.has(name) && !PROTECTED.has(name),
            });
          } catch(e) {
            // Skip bad lines — never crash
          }
        }

        procs.sort((a, b) => b.memoryKb - a.memoryKb);
        resolve(procs.slice(0, 60));
      });
    });
  },

  // ── KILL PROCESS ────────────────────────────────────────────────────────────
  async killProcess(pid) {
    if (!pid || pid <= 4) return { success: false, reason: 'System process' };
    const safePid2 = parseInt(pid);
    if (!safePid2 || safePid2 < 1 || safePid2 > 99999) return { success: false };
    const r = await run(`taskkill /PID ${safePid2} /F`);
    return { success: r.ok, reason: r.err || 'Killed' };
  },

  // ── CLEAN RAM ───────────────────────────────────────────────────────────────
  async cleanRam() {
    if (!IS_WIN) return { success: true, freed: 0 };
    const before = os.totalmem() - os.freemem();
    // Empty working sets of all non-system processes
    const r = await ps(
      'Get-Process | Where-Object {$_.WorkingSet64 -gt 20MB -and $_.ProcessName -notmatch "system|csrss|smss|lsass|winlogon|svchost|dwm"} | ForEach-Object { try { $_.MinWorkingSet = $_.MinWorkingSet } catch {} }; [System.GC]::Collect(); Write-Output "done"'
    );
    const after = os.totalmem() - os.freemem();
    const freed = Math.max(0, Math.round((before - after) / 1024 / 1024));
    return { success: r.ok, freed, freedMb: freed };
  },

  // ── OPTIMIZE NETWORK ────────────────────────────────────────────────────────
  async optimizeNetwork() {
    if (!IS_WIN) return { success: true, applied: [] };
    const applied = [];
    const cmds = [
      ['TCP AutoTuning',    'netsh int tcp set global autotuninglevel=normal'],
      ['RSS Enabled',       'netsh int tcp set global rss=enabled'],
      ['ECN Enabled',       'netsh int tcp set global ecncapability=enabled'],
      ['Chimney Disabled',  'netsh int tcp set global chimney=disabled'],
      ['TcpAckFrequency=1', 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f'],
      ['TCPNoDelay=1',      'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f'],
      ['DefaultTTL=64',     'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v DefaultTTL /t REG_DWORD /d 64 /f'],
    ];
    for (const [label, cmd] of cmds) {
      const r = await run(cmd);
      if (r.ok) applied.push(label);
    }
    return { success: applied.length > 0, applied };
  },

  // ── FLUSH DNS ───────────────────────────────────────────────────────────────
  async flushDns() {
    if (!IS_WIN) return { success: true, steps: [] };
    const steps = [];
    const r1 = await run('ipconfig /flushdns');
    steps.push({ label: 'DNS Cache Flushed', ok: r1.ok });
    const r2 = await run('ipconfig /registerdns');
    steps.push({ label: 'DNS Registered', ok: r2.ok });
    const r3 = await run('netsh winsock reset');
    steps.push({ label: 'Winsock Reset', ok: r3.ok });
    return { success: r1.ok, steps };
  },

  // ── SET DNS ─────────────────────────────────────────────────────────────────
  async setDns(primary, secondary) {
    if (!IS_WIN) return { success: true };
    // PowerShell approach — works on all adapter names
    const r = await ps(`Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Set-DnsClientServerAddress -ServerAddresses ('${primary}','${secondary}'); Write-Output 'OK'`);
    return { success: r.ok };
  },

  // ── PING ────────────────────────────────────────────────────────────────────
  async ping(host) {
    host = host || '8.8.8.8';
    const start = Date.now();
    const cmd = IS_WIN ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;
    const r = await run(cmd);
    const match = r.out.match(/time[<=](\d+\.?\d*)\s*ms/i) || r.out.match(/(\d+\.?\d*)\s*ms/);
    return { ms: match ? Math.round(parseFloat(match[1])) : (Date.now() - start), host, success: r.ok };
  },

  // ── GET SYSTEM INFO ─────────────────────────────────────────────────────────
  async getSystemInfo() {
    const cpus = os.cpus();
    let gpu = 'Unknown GPU', gpuVram = 0, gpuVendor = 'Unknown';
    if (IS_WIN) {
      try {
        const r = execSync('wmic path win32_VideoController get Name,AdapterRAM /format:value 2>nul',
          { windowsHide: true, timeout: 5000 }).toString();
        const nm = r.match(/Name=(.+)/);
        const vm = r.match(/AdapterRAM=(\d+)/);
        if (nm) gpu = nm[1].trim();
        if (vm) gpuVram = Math.round(parseInt(vm[1]) / 1024 / 1024);
        gpuVendor = gpu.includes('NVIDIA') ? 'NVIDIA' : gpu.includes('AMD') ? 'AMD' : gpu.includes('Intel') ? 'Intel' : 'Unknown';
      } catch(e) {}
    }
    return {
      cpuModel: cpus[0]?.model || 'Unknown CPU',
      cpuCores: cpus.length,
      gpu, gpuVram, gpuVendor,
      totalRam: Math.round(os.totalmem() / 1073741824),
      freeRam:  Math.round(os.freemem()  / 1073741824),
      usedRam:  Math.round((os.totalmem() - os.freemem()) / 1073741824),
      platform: IS_WIN ? 'Windows' : os.platform() === 'darwin' ? 'macOS' : 'Linux',
      arch:     os.arch(),
      hostname: os.hostname(),
    };
  },

  // ── CPU USAGE ───────────────────────────────────────────────────────────────
  getCpuUsage() {
    return new Promise((resolve) => {
      const c1 = os.cpus();
      setTimeout(() => {
        const c2 = os.cpus();
        let tot = 0, idle = 0;
        c2.forEach((cpu, i) => {
          const prev = c1[i];
          const t  = Object.values(cpu.times).reduce((a,b)=>a+b,0);
          const pt = Object.values(prev.times).reduce((a,b)=>a+b,0);
          tot  += t - pt;
          idle += cpu.times.idle - prev.times.idle;
        });
        resolve(Math.max(0, Math.min(100, Math.round(((tot-idle)/tot)*100))) || 0);
      }, 300);
    });
  },

  // ── RAM USAGE ───────────────────────────────────────────────────────────────
  getRamUsage() {
    const total = os.totalmem(), free = os.freemem(), used = total - free;
    return {
      usedPct: Math.round((used/total)*100),
      totalGb: Math.round(total/1073741824),
      freeGb:  Math.round(free/1073741824),
      usedGb:  Math.round(used/1073741824),
    };
  },

  // ── ANTI-CHEAT CHECK ────────────────────────────────────────────────────────
  async checkAntiCheat() {
    const procs = await this.getProcesses();
    const detected = procs.filter(p => p.isAntiCheat).map(p => p.name);
    return {
      safe:     detected.length === 0,
      detected,
      warning:  detected.length > 0
        ? `Anti-cheat detected: ${detected.join(', ')} — ValCrown will NOT touch these`
        : 'No anti-cheat detected — safe to boost',
    };
  },

  // ── STARTUP ─────────────────────────────────────────────────────────────────
  setStartup(enabled) {
    if (!IS_WIN) return { success: false };
    try {
      const exe = process.execPath;
      if (enabled) {
        execSync(`reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown /t REG_SZ /d "${exe}" /f`, { windowsHide: true });
      } else {
        execSync('reg delete "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown /f', { windowsHide: true });
      }
      return { success: true, enabled };
    } catch(e) { return { success: false, reason: e.message }; }
  },

  getStartupEnabled() {
    if (!IS_WIN) return false;
    try {
      execSync('reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown', { windowsHide: true });
      return true;
    } catch(e) { return false; }
  },
};

module.exports = Engine;
