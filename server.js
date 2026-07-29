const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));

app.use('/', require('./routes/hubView'));
app.get('/admin.html', (req, res) => res.redirect('/admin'));

app.use('/api/players', require('./routes/players'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/standings', require('./routes/standingsApi'));
app.use('/api/bracket', require('./routes/bracketApi'));
app.use('/api/game', require('./routes/gameApi'));
app.use('/api/draft', require('./routes/draftApi'));

app.use('/admin', require('./routes/admin'));
app.use('/standings', require('./routes/standingsView'));
app.use('/bracket', require('./routes/bracketView'));
app.use('/scoreboard', require('./routes/scoreboardView'));
app.use('/rotation', require('./routes/rotationView'));
app.use('/draft', require('./routes/draftView'));

app.listen(PORT, () => {
  console.log(`Summer Classic running at http://localhost:${PORT}`);
  console.log(`  Admin:           http://localhost:${PORT}/admin`);
  console.log(`  Standings TV:    http://localhost:${PORT}/standings/display`);
  console.log(`  Bracket TV:      http://localhost:${PORT}/bracket/display`);
  console.log(`  Game TV:         http://localhost:${PORT}/rotation/display`);
  console.log(`  Draft TV:        http://localhost:${PORT}/draft/display`);

  if (process.pkg) {
    require('open')(`http://localhost:${PORT}/`)
      .then(child => child && child.on('error', () => {}))
      .catch(() => {});
  }
});
