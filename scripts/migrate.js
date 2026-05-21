// One-time migration: seed data/ from the old legacy app directories.
//
// What it does:
//   * Extracts player names from elimination-bracket/bracket.json (the demo
//     roster of 12) into data/players.json with fresh IDs.
//   * Initializes empty data/teams.json and data/standings.json (the old
//     standings-board never had real teams persisted).
//   * Initializes fresh data/bracket.json (does not try to recreate the
//     mid-tournament state — operator can regenerate from the roster).
//   * Initializes fresh data/game.json and data/displayMode.json.
// Idempotent: skips any file that already exists in data/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function writeJson(name, value, { skipIfExists = false } = {}) {
  const file = path.join(DATA, `${name}.json`);
  if (skipIfExists && fs.existsSync(file)) {
    console.log(`  skip ${name}.json (already exists)`);
    return readJson(file);
  }
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  console.log(`  wrote ${name}.json`);
  return value;
}

console.log('Migrating legacy data into data/ …');

// 1. Players — from the bracket demo roster, if present.
const legacyBracket = readJson(path.join(ROOT, 'elimination-bracket', 'bracket.json'));
const legacyNames = (legacyBracket?.players || []).filter(n => typeof n === 'string' && n.trim());
const players = legacyNames.map(name => ({
  id: crypto.randomUUID(),
  name: name.trim(),
  scoutScore: null
}));
writeJson('players', players, { skipIfExists: true });

// 2. Teams — empty.
writeJson('teams', [], { skipIfExists: true });

// 3. Standings — empty record.
writeJson('standings', { day: 1, records: {} }, { skipIfExists: true });

// 4. Bracket — fresh, with mode + lane count preserved from legacy if any.
writeJson('bracket', {
  mode: legacyBracket?.mode || 'murderball',
  settings: { laneCount: legacyBracket?.settings?.laneCount || 4 },
  entrantPlayerIds: [],
  generated: false,
  currentRound: 0,
  rounds: [],
  championPlayerId: null,
  history: []
}, { skipIfExists: true });

// 5. Game — fresh setup state.
writeJson('game', {
  status: 'setup',
  visitorTeamId: null,
  homeTeamId: null,
  visitorInnings: Array(9).fill(null),
  homeInnings: Array(9).fill(null),
  currentInning: 1,
  currentHalf: 'top',
  pitcherPlayerId: null,
  batterPlayerId: null,
  pitcherFallback: '',
  batterFallback: '',
  bases: { first: false, second: false, third: false },
  outs: 0,
  balls: 0,
  inningsPlayed: 0
}, { skipIfExists: true });

// 6. Display mode — default to standings.
writeJson('displayMode', { mode: 'standings' }, { skipIfExists: true });

console.log(`Done. ${players.length} players seeded.`);
