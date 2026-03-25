#!/usr/bin/env node
/**
 * bootstrap.js
 * Dashboard startup logic — replaces complex bat file logic with Node.js.
 * Called by start-dashboard.bat (minimal ASCII bat).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PORT = 3100;

// ── Helpers ──
function log(tag, msg) { console.log(`  [${tag}] ${msg}`); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── 1. Banner + version ──
console.log('');
console.log('  ============================================');
console.log('   2BASS Content Dashboard');
console.log('  ============================================');
console.log('');

const manifestPath = path.join(ROOT, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m.version) log('INFO', `Package version: ${m.version}`);
  } catch { /* ignore */ }
}

// Show Node.js version
log('OK', `Node.js ${process.version}`);

// ── 2. npm install if needed ──
const nodeModules = path.join(ROOT, 'node_modules');
if (!fs.existsSync(nodeModules)) {
  console.log('');
  log('SETUP', 'Installing dependencies...');
  console.log('');
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
    log('OK', 'Dependencies installed');
    console.log('');
  } catch {
    console.log('');
    log('ERROR', 'npm install failed.');
    log('ERROR', '  - Check network connection');
    log('ERROR', '  - Try running as administrator');
    log('ERROR', '  - Delete node_modules folder and retry');
    process.exit(1);
  }
}

// ── 3. Ensure required directories ──
ensureDir(path.join(ROOT, 'data', 'work'));

// ── 4. Kill existing server on port ──
try {
  const netstat = execSync(`netstat -ano | findstr ":${PORT} " | findstr "LISTENING"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  if (netstat) {
    log('RESTART', 'Stopping old server...');
    const lines = netstat.split('\n');
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' }); } catch { /* already dead */ }
    }
    // Brief pause for port release
    execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'pipe' });
  }
} catch { /* no process on port — OK */ }

// ── 5. Sync extracted images → SSOT, then generate HTML ──
const manifestFile = path.join(ROOT, 'output', 'images', 'manifest.json');
if (fs.existsSync(manifestFile)) {
  log('SYNC', 'Syncing extracted images to SSOT...');
  try {
    execSync('node scripts/content-extract-images.js --sync', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    log('WARN', 'Image sync failed - continuing.');
  }
}

log('INIT', 'Generating dashboard HTML...');
try {
  execSync('node scripts/naver-blog-publish-html.js', { cwd: ROOT, stdio: 'inherit' });
} catch {
  log('WARN', 'HTML generation failed - server mode will be used.');
}
console.log('');

// ── 6. Open browser ──
console.log('');
console.log('  ============================================');
console.log(`   http://localhost:${PORT}`);
console.log('  ============================================');
console.log('');
console.log('  Browser will open automatically.');
console.log('  Close this window to stop the server.');
console.log('');

exec(`start http://localhost:${PORT}`);

// ── 7. Start server (blocking) ──
// Detect package mode: server.js at root → publish-ready package
const packageServer = path.join(ROOT, 'server.js');
const serverScript = fs.existsSync(packageServer)
  ? packageServer
  : path.join(ROOT, 'scripts', 'manual-server.js');

try {
  execSync(`node "${serverScript}"`, { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.log('');
  log('ERROR', 'Server exited abnormally.');
  process.exit(1);
}
