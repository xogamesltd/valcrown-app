'use strict';
const { exec } = require('child_process');
const os = require('os');
const IS_WIN = os.platform() === 'win32';

function run(cmd, timeout) {
  return new Promise(resolve => {
    if (!IS_WIN) return resolve({ ok: true, out: '' });
    exec(cmd, { windowsHide: true, timeout: timeout || 8000 }, (err, out) => {
      resolve({ ok: !err, out: (out || '').trim() });
    });
  });
}

async function getProcesses() {
  if (!IS_WIN) return [
    { name: 'chrome.exe',  pid: 1001, mem: 350 * 1024 * 1024 },
    { name: 'discord.exe', pid: 1002, mem: 180 * 1024 * 1024 },
    { name: 'spotify.exe', pid: 1003, mem: 120 * 1024 * 1024 },
  ];
  const r = await run('tasklist /fo csv /nh 2>nul');
  if (!r.ok) return [];
  return r.out.split('\n')
    .filter(l => l.trim())
    .map(l => {
      const p = l.replace(/"/g, '').split(',');
      return { name: p[0] || '', pid: parseInt(p[1]) || 0, mem: parseInt((p[4] || '0').replace(/\D/g, '')) * 1024 };
    })
    .filter(p => p.name && p.pid > 4)
    .sort((a, b) => b.mem - a.mem)
    .slice(0, 60);
}

function getCpuUsage() {
  return new Promise(resolve => {
    const c1 = os.cpus();
    setTimeout(() => {
      const c2 = os.cpus();
      let total = 0, idle = 0;
      c2.forEach((c, i) => {
        const t1 = Object.values(c1[i].times).reduce((a, b) => a + b, 0);
        const t2 = Object.values(c.times).reduce((a, b) => a + b, 0);
        total += t2 - t1;
        idle += c.times.idle - c1[i].times.idle;
      });
      resolve(total > 0 ? Math.round((1 - idle / total) * 100) : 0);
    }, 500);
  });
}

function getRamUsage() {
  const total = os.totalmem();
  const free  = os.freemem();
  const used  = total - free;
  return { total, free, used, usedPct: Math.round(used / total * 100), totalGB: (total / 1073741824).toFixed(1) };
}

function getSystemInfo() {
  return {
    cpu:   os.cpus()[0]?.model || 'Unknown CPU',
    cores: os.cpus().length,
    ramGB: (os.totalmem() / 1073741824).toFixed(1),
    os:    'Windows ' + os.release(),
    arch:  os.arch(),
    host:  os.hostname(),
  };
}

async function checkAntiCheat() {
  if (!IS_WIN) return { safe: true, found: [] };
  const r = await run('tasklist /fo csv /nh 2>nul');
  const running = r.out.toLowerCase();
  const acList = [
    { name: 'Vanguard', exe: 'vgc.exe' },
    { name: 'EasyAntiCheat', exe: 'easyanticheat.exe' },
    { name: 'BattlEye', exe: 'beservice.exe' },
    { name: 'FairFight', exe: 'fairfight.exe' },
    { name: 'PunkBuster', exe: 'pnkbstra.exe' },
  ];
  const found = acList.filter(a => running.includes(a.exe)).map(a => a.name);
  return { safe: found.length === 0, found };
}

function ping(host) {
  const safe = String(host || '8.8.8.8').replace(/[^a-zA-Z0-9.\-]/g, '');
  if (!IS_WIN) return Promise.resolve(Math.floor(Math.random() * 20) + 8);
  return new Promise(resolve => {
    exec('ping -n 1 ' + safe, { windowsHide: true, timeout: 5000 }, (err, out) => {
      const m = (out || '').match(/[Tt]ime[=<](\d+)/);
      resolve(m ? parseInt(m[1]) : null);
    });
  });
}

function getSteamGames() {
  if (!IS_WIN) return Promise.resolve([]);
  const path = require('path');
  const fs = require('fs');
  const steamPath = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps');
  if (!fs.existsSync(steamPath)) return Promise.resolve([]);
  const games = fs.readdirSync(steamPath)
    .filter(f => f.startsWith('appmanifest_') && f.endsWith('.acf'))
    .map(f => {
      try {
        const c = fs.readFileSync(path.join(steamPath, f), 'utf8');
        const name = c.match(/"name"\s+"([^"]+)"/)?.[1];
        return name ? { name, exe: name + '.exe' } : null;
      } catch { return null; }
    })
    .filter(Boolean)
    .slice(0, 50);
  return Promise.resolve(games);
}

module.exports = { getProcesses, getCpuUsage, getRamUsage, getSystemInfo, checkAntiCheat, ping, getSteamGames, run, IS_WIN };
