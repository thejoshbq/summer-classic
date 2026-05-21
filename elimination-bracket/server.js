const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const BRACKET_FILE = path.join(__dirname, 'bracket.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_STATE = {
  mode: 'murderball',
  settings: { laneCount: 4 },
  players: [],
  generated: false,
  currentRound: 0,
  rounds: [],
  champion: null,
  history: []
};

let bracket = { ...DEFAULT_STATE };

if (fs.existsSync(BRACKET_FILE)) {
  try {
    bracket = JSON.parse(fs.readFileSync(BRACKET_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to load bracket.json, using defaults');
  }
}

function saveBracket() {
  fs.writeFileSync(BRACKET_FILE, JSON.stringify(bracket, null, 2));
}

function snapshot() {
  bracket.history = [{ snapshot: JSON.parse(JSON.stringify({ ...bracket, history: [] })) }];
}

// ── Murderball generation ──────────────────────────────────────────────

function buildMurderballRound(players, laneCount) {
  const heats = [];
  const fullHeats = Math.floor(players.length / laneCount);
  for (let i = 0; i < fullHeats; i++) {
    heats.push({
      players: players.slice(i * laneCount, i * laneCount + laneCount),
      eliminated: null,
      bye: false
    });
  }
  const remainder = players.slice(fullHeats * laneCount);
  for (const p of remainder) {
    heats.push({ players: [p], eliminated: null, bye: true });
  }
  return { heats, complete: false };
}

function generateMurderball(players, laneCount) {
  return [buildMurderballRound(players, laneCount)];
}

function advanceMurderballRound() {
  const round = bracket.rounds[bracket.currentRound];
  const survivors = round.heats.flatMap(h =>
    h.bye ? h.players : h.players.filter(p => p !== h.eliminated)
  );
  if (survivors.length <= 1) return survivors;
  const next = buildMurderballRound(survivors, bracket.settings.laneCount);
  bracket.rounds[bracket.currentRound].complete = true;
  bracket.rounds.push(next);
  bracket.currentRound++;
  return survivors;
}

// ── Derby generation ───────────────────────────────────────────────────

function seedSlots(size) {
  let slots = [1, 2];
  while (slots.length < size) {
    slots = slots.flatMap(s => [s, size + 1 - s]);
  }
  return slots;
}

function generateDerby(players) {
  const n = players.length;
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const slots = seedSlots(bracketSize);
  const rounds = [];
  const totalRounds = Math.log2(bracketSize);

  // Build round 1 matchups
  const r1matchups = [];
  for (let i = 0; i < slots.length; i += 2) {
    const s1 = slots[i], s2 = slots[i + 1];
    const p1name = s1 <= n ? players[s1 - 1] : null;
    const p2name = s2 <= n ? players[s2 - 1] : null;
    const isBye = p1name === null || p2name === null;
    const m = {
      player1: { name: p1name, seed: s1, score: null },
      player2: { name: p2name, seed: s2, score: null },
      winner: isBye ? (p1name || p2name) : null,
      bye: isBye
    };
    r1matchups.push(m);
  }
  rounds.push({ matchups: r1matchups, isFinal: totalRounds === 1 });

  // Build subsequent rounds as empty placeholders
  for (let r = 1; r < totalRounds; r++) {
    const matchupCount = bracketSize / Math.pow(2, r + 1);
    const matchups = [];
    for (let i = 0; i < matchupCount; i++) {
      matchups.push({
        player1: { name: null, seed: null, score: null },
        player2: { name: null, seed: null, score: null },
        winner: null,
        bye: false
      });
    }
    rounds.push({ matchups, isFinal: r === totalRounds - 1 });
  }

  // Propagate first-round bye winners into round 2 slots
  propagateDerbyWinners(rounds, 0);

  return rounds;
}

function propagateDerbyWinners(rounds, fromRound) {
  if (fromRound + 1 >= rounds.length) return;
  const cur = rounds[fromRound].matchups;
  const next = rounds[fromRound + 1].matchups;
  for (let i = 0; i < cur.length; i++) {
    const m = cur[i];
    if (m.winner) {
      const slot = Math.floor(i / 2);
      const isP1 = i % 2 === 0;
      if (isP1) next[slot].player1.name = m.winner;
      else next[slot].player2.name = m.winner;
      // Check if next matchup is now also a bye
      if (next[slot].player1.name && next[slot].player2.name === null ||
          next[slot].player2.name && next[slot].player1.name === null) {
        next[slot].winner = next[slot].player1.name || next[slot].player2.name;
        next[slot].bye = true;
        propagateDerbyWinners(rounds, fromRound + 1);
      }
    }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect(301, '/admin.html'));

app.get('/api/bracket', (req, res) => res.json(bracket));

app.put('/api/bracket/settings', (req, res) => {
  const { mode, laneCount, players } = req.body;
  const modeChanged = mode && mode !== bracket.mode;
  if (mode) bracket.mode = mode;
  if (laneCount != null) bracket.settings.laneCount = laneCount;
  if (players) bracket.players = players;
  if (modeChanged) {
    bracket.generated = false;
    bracket.rounds = [];
    bracket.currentRound = 0;
    bracket.champion = null;
    bracket.history = [];
  }
  saveBracket();
  res.json(bracket);
});

app.post('/api/bracket/generate', (req, res) => {
  if (bracket.players.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 players' });
  }
  snapshot();
  bracket.generated = true;
  bracket.currentRound = 0;
  bracket.champion = null;
  if (bracket.mode === 'murderball') {
    bracket.rounds = generateMurderball(bracket.players, bracket.settings.laneCount);
  } else {
    bracket.rounds = generateDerby(bracket.players);
  }
  saveBracket();
  res.json(bracket);
});

app.post('/api/bracket/reset', (req, res) => {
  bracket.generated = false;
  bracket.rounds = [];
  bracket.currentRound = 0;
  bracket.champion = null;
  bracket.history = [];
  saveBracket();
  res.json(bracket);
});

app.put('/api/bracket/eliminate', (req, res) => {
  const { roundIndex, heatIndex, playerName } = req.body;
  const heat = bracket.rounds[roundIndex]?.heats[heatIndex];
  if (!heat) return res.status(400).json({ error: 'Heat not found' });
  snapshot();
  heat.eliminated = heat.eliminated === playerName ? null : playerName;

  // Check if round is complete (all non-bye heats have exactly one elimination)
  const round = bracket.rounds[roundIndex];
  const allDone = round.heats.every(h => h.bye || h.eliminated !== null);
  if (allDone && roundIndex === bracket.currentRound) {
    advanceMurderballRound();
  }

  saveBracket();
  res.json(bracket);
});

app.put('/api/bracket/score', (req, res) => {
  const { roundIndex, matchupIndex, player1Score, player2Score, winner } = req.body;
  const matchup = bracket.rounds[roundIndex]?.matchups[matchupIndex];
  if (!matchup) return res.status(400).json({ error: 'Matchup not found' });
  snapshot();

  if (player1Score != null) matchup.player1.score = player1Score;
  if (player2Score != null) matchup.player2.score = player2Score;
  if (winner) {
    matchup.winner = winner;
    // Propagate winner to next round
    propagateDerbyWinners(bracket.rounds, roundIndex);
    // Advance currentRound if all matchups in this round are resolved
    const round = bracket.rounds[roundIndex];
    if (round.matchups.every(m => m.winner)) {
      if (roundIndex === bracket.currentRound && roundIndex + 1 < bracket.rounds.length) {
        bracket.currentRound++;
      }
    }
  }

  saveBracket();
  res.json(bracket);
});

app.put('/api/bracket/champion', (req, res) => {
  snapshot();
  bracket.champion = req.body.name;
  saveBracket();
  res.json(bracket);
});

app.post('/api/bracket/undo', (req, res) => {
  if (!bracket.history.length) return res.status(400).json({ error: 'Nothing to undo' });
  const { snapshot: prev } = bracket.history.pop();
  bracket = { ...prev, history: bracket.history };
  saveBracket();
  res.json(bracket);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bracket server running at http://localhost:${PORT}`));
