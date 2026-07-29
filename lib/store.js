const fs = require('fs');
const path = require('path');
const os = require('os');

// Embedded, read-only source of truth when running from a pkg snapshot;
// also the plain dev-mode data directory when not packaged.
const SOURCE_DATA_DIR = path.join(__dirname, '..', 'data');

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

function resolveDataDir() {
  if (!process.pkg) return SOURCE_DATA_DIR;
  return process.env.SUMMER_CLASSIC_DATA_DIR || path.join(appDataDir(), 'data');
}

const DATA_DIR = resolveDataDir();

// First run of a packaged install: seed the writable data dir from the
// embedded snapshot so operators continue the current season instead of
// starting empty. Only runs once — later app upgrades never touch an
// existing DATA_DIR, so in-progress edits are never overwritten.
function seedDataDirIfMissing() {
  if (fs.existsSync(DATA_DIR)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (DATA_DIR === SOURCE_DATA_DIR) return;
  for (const entry of fs.readdirSync(SOURCE_DATA_DIR)) {
    if (!entry.endsWith('.json')) continue;
    fs.writeFileSync(path.join(DATA_DIR, entry), fs.readFileSync(path.join(SOURCE_DATA_DIR, entry)));
  }
}

seedDataDirIfMissing();

const locks = new Map();

function fileFor(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readSync(name, fallback) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeSync(name, value) {
  const file = fileFor(name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

async function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  locks.set(name, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(name) === next) locks.delete(name);
  }
}

function makeStore(name, fallback) {
  let cache = readSync(name, fallback);
  return {
    get() {
      return cache;
    },
    async update(fn) {
      return withLock(name, async () => {
        const next = await fn(cache);
        if (next !== undefined) cache = next;
        writeSync(name, cache);
        return cache;
      });
    },
    async set(value) {
      return withLock(name, async () => {
        cache = value;
        writeSync(name, cache);
        return cache;
      });
    }
  };
}

module.exports = { makeStore };
