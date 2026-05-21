const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const GAME_FILE = path.join(__dirname, 'game.json');

function defaultState() {
  return {
    status: 'setup',
    visitor: { name: '', innings: Array(9).fill(null) },
    home:    { name: '', innings: Array(9).fill(null) },
    currentInning: 1,
    currentHalf: 'top',
    pitcher: '',
    batter: '',
    bases: { first: false, second: false, third: false },
    outs: 0,
    balls: 0,
    inningsPlayed: 0
  };
}

let game = fs.existsSync(GAME_FILE)
  ? JSON.parse(fs.readFileSync(GAME_FILE, 'utf8'))
  : defaultState();

function save() {
  fs.writeFileSync(GAME_FILE, JSON.stringify(game, null, 2));
}

function total(innings) {
  return innings.reduce((s, v) => s + (v === null ? 0 : v), 0);
}

function computedState() {
  const visitorTotal = total(game.visitor.innings);
  const homeTotal    = total(game.home.innings);
  let winner = null;
  if (game.status === 'final') {
    if (visitorTotal > homeTotal) winner = 'visitor';
    else if (homeTotal > visitorTotal) winner = 'home';
  }
  return { ...game, visitorTotal, homeTotal, winner };
}

function ensureLength(arr, len) {
  while (arr.length < len) arr.push(null);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/display'));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/game', (req, res) => res.json(computedState()));

app.post('/api/game/setup', (req, res) => {
  const { visitorName, homeName } = req.body;
  game = defaultState();
  game.status = 'live';
  game.visitor.name = visitorName || '';
  game.home.name    = homeName    || '';
  save();
  res.json(computedState());
});

app.put('/api/game/inning', (req, res) => {
  const { inning, half } = req.body;
  game.currentInning = inning;
  game.currentHalf   = half;
  ensureLength(game.visitor.innings, inning);
  ensureLength(game.home.innings,    inning);
  save();
  res.json(computedState());
});

app.put('/api/game/score', (req, res) => {
  const { team, inningIndex, runs } = req.body;
  ensureLength(game[team].innings, inningIndex + 1);
  game[team].innings[inningIndex] = runs;
  save();
  res.json(computedState());
});

app.put('/api/game/atbat', (req, res) => {
  const { pitcher, batter, bases, outs, balls } = req.body;
  if (pitcher !== undefined) game.pitcher = pitcher;
  if (batter  !== undefined) game.batter  = batter;
  if (bases   !== undefined) game.bases   = bases;
  if (outs    !== undefined) game.outs    = outs;
  if (balls   !== undefined) game.balls   = balls;
  save();
  res.json(computedState());
});

app.post('/api/game/final', (req, res) => {
  game.status        = 'final';
  game.inningsPlayed = game.currentInning;
  save();
  res.json(computedState());
});

app.post('/api/game/reset', (req, res) => {
  game = defaultState();
  save();
  res.json(computedState());
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Scoreboard running on http://localhost:${PORT}`));
