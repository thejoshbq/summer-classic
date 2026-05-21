const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
