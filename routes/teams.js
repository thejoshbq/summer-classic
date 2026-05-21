const express = require('express');
const { teams, players, standings, game } = require('../lib/stores');
const { uid } = require('../lib/ids');

const router = express.Router();

router.get('/', (req, res) => res.json(teams.get()));

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const list = await teams.update(curr => {
    curr.push({ id: uid(), name, playerIds: [] });
    return curr;
  });
  res.status(201).json(list);
});

router.put('/:id', async (req, res) => {
  const id = req.params.id;
  let updated;
  const list = await teams.update(curr => {
    const t = curr.find(x => x.id === id);
    if (!t) return curr;
    if (req.body?.name !== undefined) t.name = String(req.body.name).trim();
    if (Array.isArray(req.body?.playerIds)) {
      const validIds = new Set(players.get().map(p => p.id));
      t.playerIds = req.body.playerIds.filter(pid => validIds.has(pid));
    }
    updated = t;
    return curr;
  });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(list);
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  let removed = false;
  await teams.update(curr => {
    const idx = curr.findIndex(t => t.id === id);
    if (idx === -1) return curr;
    curr.splice(idx, 1);
    removed = true;
    return curr;
  });
  if (!removed) return res.status(404).json({ error: 'not found' });

  // Cascade: drop from standings
  await standings.update(curr => {
    if (curr.records && curr.records[id]) delete curr.records[id];
    return curr;
  });

  // Cascade: clear from scoreboard
  await game.update(curr => {
    if (curr.visitorTeamId === id) curr.visitorTeamId = null;
    if (curr.homeTeamId === id) curr.homeTeamId = null;
    return curr;
  });

  res.json(teams.get());
});

module.exports = router;
