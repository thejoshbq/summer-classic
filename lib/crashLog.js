const fs = require('fs');
const path = require('path');
const os = require('os');

// Deliberately does not require ./store — store.js runs data-dir seeding at
// module-load time, which is exactly the code under suspicion when this
// module needs to log a require-time crash. A second require of a module
// that's already throwing would just throw again, so the tiny appDataDir()
// logic below is duplicated rather than shared.
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

function logFile() {
  return path.join(appDataDir(), 'crash.log');
}

function append(line) {
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  if (!process.pkg) {
    console.error(entry);
    return;
  }
  try {
    fs.mkdirSync(appDataDir(), { recursive: true });
    fs.appendFileSync(logFile(), entry);
  } catch {
    // Nothing we can do if the log itself can't be written — avoid turning
    // a logging failure into a second uncaught exception.
  }
}

function logWarning(context, err) {
  append(`WARNING (${context}): ${err && err.stack ? err.stack : err}`);
}

function install() {
  process.on('uncaughtException', err => {
    append(`FATAL uncaughtException: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
  process.on('unhandledRejection', reason => {
    append(`FATAL unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
    process.exit(1);
  });
}

module.exports = { install, logWarning };
