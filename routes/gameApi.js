const express = require('express');
const { game, teams, players, emptyLineup } = require('../lib/stores');

const router = express.Router();

function normalizeLineup(l) {
  if (!l || typeof l !== 'object') return emptyLineup();
  return {
    battingOrder: Array.isArray(l.battingOrder) ? l.battingOrder.filter(x => typeof x === 'string') : [],
    pitchingRotation: Array.isArray(l.pitchingRotation) ? l.pitchingRotation.filter(x => typeof x === 'string') : [],
    battingIndex: Number.isFinite(l.battingIndex) ? Math.max(0, Math.floor(l.battingIndex)) : 0,
    pitchingIndex: Number.isFinite(l.pitchingIndex) ? Math.max(0, Math.floor(l.pitchingIndex)) : 0,
    battingAuto: typeof l.battingAuto === 'boolean' ? l.battingAuto : false,
    pitchingAuto: typeof l.pitchingAuto === 'boolean' ? l.pitchingAuto : false
  };
}

function ensureLineups(g) {
  g.visitorLineup = normalizeLineup(g.visitorLineup);
  g.homeLineup = normalizeLineup(g.homeLineup);
}

// Finds where the player currently at `oldOrder[oldIndex]` landed in `newOrder`
// after a manual add/remove/reorder edit, so cycling position survives the edit
// instead of resetting to the front of the list. If that player was removed,
// walks forward through the original order to the next survivor.
function reindexAfterEdit(oldOrder, oldIndex, newOrder) {
  if (!newOrder.length) return 0;
  const currentId = oldOrder[oldIndex];
  if (currentId) {
    let idx = newOrder.indexOf(currentId);
    if (idx >= 0) return idx;
    for (let step = 1; step <= oldOrder.length; step++) {
      idx = newOrder.indexOf(oldOrder[(oldIndex + step) % oldOrder.length]);
      if (idx >= 0) return idx;
    }
  }
  return 0;
}

// Fisher-Yates shuffle in place. Swaps the just-completed lap's last player
// out of the lead-off slot if they'd otherwise land there again immediately.
function shuffleAvoidingRepeat(arr, lastId) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (arr.length > 1 && arr[0] === lastId) {
    const j = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[j]] = [arr[j], arr[0]];
  }
}

// Keeps g.batterPlayerId/pitcherPlayerId pointed at whichever player the
// active side's lineup cursor currently sits on.
function syncCurrentAtBat(g) {
  const bLineup = lineupOf(g, battingSide(g));
  const pLineup = lineupOf(g, pitchingSide(g));
  if (bLineup.battingOrder.length) {
    if (bLineup.battingIndex >= bLineup.battingOrder.length) bLineup.battingIndex = 0;
    g.batterPlayerId = bLineup.battingOrder[bLineup.battingIndex];
  } else {
    g.batterPlayerId = null;
  }
  if (pLineup.pitchingRotation.length) {
    if (pLineup.pitchingIndex >= pLineup.pitchingRotation.length) pLineup.pitchingIndex = 0;
    g.pitcherPlayerId = pLineup.pitchingRotation[pLineup.pitchingIndex];
  } else {
    g.pitcherPlayerId = null;
  }
}

// Undo history — mirrors routes/draftApi.js's snapshot/history/undo pattern.
function snapshot(g) {
  const copy = JSON.parse(JSON.stringify({ ...g, history: [] }));
  g.history = [{ snapshot: copy }, ...(g.history || [])].slice(0, 12);
}

function battingSide(g) { return g.currentHalf === 'top' ? 'visitor' : 'home'; }
function pitchingSide(g) { return g.currentHalf === 'top' ? 'home' : 'visitor'; }
function lineupOf(g, side) { return side === 'visitor' ? g.visitorLineup : g.homeLineup; }
function teamIdOf(g, side) { return side === 'visitor' ? g.visitorTeamId : g.homeTeamId; }

function nameOf(playerId) {
  const p = players.get().find(x => x.id === playerId);
  return p?.name || '';
}

function onDeck(lineup, count = 2) {
  const order = lineup.battingOrder;
  if (!order.length) return [];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const idx = (lineup.battingIndex + i) % order.length;
    out.push({ playerId: order[idx], name: nameOf(order[idx]) });
  }
  return out;
}

function onDeckPitchers(lineup, count = 2) {
  const order = lineup.pitchingRotation;
  if (!order.length) return [];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const idx = (lineup.pitchingIndex + i) % order.length;
    out.push({ playerId: order[idx], name: nameOf(order[idx]) });
  }
  return out;
}

function compose() {
  const g = game.get();
  ensureLineups(g);
  const visitorTeam = teams.get().find(t => t.id === g.visitorTeamId);
  const homeTeam = teams.get().find(t => t.id === g.homeTeamId);
  const pitcher = players.get().find(p => p.id === g.pitcherPlayerId);
  const batter = players.get().find(p => p.id === g.batterPlayerId);
  const visitorTotal = (g.visitorInnings || []).reduce((s, v) => s + (v || 0), 0);
  const homeTotal = (g.homeInnings || []).reduce((s, v) => s + (v || 0), 0);
  let winner = null;
  if (g.status === 'final') {
    if (visitorTotal > homeTotal) winner = 'visitor';
    else if (homeTotal > visitorTotal) winner = 'home';
  }
  const bSide = battingSide(g);
  const pSide = pitchingSide(g);
  return {
    ...g,
    gameType: g.gameType === 'championship' ? 'championship' : 'standard',
    history: undefined, // never ship undo snapshots to display pollers
    historyDepth: (g.history || []).length,
    visitorName: visitorTeam?.name || '',
    homeName: homeTeam?.name || '',
    pitcherName: pitcher?.name || g.pitcherFallback || '',
    batterName: batter?.name || g.batterFallback || '',
    visitorTotal,
    homeTotal,
    winner,
    battingSide: bSide,
    pitchingSide: pSide,
    battingTeamId: teamIdOf(g, bSide),
    pitchingTeamId: teamIdOf(g, pSide),
    onDeckBatters: onDeck(lineupOf(g, bSide)),
    onDeckPitchers: onDeckPitchers(lineupOf(g, pSide))
  };
}

function ensureLength(arr, len) {
  while (arr.length < len) arr.push(null);
}

router.get('/', (req, res) => res.json(compose()));

router.post('/setup', async (req, res) => {
  const { visitorTeamId, homeTeamId, gameType } = req.body || {};
  const ts = teams.get();
  if (!ts.find(t => t.id === visitorTeamId) || !ts.find(t => t.id === homeTeamId)) {
    return res.status(400).json({ error: 'Pick visitor and home teams' });
  }
  if (visitorTeamId === homeTeamId) {
    return res.status(400).json({ error: 'Visitor and home must differ' });
  }
  await game.update(g => ({
    status: 'live',
    gameType: gameType === 'championship' ? 'championship' : 'standard',
    visitorTeamId,
    homeTeamId,
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
    strikes: 0,
    balls: 0,
    inningsPlayed: 0,
    visitorLineup: emptyLineup(),
    homeLineup: emptyLineup(),
    history: []
  }));
  res.json(compose());
});

router.put('/inning', async (req, res) => {
  const inning = Math.max(1, Math.min(20, Math.floor(Number(req.body?.inning))));
  const half = req.body?.half === 'bottom' ? 'bottom' : 'top';
  await game.update(g => {
    g.currentInning = inning;
    g.currentHalf = half;
    ensureLength(g.visitorInnings, inning);
    ensureLength(g.homeInnings, inning);
    return g;
  });
  res.json(compose());
});

router.put('/score', async (req, res) => {
  const { team, inningIndex, runs } = req.body || {};
  if (team !== 'visitor' && team !== 'home') return res.status(400).json({ error: 'team must be visitor|home' });
  const idx = Math.max(0, Math.floor(Number(inningIndex)));
  const r = Math.max(0, Math.floor(Number(runs)));
  await game.update(g => {
    const arr = team === 'visitor' ? g.visitorInnings : g.homeInnings;
    ensureLength(arr, idx + 1);
    arr[idx] = r;
    return g;
  });
  res.json(compose());
});

router.put('/atbat', async (req, res) => {
  const { pitcherPlayerId, batterPlayerId, pitcherFallback, batterFallback, bases, outs, strikes, balls } = req.body || {};
  await game.update(g => {
    ensureLineups(g);
    if (pitcherPlayerId !== undefined) {
      g.pitcherPlayerId = pitcherPlayerId || null;
      // Jump the pitching cursor so subsequent "Next" continues from this player.
      if (pitcherPlayerId) {
        const lineup = lineupOf(g, pitchingSide(g));
        const idx = lineup.pitchingRotation.indexOf(pitcherPlayerId);
        if (idx >= 0) lineup.pitchingIndex = idx;
      }
    }
    if (batterPlayerId !== undefined) {
      g.batterPlayerId = batterPlayerId || null;
      if (batterPlayerId) {
        const lineup = lineupOf(g, battingSide(g));
        const idx = lineup.battingOrder.indexOf(batterPlayerId);
        if (idx >= 0) lineup.battingIndex = idx;
      }
    }
    if (pitcherFallback !== undefined) g.pitcherFallback = String(pitcherFallback || '');
    if (batterFallback !== undefined) g.batterFallback = String(batterFallback || '');
    if (bases !== undefined) g.bases = {
      first: !!bases.first, second: !!bases.second, third: !!bases.third
    };
    if (outs !== undefined) g.outs = Math.max(0, Math.min(2, Math.floor(Number(outs))));
    if (strikes !== undefined) g.strikes = Math.max(0, Math.min(2, Math.floor(Number(strikes))));
    if (balls !== undefined) g.balls = Math.max(0, Math.min(3, Math.floor(Number(balls))));
    return g;
  });
  res.json(compose());
});

router.put('/lineup', async (req, res) => {
  const { side, battingOrder, pitchingRotation } = req.body || {};
  if (side !== 'visitor' && side !== 'home') {
    return res.status(400).json({ error: 'side must be visitor|home' });
  }
  const teamId = side === 'visitor' ? game.get().visitorTeamId : game.get().homeTeamId;
  const team = teams.get().find(t => t.id === teamId);
  const allowed = new Set(team ? (team.playerIds || []) : players.get().map(p => p.id));
  const cleanBatting = Array.isArray(battingOrder) ? battingOrder.filter(id => allowed.has(id)) : null;
  const cleanPitching = Array.isArray(pitchingRotation) ? pitchingRotation.filter(id => allowed.has(id)) : null;

  await game.update(g => {
    ensureLineups(g);
    const lineup = lineupOf(g, side);
    if (cleanBatting) {
      lineup.battingIndex = reindexAfterEdit(lineup.battingOrder, lineup.battingIndex, cleanBatting);
      lineup.battingOrder = cleanBatting;
      lineup.battingAuto = false; // this endpoint is the manual-edit surface
    }
    if (cleanPitching) {
      lineup.pitchingIndex = reindexAfterEdit(lineup.pitchingRotation, lineup.pitchingIndex, cleanPitching);
      lineup.pitchingRotation = cleanPitching;
      lineup.pitchingAuto = false;
    }
    syncCurrentAtBat(g);
    return g;
  });
  res.json(compose());
});

// Auto-populate a side's batting order or pitching rotation with the full
// team roster in random order. Marks that side `*Auto: true` so next-atbat
// reshuffles it once every player has had a turn instead of just wrapping.
router.post('/lineup/randomize', async (req, res) => {
  const { side, kind } = req.body || {};
  if (side !== 'visitor' && side !== 'home') {
    return res.status(400).json({ error: 'side must be visitor|home' });
  }
  if (kind !== 'battingOrder' && kind !== 'pitchingRotation') {
    return res.status(400).json({ error: 'kind must be battingOrder|pitchingRotation' });
  }
  const teamId = side === 'visitor' ? game.get().visitorTeamId : game.get().homeTeamId;
  const team = teams.get().find(t => t.id === teamId);
  const roster = [...(team?.playerIds || [])];
  if (!roster.length) {
    return res.status(400).json({ error: 'That team has no roster to randomize.' });
  }
  shuffleAvoidingRepeat(roster, null);

  await game.update(g => {
    ensureLineups(g);
    const lineup = lineupOf(g, side);
    if (kind === 'battingOrder') {
      lineup.battingOrder = roster;
      lineup.battingIndex = 0;
      lineup.battingAuto = true;
    } else {
      lineup.pitchingRotation = roster;
      lineup.pitchingIndex = 0;
      lineup.pitchingAuto = true;
    }
    syncCurrentAtBat(g);
    return g;
  });
  res.json(compose());
});

router.post('/next-atbat', async (req, res) => {
  let err = null;
  await game.update(g => {
    ensureLineups(g);
    snapshot(g);
    const bLineup = lineupOf(g, battingSide(g));
    const pLineup = lineupOf(g, pitchingSide(g));
    if (!bLineup.battingOrder.length && !pLineup.pitchingRotation.length) {
      err = 'Set a batting order and pitching rotation first.';
      g.history.shift(); // undo the snapshot we took above — nothing happened
      return g;
    }
    if (bLineup.battingOrder.length) {
      const lastId = bLineup.battingOrder[bLineup.battingIndex];
      const next = bLineup.battingIndex + 1;
      if (next >= bLineup.battingOrder.length) {
        if (bLineup.battingAuto) shuffleAvoidingRepeat(bLineup.battingOrder, lastId);
        bLineup.battingIndex = 0;
      } else {
        bLineup.battingIndex = next;
      }
      g.batterPlayerId = bLineup.battingOrder[bLineup.battingIndex];
    }
    if (pLineup.pitchingRotation.length) {
      const lastId = pLineup.pitchingRotation[pLineup.pitchingIndex];
      const next = pLineup.pitchingIndex + 1;
      if (next >= pLineup.pitchingRotation.length) {
        if (pLineup.pitchingAuto) shuffleAvoidingRepeat(pLineup.pitchingRotation, lastId);
        pLineup.pitchingIndex = 0;
      } else {
        pLineup.pitchingIndex = next;
      }
      g.pitcherPlayerId = pLineup.pitchingRotation[pLineup.pitchingIndex];
    }
    return g;
  });
  if (err) return res.status(400).json({ error: err });
  res.json(compose());
});

router.post('/undo', async (req, res) => {
  let err = null;
  await game.update(g => {
    if (!g.history || !g.history.length) {
      err = 'Nothing to undo.';
      return g;
    }
    const [{ snapshot: prev }, ...rest] = g.history;
    return { ...prev, history: rest };
  });
  if (err) return res.status(400).json({ error: err });
  res.json(compose());
});

router.post('/final', async (req, res) => {
  await game.update(g => {
    g.status = 'final';
    g.inningsPlayed = g.currentInning;
    return g;
  });
  res.json(compose());
});

router.post('/reset', async (req, res) => {
  await game.set({
    status: 'setup',
    gameType: 'standard',
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
    strikes: 0,
    balls: 0,
    inningsPlayed: 0,
    visitorLineup: emptyLineup(),
    homeLineup: emptyLineup(),
    history: []
  });
  res.json(compose());
});

module.exports = router;
