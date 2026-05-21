const express = require('express');
const { standings, teams } = require('../lib/stores');

const router = express.Router();

function compose() {
  const s = standings.get();
  const ts = teams.get();
  const enriched = ts.map(t => {
    const rec = (s.records && s.records[t.id]) || { w: 0, l: 0 };
    return { id: t.id, name: t.name, w: rec.w, l: rec.l, points: rec.w * 3 };
  });
  enriched.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  enriched.forEach((row, i) => { row.seed = i + 1; });
  return { day: s.day, teams: enriched };
}

router.get('/', (req, res) => res.json(compose()));

router.put('/day', async (req, res) => {
  const day = Math.min(6, Math.max(1, Math.floor(Number(req.body?.day))));
  await standings.update(s => { s.day = day; return s; });
  res.json(compose());
});

router.put('/team/:id', async (req, res) => {
  const id = req.params.id;
  if (!teams.get().find(t => t.id === id)) {
    return res.status(404).json({ error: 'team not found' });
  }
  await standings.update(s => {
    if (!s.records) s.records = {};
    const rec = s.records[id] || { w: 0, l: 0 };
    if (req.body?.w !== undefined) rec.w = Math.max(0, Math.floor(Number(req.body.w)));
    if (req.body?.l !== undefined) rec.l = Math.max(0, Math.floor(Number(req.body.l)));
    s.records[id] = rec;
    return s;
  });
  res.json(compose());
});

module.exports = router;
