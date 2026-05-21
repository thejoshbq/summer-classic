const express = require('express');
const { players, teams, bracket, game } = require('../lib/stores');
const { uid } = require('../lib/ids');

const router = express.Router();

router.get('/', (req, res) => res.json(players.get()));

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const list = await players.update(curr => {
    curr.push({ id: uid(), name, scoutScore: null });
    return curr;
  });
  res.status(201).json(list);
});

router.put('/:id', async (req, res) => {
  let updated;
  const list = await players.update(curr => {
    const p = curr.find(x => x.id === req.params.id);
    if (!p) return curr;
    if (req.body?.name !== undefined) p.name = String(req.body.name).trim();
    if (req.body?.scoutScore !== undefined) {
      const n = Number(req.body.scoutScore);
      p.scoutScore = Number.isFinite(n) ? n : null;
    }
    updated = p;
    return curr;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(list);
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  let removed = false;
  await players.update(curr => {
    const idx = curr.findIndex(p => p.id === id);
    if (idx === -1) return curr;
    curr.splice(idx, 1);
    removed = true;
    return curr;
  });
  if (!removed) return res.status(404).json({ error: 'not found' });

  // Cascade: drop from team rosters
  await teams.update(curr => {
    for (const t of curr) {
      t.playerIds = (t.playerIds || []).filter(pid => pid !== id);
    }
    return curr;
  });

  // Cascade: drop from bracket entrants if not yet generated
  await bracket.update(curr => {
    if (!curr.generated) {
      curr.entrantPlayerIds = (curr.entrantPlayerIds || []).filter(pid => pid !== id);
    }
    return curr;
  });

  // Cascade: clear from scoreboard at-bat if currently set
  await game.update(curr => {
    if (curr.pitcherPlayerId === id) curr.pitcherPlayerId = null;
    if (curr.batterPlayerId === id) curr.batterPlayerId = null;
    return curr;
  });

  res.json(players.get());
});

module.exports = router;
