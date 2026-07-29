// Launches a packaged binary and proves it actually serves the app.
//
// Every packaging regression so far has been invisible until an operator
// double-clicked the installed shortcut, because nothing in CI ever ran the
// artifact it published. This does, on all three platforms.
//
// Readiness is detected over HTTP rather than by watching stdout: the Windows
// build is a GUI-subsystem binary with no console attached, so it never prints.
//
// Usage: node scripts/smoke-test.mjs <path-to-binary>

import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';

const TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 250;

const binary = process.argv[2];
if (!binary) {
  console.error('Usage: smoke-test.mjs <path-to-binary>');
  process.exit(1);
}
if (!fs.existsSync(binary)) {
  console.error(`smoke-test: no such binary: ${binary}`);
  process.exit(1);
}

// Mirrors appDataDir() in lib/store.js — duplicated rather than imported so
// this stays a standalone build-tooling script with no app dependencies.
function appDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'SummerClassic');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'SummerClassic');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'summer-classic');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summer-classic-smoke-'));

const child = spawn(path.resolve(binary), [], {
  env: {
    ...process.env,
    PORT: String(port),
    SUMMER_CLASSIC_DATA_DIR: dataDir,
    SUMMER_CLASSIC_NO_BROWSER: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

function report(message) {
  console.error(`smoke-test: ${message}`);
  if (exited) console.error(`smoke-test: process exited with code=${exited.code} signal=${exited.signal}`);
  if (output.trim()) console.error(`smoke-test: process output:\n${output}`);

  const crashLog = path.join(appDataDir(), 'crash.log');
  if (fs.existsSync(crashLog)) {
    console.error(`smoke-test: ${crashLog}:\n${fs.readFileSync(crashLog, 'utf8')}`);
  } else {
    console.error(`smoke-test: no crash log at ${crashLog}`);
  }
}

function cleanup() {
  if (!exited) child.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

async function get(route) {
  try {
    return await fetch(`http://127.0.0.1:${port}${route}`);
  } catch {
    return null;
  }
}

const deadline = Date.now() + TIMEOUT_MS;
let ready = false;
while (Date.now() < deadline) {
  if (exited) {
    report(`${path.basename(binary)} exited before it started serving`);
    cleanup();
    process.exit(1);
  }
  const res = await get('/api/standings');
  if (res && res.ok) {
    ready = true;
    break;
  }
  await sleep(POLL_INTERVAL_MS);
}

if (!ready) {
  report(`${path.basename(binary)} did not respond within ${TIMEOUT_MS}ms`);
  cleanup();
  process.exit(1);
}

// Also exercise res.sendFile against the pkg snapshot filesystem — serving the
// embedded public/ assets is a separate failure mode from booting.
const hub = await get('/');
if (!hub || !hub.ok) {
  report(`GET / failed (${hub ? hub.status : 'no response'}) — static assets not served from the snapshot`);
  cleanup();
  process.exit(1);
}

console.log(`smoke-test: ${path.basename(binary)} served /api/standings and / on port ${port}`);
cleanup();
