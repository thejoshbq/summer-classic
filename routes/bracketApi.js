const express = require('express');
const { bracket, players } = require('../lib/stores');
const { computeScoutScore } = require('../lib/constants');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────

function snapshot(b) {
  const copy = JSON.parse(JSON.stringify({ ...b, history: [] }));
  b.history = [{ snapshot: copy }, ...(b.history || [])].slice(0, 12);
}

// Back-compat: older heats stored a single eliminatedPlayerId. Normalize
// every read/write so the rest of this file only deals with the array form.
function normalizeHeats(b) {
  if (!Array.isArray(b.byeHistory)) b.byeHistory = [];
  if (b?.mode !== 'murderball' || !Array.isArray(b.rounds)) return;
  for (const round of b.rounds) {
    if (!Array.isArray(round.heats)) continue;
    for (const heat of round.heats) {
      if (!Array.isArray(heat.eliminatedPlayerIds)) {
        const legacy = heat.eliminatedPlayerId;
        heat.eliminatedPlayerIds = legacy ? [legacy] : [];
      }
      if ('eliminatedPlayerId' in heat) delete heat.eliminatedPlayerId;
    }
  }
}

// Fisher-Yates shuffle in place.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function scoutScoreOf(id) {
  const ps = players.get();
  const p = ps.find(x => x.id === id);
  return p?.variations ? computeScoutScore(p.variations) : null;
}

// Ranks a pool for bye priority: players who haven't had a bye yet first
// (lowest scout score first, matching the documented "lowest seed" rule),
// then players who've already had one, least-recent first.
function rankForBye(pool, byeHistory) {
  const neverByed = pool.filter(id => !byeHistory.includes(id));
  const alreadyByed = pool.filter(id => byeHistory.includes(id));
  neverByed.sort((a, b) => scoutScoreOf(a) - scoutScoreOf(b));
  alreadyByed.sort((a, b) => byeHistory.lastIndexOf(a) - byeHistory.lastIndexOf(b));
  return [...neverByed, ...alreadyByed];
}

// Picks who sits out this round. Unscored players stay exempt from ever
// being picked as long as enough scored players exist to fill every bye
// slot; only the shortfall (if any) spills over to unscored players.
function pickByeRecipients(entrantIds, count, byeHistory) {
  const eligible = entrantIds.filter(id => scoutScoreOf(id) != null);
  const ineligible = entrantIds.filter(id => scoutScoreOf(id) == null);

  const picks = rankForBye(eligible, byeHistory).slice(0, count);
  if (picks.length < count) {
    picks.push(...rankForBye(ineligible, byeHistory).slice(0, count - picks.length));
  }
  return picks;
}

function buildMurderballRound(entrantIds, laneCount, byeHistory) {
  const fullHeats = Math.floor(entrantIds.length / laneCount);
  // When survivors don't fill one full heat, put them all in one real heat
  // rather than issuing individual BYEs to every player.
  if (fullHeats === 0 && entrantIds.length > 0) {
    return {
      heats: [{ playerIds: shuffle([...entrantIds]), eliminatedPlayerIds: [], bye: false }],
      complete: false
    };
  }

  const remainderCount = entrantIds.length - fullHeats * laneCount;
  const byePlayerIds = remainderCount > 0 ? pickByeRecipients(entrantIds, remainderCount, byeHistory) : [];
  byeHistory.push(...byePlayerIds);

  const pool = shuffle(entrantIds.filter(id => !byePlayerIds.includes(id)));

  const heats = [];
  for (let i = 0; i < fullHeats; i++) {
    heats.push({
      playerIds: pool.slice(i * laneCount, i * laneCount + laneCount),
      eliminatedPlayerIds: [],
      bye: false
    });
  }
  for (const pid of byePlayerIds) {
    heats.push({ playerIds: [pid], eliminatedPlayerIds: [], bye: true });
  }
  return { heats, complete: false };
}

function murderballSurvivors(round) {
  return round.heats.flatMap(h =>
    h.bye ? h.playerIds : h.playerIds.filter(p => !h.eliminatedPlayerIds.includes(p))
  );
}

function heatHasElimination(h) {
  return h.bye || (h.eliminatedPlayerIds && h.eliminatedPlayerIds.length > 0);
}

function heatHasSurvivor(h) {
  if (h.bye) return true;
  return h.playerIds.some(p => !h.eliminatedPlayerIds.includes(p));
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

router.get('/', (req, res) => {
  const b = bracket.get();
  normalizeHeats(b);
  res.json(b);
});

router.put('/settings', async (req, res) => {
  const { mode, laneCount, entrantPlayerIds } = req.body || {};
  await bracket.update(b => {
    const modeChanged = mode && mode !== b.mode;
    if (mode === 'murderball' || mode === 'derby') b.mode = mode;
    if (laneCount != null) {
      const n = Math.max(2, Math.floor(Number(laneCount)));
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
      b.byeHistory = [];
      b.history = [];
    }
    return b;
  });
  res.json(bracket.get());
});

router.post('/generate', async (req, res) => {
  let error = null;
  await bracket.update(b => {
    normalizeHeats(b);
    if ((b.entrantPlayerIds || []).length < 2) {
      error = 'Need at least 2 entrants.';
      return b;
    }
    snapshot(b);
    b.generated = true;
    b.currentRound = 0;
    b.championPlayerId = null;
    b.byeHistory = [];
    if (b.mode === 'murderball') {
      b.rounds = [buildMurderballRound(b.entrantPlayerIds, b.settings.laneCount, b.byeHistory)];
    } else {
      b.rounds = generateDerby(shuffle([...b.entrantPlayerIds]));
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
    b.byeHistory = [];
    b.history = [];
    return b;
  });
  res.json(bracket.get());
});

router.put('/eliminate', async (req, res) => {
  const { roundIndex, heatIndex, playerId } = req.body || {};
  let err = null;
  await bracket.update(b => {
    normalizeHeats(b);
    const heat = b.rounds[roundIndex]?.heats?.[heatIndex];
    if (!heat) { err = 'Heat not found'; return b; }
    if (heat.bye) { err = "Can't eliminate a bye"; return b; }
    if (!heat.playerIds.includes(playerId)) { err = 'Player not in heat'; return b; }

    snapshot(b);
    const already = heat.eliminatedPlayerIds.includes(playerId);
    if (already) {
      heat.eliminatedPlayerIds = heat.eliminatedPlayerIds.filter(p => p !== playerId);
    } else {
      // Refuse to eliminate the last surviving player in a heat.
      const remaining = heat.playerIds.filter(p => !heat.eliminatedPlayerIds.includes(p) && p !== playerId);
      if (remaining.length === 0) {
        err = "Heat must keep at least one survivor.";
        return b;
      }
      heat.eliminatedPlayerIds = [...heat.eliminatedPlayerIds, playerId];
    }
    return b;
  });
  if (err) return res.status(400).json({ error: err });
  res.json(bracket.get());
});

router.post('/advance-round', async (req, res) => {
  let err = null;
  await bracket.update(b => {
    normalizeHeats(b);
    if (b.mode !== 'murderball') { err = 'Murderball only'; return b; }
    const round = b.rounds[b.currentRound];
    if (!round) { err = 'No active round'; return b; }
    if (!round.heats.every(heatHasElimination)) { err = 'Each heat needs at least one elimination first.'; return b; }
    if (!round.heats.every(heatHasSurvivor)) { err = 'Each heat needs at least one survivor.'; return b; }
    const survivors = murderballSurvivors(round);
    if (survivors.length < 2) { err = 'Not enough survivors to advance.'; return b; }
    snapshot(b);
    round.complete = true;
    b.rounds.push(buildMurderballRound(survivors, b.settings.laneCount, b.byeHistory));
    b.currentRound++;
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
    if (id && b.mode === 'murderball' && b.rounds[b.currentRound]) {
      b.rounds[b.currentRound].complete = true;
    }
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
