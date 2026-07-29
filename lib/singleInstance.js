const fs = require('fs');
const path = require('path');
const { appDataDir } = require('./store');

const PID_FILE = path.join(appDataDir(), 'server.pid');
const KILL_POLL_INTERVAL_MS = 50;
const KILL_WAIT_CAP_MS = 3000;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function killStaleInstance() {
  let prevPid;
  try {
    prevPid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  } catch {
    return;
  }
  if (!Number.isInteger(prevPid) || prevPid === process.pid || !isRunning(prevPid)) return;

  // On Windows this is a hard TerminateProcess regardless of signal name —
  // fine here since the relaunch doesn't need the old instance to cooperate.
  try {
    process.kill(prevPid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + KILL_WAIT_CAP_MS;
  while (isRunning(prevPid) && Date.now() < deadline) {
    await sleep(KILL_POLL_INTERVAL_MS);
  }
}

function writePidFile() {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function clearPidFile() {
  try {
    if (parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10) === process.pid) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

module.exports = { killStaleInstance, writePidFile, clearPidFile };
