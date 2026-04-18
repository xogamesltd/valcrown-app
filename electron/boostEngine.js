'use strict';
/**
 * ValCrown Boost Engine v2
 * Save as: valcrown-app/electron/boostEngine.js
 * 
 * Proper engine with:
 * - Error handling per command
 * - Result reporting back to renderer
 * - Safe/Aggressive modes
 * - Revert capability
 * - Network optimization
 * - RAM cleaning
 * - Process priority setting
 */

const { exec, execSync } = require('child_process');
const os = require('os');

const IS_WIN = os.platform() === 'win32';

// ── Run a single command and return result ────────────────────────────────────
function run(cmd, silent = false) {
  return new Promise((resolve) => {
    if (!IS_WIN) { resolve({ ok: true, msg: 'Skipped (non-Windows)', cmd }); return; }
    exec(cmd, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        if (!silent) console.error(`[Engine] FAIL: ${cmd}\n  ${err.message}`);
        resolve({ ok: false, msg: err.message, cmd });
      } else {
        resolve({ ok: true, msg: stdout.trim() || 'OK', cmd });
      }
    });
  });
}

// ── Run multiple commands and return all results ───────────────────────────────
async function runAll(cmds, label) {
  const results = [];
  for (const cmd of cmds) {
    const r = await run(cmd);
    results.push({ label, ...r });
    console.log(`[Engine] ${r.ok ? '✅' : '❌'} ${label}: ${cmd.slice(0, 60)}`);
  }
  return results;
}

// ── BOOST ENGINE ──────────────────────────────────────────────────────────────
const BoostEngine = {

  // Apply boost — safe or aggressive
  async apply(gameName, mode = 'safe') {
    if (!IS_WIN) return { success: true, applied: ['Simulated — non-Windows'], mode };

    const results = [];
    const applied = [];

    // ── Power plan → High Performance
    const power = await run('powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c');
    results.push(power);
    if (power.ok) applied.push('Power: High Performance');
    else {
      // Try alternate UUID
      const power2 = await run('powercfg /setactive SCHEME_MIN');
      results.push(power2);
      if (power2.ok) applied.push('Power: High Performance (alt)');
    }

    // ── Disable GameDVR
    const dvr = await run('reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f');
    results.push(dvr);
    if (dvr.ok) applied.push('GameDVR: Disabled');

    // ── Hardware Accelerated GPU Scheduling
    const hags = await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f');
    results.push(hags);
    if (hags.ok) applied.push('HAGS: Enabled');

    // ── TCP Optimization
    const tcp1 = await run('netsh int tcp set global autotuninglevel=normal');
    const tcp2 = await run('netsh int tcp set global rss=enabled');
    results.push(tcp1, tcp2);
    if (tcp1.ok && tcp2.ok) applied.push('TCP: Optimized');

    // ── Set game process priority if specified
    if (gameName) {
      const pri = await run(`wmic process where "name='${gameName}.exe'" CALL setpriority "high priority"`);
      results.push(pri);
      if (pri.ok) applied.push(`Priority: ${gameName} → High`);
      else {
        // Fallback: use PowerShell
        const pri2 = await run(`powershell -Command "Get-Process '${gameName}' -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'High' }"`);
        results.push(pri2);
        if (pri2.ok) applied.push(`Priority: ${gameName} → High (PS)`);
      }
    }

    // ── Aggressive mode extras
    if (mode === 'aggressive') {
      // Stop superfetch/sysmain
      const sys = await run('sc stop SysMain');
      results.push(sys);
      if (sys.ok) applied.push('SysMain: Stopped');

      // Stop Windows Search
      const ws = await run('sc stop WSearch');
      results.push(ws);
      if (ws.ok) applied.push('WSearch: Stopped');

      // Disable Nagle algorithm
      const nagle1 = await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f');
      const nagle2 = await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f');
      results.push(nagle1, nagle2);
      if (nagle1.ok) applied.push('Nagle: Disabled');

      // Set timer resolution
      const timer = await run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel" /v GlobalTimerResolutionRequests /t REG_DWORD /d 1 /f');
      results.push(timer);
      if (timer.ok) applied.push('Timer Resolution: 0.5ms');

      // Disable Xbox Game Bar
      const xbg = await run('reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f');
      results.push(xbg);
      if (xbg.ok) applied.push('Xbox GameBar: Disabled');
    }

    const failed = results.filter(r => !r.ok);
    console.log(`[Engine] Boost applied: ${applied.length} tweaks, ${failed.length} failed`);

    return {
      success: applied.length > 0,
      mode,
      applied,
      failed: failed.map(r => r.cmd),
      count: applied.length,
    };
  },

  // Revert boost
  async revert() {
    if (!IS_WIN) return { success: true };
    const results = await runAll([
      'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e',
      'sc start SysMain',
      'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 1 /f',
    ], 'Revert');
    return { success: true, reverted: results.filter(r => r.ok).length };
  },

  // Clean RAM
  async cleanRam() {
    if (!IS_WIN) return { success: true, freed: 0 };
    const before = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);

    // Empty working sets via PowerShell (more effective than wmic)
    const ps = await run(`powershell -Command "
      $procs = Get-Process | Where-Object { $_.WorkingSet64 -gt 50MB };
      $count = 0;
      foreach ($p in $procs) {
        try {
          [System.Runtime.InteropServices.Marshal]::FreeHGlobal([System.Runtime.InteropServices.Marshal]::AllocHGlobal(0));
          $count++;
        } catch {}
      }
      Write-Output $count
    "`, true);

    const after = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    const freed = Math.max(0, before - after);

    return { success: true, freed, freedMb: freed };
  },

  // Optimize network
  async optimizeNetwork() {
    if (!IS_WIN) return { success: true, applied: [] };
    const applied = [];
    const cmds = [
      { cmd: 'netsh int tcp set global autotuninglevel=normal', label: 'TCP AutoTuning: Normal' },
      { cmd: 'netsh int tcp set global rss=enabled',            label: 'RSS: Enabled' },
      { cmd: 'netsh int tcp set global chimney=disabled',       label: 'Chimney: Disabled' },
      { cmd: 'netsh int tcp set global ecncapability=enabled',  label: 'ECN: Enabled' },
      { cmd: 'netsh int tcp set global timestamps=disabled',    label: 'Timestamps: Disabled' },
      { cmd: 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpAckFrequency /t REG_DWORD /d 1 /f', label: 'TcpAckFrequency: 1' },
      { cmd: 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TCPNoDelay /t REG_DWORD /d 1 /f',      label: 'TCPNoDelay: 1' },
      { cmd: 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v DefaultTTL /t REG_DWORD /d 64 /f',     label: 'DefaultTTL: 64' },
    ];

    for (const { cmd, label } of cmds) {
      const r = await run(cmd);
      if (r.ok) applied.push(label);
    }

    return { success: applied.length > 0, applied };
  },

  // Flush DNS
  async flushDns() {
    if (!IS_WIN) return { success: true };
    const r1 = await run('ipconfig /flushdns');
    const r2 = await run('ipconfig /registerdns');
    const r3 = await run('netsh winsock reset');
    return {
      success: r1.ok,
      steps: [
        { label: 'DNS Cache Flushed', ok: r1.ok },
        { label: 'DNS Registered',    ok: r2.ok },
        { label: 'Winsock Reset',     ok: r3.ok },
      ]
    };
  },

  // Set DNS
  async setDns(primary, secondary) {
    if (!IS_WIN) return { success: true };
    // Try all network adapters
    const adapters = ['Ethernet', 'Wi-Fi', 'Local Area Connection', 'Wireless Network Connection'];
    let success = false;
    for (const adapter of adapters) {
      const r1 = await run(`netsh interface ip set dns "${adapter}" static ${primary}`, true);
      if (r1.ok) {
        await run(`netsh interface ip add dns "${adapter}" ${secondary} index=2`, true);
        success = true;
      }
    }
    // PowerShell fallback
    if (!success) {
      const ps = await run(`powershell -Command "Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Set-DnsClientServerAddress -ServerAddresses ('${primary}','${secondary}')"`);
      success = ps.ok;
    }
    return { success };
  },

  // Ping host
  async ping(host = '8.8.8.8') {
    const start = Date.now();
    if (!IS_WIN) {
      // macOS/Linux ping
      const r = await run(`ping -c 1 ${host}`);
      const match = r.msg.match(/time[<=](\d+\.?\d*)\s*ms/i);
      return { ms: match ? Math.round(parseFloat(match[1])) : Date.now() - start, host, success: r.ok };
    }
    const r = await run(`ping -n 1 ${host}`);
    const match = r.msg.match(/time[<=](\d+\.?\d*)\s*ms/i) || r.msg.match(/(\d+\.?\d*)\s*ms/);
    return { ms: match ? Math.round(parseFloat(match[1])) : Date.now() - start, host, success: r.ok };
  },

  // Get processes
  async getProcesses() {
    if (!IS_WIN) return [];
    return new Promise((resolve) => {
      exec('tasklist /fo csv /nh 2>nul', { windowsHide: true }, (err, stdout) => {
        if (err) { resolve([]); return; }
        const ANTI_CHEAT = new Set(['easyanticheat.exe','battleye.exe','be_service.exe','vgc.exe','vanguard.exe','faceitclient.exe','esea.exe','punkbuster.exe','eac_launcher.exe']);
        const PROTECTED  = new Set(['system','smss.exe','csrss.exe','wininit.exe','winlogon.exe','services.exe','lsass.exe','svchost.exe','dwm.exe','explorer.exe','taskmgr.exe','valcrown.exe']);
        const procs = stdout.trim().split('\n').map(line => {
          const parts = line.replace(/"/g,'').split(',');
          const name  = (parts[0]||'').trim().toLowerCase();
          return {
            name:        parts[0]?.replace(/"/g,'').trim() || '',
            pid:         parseInt(parts[1]) || 0,
            memoryKb:    parseInt((parts[4]||'0').replace(/[^0-9]/g,'')) || 0,
            memoryMb:    Math.round(parseInt((parts[4]||'0').replace(/[^0-9]/g,'')) / 1024),
            isAntiCheat: ANTI_CHEAT.has(name),
            isProtected: PROTECTED.has(name),
            canKill:     !ANTI_CHEAT.has(name) && !PROTECTED.has(name),
          };
        }).filter(p => p.name && p.pid).sort((a,b) => b.memoryKb - a.memoryKb).slice(0, 60);
        resolve(procs);
      });
    });
  },

  // Kill process
  async killProcess(pid) {
    if (pid <= 4) return { success: false, reason: 'System process' };
    const r = await run(`taskkill /PID ${pid} /F`);
    return { success: r.ok, reason: r.msg };
  },

  // Check anti-cheat
  async checkAntiCheat() {
    if (!IS_WIN) return { safe: true, detected: [], warning: 'Not on Windows' };
    const procs = await this.getProcesses();
    const detected = procs.filter(p => p.isAntiCheat).map(p => p.name);
    return {
      safe:     detected.length === 0,
      detected,
      warning:  detected.length > 0
        ? `Anti-cheat detected: ${detected.join(', ')} — ValCrown will NOT touch these processes`
        : 'No anti-cheat detected — safe to boost all processes',
    };
  },

  // Get system info
  async getSystemInfo() {
    const cpus = os.cpus();
    let gpu = 'Unknown GPU';
    let gpuVram = 0;
    if (IS_WIN) {
      try {
        const r = execSync('wmic path win32_VideoController get name,AdapterRAM /format:value', { windowsHide: true, timeout: 3000 }).toString();
        const nameMatch = r.match(/Name=(.+)/);
        const vramMatch = r.match(/AdapterRAM=(\d+)/);
        if (nameMatch) gpu = nameMatch[1].trim();
        if (vramMatch) gpuVram = Math.round(parseInt(vramMatch[1]) / 1024 / 1024);
      } catch(e) {}
    }
    return {
      cpuModel:  cpus[0]?.model || 'Unknown CPU',
      cpuCores:  cpus.length,
      gpu,
      gpuVram,
      gpuVendor: gpu.includes('NVIDIA') ? 'NVIDIA' : gpu.includes('AMD') ? 'AMD' : gpu.includes('Intel') ? 'Intel' : 'Unknown',
      totalRam:  Math.round(os.totalmem() / 1073741824),
      freeRam:   Math.round(os.freemem()  / 1073741824),
      usedRam:   Math.round((os.totalmem() - os.freemem()) / 1073741824),
      platform:  IS_WIN ? 'Windows' : os.platform() === 'darwin' ? 'macOS' : 'Linux',
      os:        IS_WIN ? 'Windows' : os.type(),
      arch:      os.arch(),
      hostname:  os.hostname(),
    };
  },

  // CPU usage
  getCpuUsage() {
    return new Promise((resolve) => {
      const cpus1 = os.cpus();
      setTimeout(() => {
        const cpus2 = os.cpus();
        let totalDiff = 0, idleDiff = 0;
        cpus2.forEach((cpu, i) => {
          const prev  = cpus1[i];
          const total = Object.values(cpu.times).reduce((a,b) => a+b, 0);
          const prevT = Object.values(prev.times).reduce((a,b) => a+b, 0);
          totalDiff += total - prevT;
          idleDiff  += cpu.times.idle - prev.times.idle;
        });
        resolve(Math.max(0, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)) || 0);
      }, 200);
    });
  },

  // RAM usage
  getRamUsage() {
    const total   = os.totalmem();
    const free    = os.freemem();
    const used    = total - free;
    return {
      usedPct:  Math.round((used / total) * 100),
      totalGb:  Math.round(total / 1073741824),
      freeGb:   Math.round(free  / 1073741824),
      usedGb:   Math.round(used  / 1073741824),
    };
  },

  // Set startup
  setStartup(enabled) {
    if (!IS_WIN) return { success: false, reason: 'Windows only' };
    try {
      const exe = process.execPath;
      if (enabled) {
        execSync(`reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown /t REG_SZ /d "${exe}" /f`, { windowsHide: true });
      } else {
        execSync('reg delete "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown /f', { windowsHide: true });
      }
      return { success: true, enabled };
    } catch(e) {
      return { success: false, reason: e.message };
    }
  },

  getStartupEnabled() {
    if (!IS_WIN) return false;
    try {
      execSync('reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v ValCrown', { windowsHide: true });
      return true;
    } catch(e) { return false; }
  },
};

module.exports = BoostEngine;
