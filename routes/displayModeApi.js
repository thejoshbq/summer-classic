const express = require('express');
const { displayMode } = require('../lib/stores');

const router = express.Router();
const ALLOWED = new Set(['standings', 'bracket', 'scoreboard']);

router.get('/', (req, res) => res.json(displayMode.get()));

router.put('/', async (req, res) => {
  const mode = req.body?.mode;
  if (!ALLOWED.has(mode)) return res.status(400).json({ error: 'mode must be standings|bracket|scoreboard' });
  await displayMode.set({ mode });
  res.json(displayMode.get());
});

module.exports = router;
