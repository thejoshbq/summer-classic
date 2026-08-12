const express = require('express');
const { game, teams, players, emptyLineup } = require('../lib/stores');

const router = express.Router();

function normalizeLineup(l) {
  if (!l || typeof l !== 'object') return emptyLineup();
  const battingOrder = Array.isArray(l.battingOrder) ? l.battingOrder.filter(x => typeof x === 'string') : [];
  const pitchingRotation = Array.isArray(l.pitchingRotation) ? l.pitchingRotation.filter(x => typeof x === 'string') : [];
  const battingPool = new Set(battingOrder);
  const pitchingPool = new Set(pitchingRotation);
  const battingCurrent = typeof l.battingCurrent === 'string' && battingPool.has(l.battingCurrent) ? l.battingCurrent : null;
  const pitchingCurrent = typeof l.pitchingCurrent === 'string' && pitchingPool.has(l.pitchingCurrent) ? l.pitchingCurrent : null;
  const cleanQueue = (q, pool, current) => {
    const seen = new Set();
    return (Array.isArray(q) ? q : []).filter(id => {
      if (typeof id !== 'string' || id === current || !pool.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  return {
    battingOrder,
    pitchingRotation,
    battingCurrent,
    battingQueue: cleanQueue(l.battingQueue, battingPool, battingCurrent),
    battingStarted: typeof l.battingStarted === 'boolean' ? l.battingStarted : false,
    pitchingCurrent,
    pitchingQueue: cleanQueue(l.pitchingQueue, pitchingPool, pitchingCurrent),
    pitchingStarted: typeof l.pitchingStarted === 'boolean' ? l.pitchingStarted : false
  };
}

function ensureLineups(g) {
  g.visitorLineup = normalizeLineup(g.visitorLineup);
  g.homeLineup = normalizeLineup(g.homeLineup);
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

// Advances a lineup's cycle: pop the next player off the queue into
// `<prefix>Current`, reshuffling the whole pool back into the queue first if
// the previous cycle just ran out — so every pool member plays exactly once
// per cycle before anyone repeats, and the next cycle's order is fresh.
function advance(lineup, prefix, roster) {
  const currentKey = `${prefix}Current`;
  const queueKey = `${prefix}Queue`;
  const lastId = lineup[currentKey];
  if (!roster.length) {
    lineup[currentKey] = null;
    lineup[queueKey] = [];
    return null;
  }
  if (lineup[queueKey].length === 0) {
    lineup[queueKey] = [...roster];
    shuffleAvoidingRepeat(lineup[queueKey], lastId);
  }
  lineup[currentKey] = lineup[queueKey].shift();
  return lineup[currentKey];
}

// Reconciles a lineup's cycle state against a newly-edited pool (add/remove/
// reorder from the admin UI). Before the cycle has actually started, the
// cycle is freely re-derived from the pool as-is — this is what makes a
// pre-game reorder of the captain's submitted order take effect. Once the
// cycle is underway, edits are applied as a real set diff against the OLD
// pool (not against who's already played) so an unrelated reorder can't
// mistake an already-played member for a new addition and replay them.
function reconcilePool(lineup, prefix, oldPool, newPool) {
  const currentKey = `${prefix}Current`;
  const queueKey = `${prefix}Queue`;
  const startedKey = `${prefix}Started`;
  if (!lineup[startedKey]) {
    lineup[currentKey] = newPool[0] || null;
    lineup[queueKey] = newPool.slice(1);
    return;
  }
  const oldSet = new Set(oldPool);
  const newSet = new Set(newPool);
  lineup[queueKey] = lineup[queueKey].filter(id => newSet.has(id));
  for (const id of newPool) {
    if (!oldSet.has(id)) lineup[queueKey].push(id); // genuinely new to the pool
  }
  if (lineup[currentKey] && !newSet.has(lineup[currentKey])) {
    advance(lineup, prefix, newPool);
  }
}

// Keeps g.batterPlayerId/pitcherPlayerId pointed at whichever player the
// active side's lineup cursor currently sits on.
function syncCurrentAtBat(g) {
  const bLineup = lineupOf(g, battingSide(g));
  const pLineup = lineupOf(g, pitchingSide(g));
  g.batterPlayerId = bLineup.battingOrder.length ? bLineup.battingCurrent : null;
  g.pitcherPlayerId = pLineup.pitchingRotation.length ? pLineup.pitchingCurrent : null;
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
  return lineup.battingQueue.slice(0, count).map(id => ({ playerId: id, name: nameOf(id) }));
}

function onDeckPitchers(lineup, count = 2) {
  return lineup.pitchingQueue.slice(0, count).map(id => ({ playerId: id, name: nameOf(id) }));
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
  const raw = Number(req.body?.inning);
  if (!Number.isFinite(raw)) return res.status(400).json({ error: 'inning must be a number' });
  const inning = Math.max(1, Math.min(20, Math.floor(raw)));
  const half = req.body?.half === 'bottom' ? 'bottom' : 'top';
  await game.update(g => {
    ensureLineups(g);
    g.currentInning = inning;
    g.currentHalf = half;
    ensureLength(g.visitorInnings, inning);
    ensureLength(g.homeInnings, inning);
    syncCurrentAtBat(g);
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
      // If the pick is in the pitching pool, fold it into the cycle so the
      // bumped player is deferred (not skipped) and "Next" continues correctly.
      // Off-pool picks (emergency substitutes) are a one-off display override
      // that leaves the cycle untouched.
      const lineup = lineupOf(g, pitchingSide(g));
      if (pitcherPlayerId && lineup.pitchingRotation.includes(pitcherPlayerId) && pitcherPlayerId !== lineup.pitchingCurrent) {
        lineup.pitchingQueue = [lineup.pitchingCurrent, ...lineup.pitchingQueue.filter(id => id !== pitcherPlayerId)].filter(Boolean);
        lineup.pitchingCurrent = pitcherPlayerId;
        lineup.pitchingStarted = true;
      }
    }
    if (batterPlayerId !== undefined) {
      g.batterPlayerId = batterPlayerId || null;
      const lineup = lineupOf(g, battingSide(g));
      if (batterPlayerId && lineup.battingOrder.includes(batterPlayerId) && batterPlayerId !== lineup.battingCurrent) {
        lineup.battingQueue = [lineup.battingCurrent, ...lineup.battingQueue.filter(id => id !== batterPlayerId)].filter(Boolean);
        lineup.battingCurrent = batterPlayerId;
        lineup.battingStarted = true;
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
      reconcilePool(lineup, 'batting', lineup.battingOrder, cleanBatting);
      lineup.battingOrder = cleanBatting;
    }
    if (cleanPitching) {
      reconcilePool(lineup, 'pitching', lineup.pitchingRotation, cleanPitching);
      lineup.pitchingRotation = cleanPitching;
    }
    syncCurrentAtBat(g);
    return g;
  });
  res.json(compose());
});

// Auto-populate a side's batting order or pitching rotation with the full
// team roster in random order, and seed a fresh cycle from that order.
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
      lineup.battingStarted = false;
      lineup.battingCurrent = roster[0] || null;
      lineup.battingQueue = roster.slice(1);
    } else {
      lineup.pitchingRotation = roster;
      lineup.pitchingStarted = false;
      lineup.pitchingCurrent = roster[0] || null;
      lineup.pitchingQueue = roster.slice(1);
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
      advance(bLineup, 'batting', bLineup.battingOrder);
      bLineup.battingStarted = true;
      g.batterPlayerId = bLineup.battingCurrent;
    }
    if (pLineup.pitchingRotation.length) {
      advance(pLineup, 'pitching', pLineup.pitchingRotation);
      pLineup.pitchingStarted = true;
      g.pitcherPlayerId = pLineup.pitchingCurrent;
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
// Exposed only for scripts/verify-lineup-queue.js, so it fuzzes the real
// cycle logic instead of a hand-duplicated copy that can drift out of sync.
// Inert for Express — routers are called as middleware, extra properties are ignored.
module.exports.internals = { advance, reconcilePool, shuffleAvoidingRepeat, normalizeLineup };
