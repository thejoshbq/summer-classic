const express = require('express');
const { game, teams, players } = require('../lib/stores');

const router = express.Router();

function compose() {
  const g = game.get();
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
  return {
    ...g,
    visitorName: visitorTeam?.name || '',
    homeName: homeTeam?.name || '',
    pitcherName: pitcher?.name || g.pitcherFallback || '',
    batterName: batter?.name || g.batterFallback || '',
    visitorTotal,
    homeTotal,
    winner
  };
}

function ensureLength(arr, len) {
  while (arr.length < len) arr.push(null);
}

router.get('/', (req, res) => res.json(compose()));

router.post('/setup', async (req, res) => {
  const { visitorTeamId, homeTeamId } = req.body || {};
  const ts = teams.get();
  if (!ts.find(t => t.id === visitorTeamId) || !ts.find(t => t.id === homeTeamId)) {
    return res.status(400).json({ error: 'Pick visitor and home teams' });
  }
  if (visitorTeamId === homeTeamId) {
    return res.status(400).json({ error: 'Visitor and home must differ' });
  }
  await game.update(g => ({
    status: 'live',
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
    balls: 0,
    inningsPlayed: 0
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
  const { pitcherPlayerId, batterPlayerId, pitcherFallback, batterFallback, bases, outs, balls } = req.body || {};
  await game.update(g => {
    if (pitcherPlayerId !== undefined) g.pitcherPlayerId = pitcherPlayerId || null;
    if (batterPlayerId !== undefined) g.batterPlayerId = batterPlayerId || null;
    if (pitcherFallback !== undefined) g.pitcherFallback = String(pitcherFallback || '');
    if (batterFallback !== undefined) g.batterFallback = String(batterFallback || '');
    if (bases !== undefined) g.bases = {
      first: !!bases.first, second: !!bases.second, third: !!bases.third
    };
    if (outs !== undefined) g.outs = Math.max(0, Math.min(2, Math.floor(Number(outs))));
    if (balls !== undefined) g.balls = Math.max(0, Math.min(3, Math.floor(Number(balls))));
    return g;
  });
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
  });
  res.json(compose());
});

module.exports = router;
