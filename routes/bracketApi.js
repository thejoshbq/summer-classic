const express = require('express');
const { bracket, players } = require('../lib/stores');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────

function snapshot(b) {
  const copy = JSON.parse(JSON.stringify({ ...b, history: [] }));
  b.history = [{ snapshot: copy }, ...(b.history || [])].slice(0, 12);
}

function buildMurderballRound(entrantIds, laneCount) {
  const heats = [];
  const fullHeats = Math.floor(entrantIds.length / laneCount);
  for (let i = 0; i < fullHeats; i++) {
    heats.push({
      playerIds: entrantIds.slice(i * laneCount, i * laneCount + laneCount),
      eliminatedPlayerId: null,
      bye: false
    });
  }
  const remainder = entrantIds.slice(fullHeats * laneCount);
  for (const pid of remainder) {
    heats.push({ playerIds: [pid], eliminatedPlayerId: null, bye: true });
  }
  return { heats, complete: false };
}

function murderballSurvivors(round) {
  return round.heats.flatMap(h =>
    h.bye ? h.playerIds : h.playerIds.filter(p => p !== h.eliminatedPlayerId)
  );
}

function orderMurderballEntrants(entrantIds) {
  // Sort lowest scout score first so they end up as the bye (lowest-seed slot
  // in the original logic — same effect here: byes are tail-of-array slots).
  const ps = players.get();
  const score = id => {
    const p = ps.find(x => x.id === id);
    const s = p?.scoutScore;
    return s == null ? Number.POSITIVE_INFINITY : s;
  };
  return [...entrantIds].sort((a, b) => score(b) - score(a));
}

function seedSlots(size) {
  if (size === 2) return [1, 2];
  const prev = seedSlots(size / 2);
  const result = new Array(size);
  prev.forEach((seed, i) => {
    result[i * 2] = seed;
    result[i * 2 + 1] = size + 1 - seed;
  });
  return result;
}

function generateDerby(entrantIds) {
  const n = entrantIds.length;
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const slots = seedSlots(bracketSize);
  const rounds = [];
  const totalRounds = Math.log2(bracketSize);

  const r1matchups = [];
  for (let i = 0; i < slots.length; i += 2) {
    const s1 = slots[i], s2 = slots[i + 1];
    const p1 = s1 <= n ? entrantIds[s1 - 1] : null;
    const p2 = s2 <= n ? entrantIds[s2 - 1] : null;
    const isBye = p1 === null || p2 === null;
    r1matchups.push({
      player1: { playerId: p1, seed: s1, score: null },
      player2: { playerId: p2, seed: s2, score: null },
      winnerPlayerId: isBye ? (p1 || p2) : null,
      bye: isBye
    });
  }
  rounds.push({ matchups: r1matchups, isFinal: totalRounds === 1 });

  for (let r = 1; r < totalRounds; r++) {
    const count = bracketSize / Math.pow(2, r + 1);
    const matchups = [];
    for (let i = 0; i < count; i++) {
      matchups.push({
        player1: { playerId: null, seed: null, score: null },
        player2: { playerId: null, seed: null, score: null },
        winnerPlayerId: null,
        bye: false
      });
    }
    rounds.push({ matchups, isFinal: r === totalRounds - 1 });
  }

  propagateDerbyWinners(rounds, 0);
  return rounds;
}

function propagateDerbyWinners(rounds, fromRound) {
  if (fromRound + 1 >= rounds.length) return;
  const cur = rounds[fromRound].matchups;
  const next = rounds[fromRound + 1].matchups;
  for (let i = 0; i < cur.length; i++) {
    const m = cur[i];
    if (m.winnerPlayerId) {
      const slot = Math.floor(i / 2);
      const isP1 = i % 2 === 0;
      const target = isP1 ? next[slot].player1 : next[slot].player2;
      target.playerId = m.winnerPlayerId;
    }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.json(bracket.get()));

router.put('/settings', async (req, res) => {
  const { mode, laneCount, entrantPlayerIds } = req.body || {};
  await bracket.update(b => {
    const modeChanged = mode && mode !== b.mode;
    if (mode === 'murderball' || mode === 'derby') b.mode = mode;
    if (laneCount != null) {
      const n = Math.min(4, Math.max(2, Math.floor(Number(laneCount))));
      b.settings.laneCount = n;
    }
    if (Array.isArray(entrantPlayerIds)) {
      const validIds = new Set(players.get().map(p => p.id));
      b.entrantPlayerIds = entrantPlayerIds.filter(id => validIds.has(id));
    }
    if (modeChanged) {
      b.generated = false;
      b.rounds = [];
      b.currentRound = 0;
      b.championPlayerId = null;
      b.history = [];
    }
    return b;
  });
  res.json(bracket.get());
});

router.post('/generate', async (req, res) => {
  let error = null;
  await bracket.update(b => {
    if ((b.entrantPlayerIds || []).length < 2) {
      error = 'Need at least 2 entrants.';
      return b;
    }
    snapshot(b);
    b.generated = true;
    b.currentRound = 0;
    b.championPlayerId = null;
    if (b.mode === 'murderball') {
      const ordered = orderMurderballEntrants(b.entrantPlayerIds);
      b.rounds = [buildMurderballRound(ordered, b.settings.laneCount)];
    } else {
      b.rounds = generateDerby(b.entrantPlayerIds);
    }
    return b;
  });
  if (error) return res.status(400).json({ error });
  res.json(bracket.get());
});

router.post('/reset', async (req, res) => {
  await bracket.update(b => {
    b.generated = false;
    b.rounds = [];
    b.currentRound = 0;
    b.championPlayerId = null;
    b.history = [];
    return b;
  });
  res.json(bracket.get());
});

router.put('/eliminate', async (req, res) => {
  const { roundIndex, heatIndex, playerId } = req.body || {};
  let err = null;
  await bracket.update(b => {
    const heat = b.rounds[roundIndex]?.heats?.[heatIndex];
    if (!heat) { err = 'Heat not found'; return b; }
    snapshot(b);
    heat.eliminatedPlayerId = heat.eliminatedPlayerId === playerId ? null : playerId;

    const round = b.rounds[roundIndex];
    const allDone = round.heats.every(h => h.bye || h.eliminatedPlayerId !== null);
    if (allDone && roundIndex === b.currentRound) {
      const survivors = murderballSurvivors(round);
      if (survivors.length > 1) {
        round.complete = true;
        b.rounds.push(buildMurderballRound(survivors, b.settings.laneCount));
        b.currentRound++;
      }
    }
    return b;
  });
  if (err) return res.status(400).json({ error: err });
  res.json(bracket.get());
});

router.put('/score', async (req, res) => {
  const { roundIndex, matchupIndex, player1Score, player2Score, winnerPlayerId } = req.body || {};
  let err = null;
  await bracket.update(b => {
    const matchup = b.rounds[roundIndex]?.matchups?.[matchupIndex];
    if (!matchup) { err = 'Matchup not found'; return b; }
    snapshot(b);
    if (player1Score != null) matchup.player1.score = Number(player1Score);
    if (player2Score != null) matchup.player2.score = Number(player2Score);
    if (winnerPlayerId) {
      matchup.winnerPlayerId = winnerPlayerId;
      propagateDerbyWinners(b.rounds, roundIndex);
      const round = b.rounds[roundIndex];
      if (round.matchups.every(m => m.winnerPlayerId)) {
        if (roundIndex === b.currentRound && roundIndex + 1 < b.rounds.length) {
          b.currentRound++;
        }
      }
    }
    return b;
  });
  if (err) return res.status(400).json({ error: err });
  res.json(bracket.get());
});

router.put('/champion', async (req, res) => {
  const id = req.body?.playerId || null;
  await bracket.update(b => {
    snapshot(b);
    b.championPlayerId = id;
    return b;
  });
  res.json(bracket.get());
});

router.post('/undo', async (req, res) => {
  let err = null;
  await bracket.update(b => {
    if (!b.history || !b.history.length) { err = 'Nothing to undo'; return b; }
    const [{ snapshot: prev }, ...rest] = b.history;
    return { ...prev, history: rest };
  });
  if (err) return res.status(400).json({ error: err });
  res.json(bracket.get());
});

module.exports = router;
