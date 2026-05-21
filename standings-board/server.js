const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'standings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let state = { day: 1, teams: [] };

if (fs.existsSync(DATA_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    state = { day: 1, teams: [] };
  }
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function sorted(teams) {
  return [...teams]
    .sort((a, b) => (b.w * 3) - (a.w * 3))
    .map((t, i) => ({ ...t, points: t.w * 3, seed: i + 1 }));
}

app.get('/', (req, res) => res.redirect('/display'));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/standings', (req, res) => {
  res.json({ day: state.day, teams: sorted(state.teams) });
});

app.post('/api/standings/teams', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  const team = { id: crypto.randomUUID(), name: name.trim(), w: 0, l: 0 };
  state.teams.push(team);
  save();
  res.status(201).json({ day: state.day, teams: sorted(state.teams) });
});

app.put('/api/standings/teams/:id', (req, res) => {
  const team = state.teams.find(t => t.id === req.params.id);
  if (!team) return res.status(404).json({ error: 'not found' });

  const { name, w, l } = req.body;
  if (name !== undefined) team.name = String(name).trim();
  if (w !== undefined) team.w = Math.max(0, Math.floor(Number(w)));
  if (l !== undefined) team.l = Math.max(0, Math.floor(Number(l)));
  save();
  res.json({ day: state.day, teams: sorted(state.teams) });
});

app.delete('/api/standings/teams/:id', (req, res) => {
  const idx = state.teams.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  state.teams.splice(idx, 1);
  save();
  res.json({ day: state.day, teams: sorted(state.teams) });
});

app.put('/api/standings/day', (req, res) => {
  const day = Math.min(6, Math.max(1, Math.floor(Number(req.body.day))));
  state.day = day;
  save();
  res.json({ day: state.day, teams: sorted(state.teams) });
});

app.listen(PORT, () => console.log(`Standings board running at http://localhost:${PORT}`));
