const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));

app.get('/', (req, res) => res.redirect('/tv/main'));
app.get('/admin.html', (req, res) => res.redirect('/admin'));

app.use('/api/players', require('./routes/players'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/standings', require('./routes/standingsApi'));
app.use('/api/bracket', require('./routes/bracketApi'));
app.use('/api/game', require('./routes/gameApi'));
app.use('/api/display-mode', require('./routes/displayModeApi'));

app.use('/admin', require('./routes/admin'));
app.use('/standings', require('./routes/standingsView'));
app.use('/bracket', require('./routes/bracketView'));
app.use('/scoreboard', require('./routes/scoreboardView'));
app.use('/tv', require('./routes/tv'));

app.listen(PORT, () => {
  console.log(`Summer Classic running at http://localhost:${PORT}`);
  console.log(`  Admin:           http://localhost:${PORT}/admin`);
  console.log(`  Standings TV:    http://localhost:${PORT}/standings/display`);
  console.log(`  Bracket TV:      http://localhost:${PORT}/bracket/display`);
  console.log(`  Scoreboard TV:   http://localhost:${PORT}/scoreboard/display`);
  console.log(`  Flex TV:         http://localhost:${PORT}/tv/main`);
});
