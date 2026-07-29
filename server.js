require('./lib/crashLog').install();

// The packaged Windows exe is built as a GUI-subsystem binary so operators
// never see a console window. That leaves fds 1 and 2 pointing at nothing, and
// an unhandled 'error' on either stream would kill the process on the first
// console.log — the exact crash this app was shipped with. crashLog writes to a
// file when packaged, so losing console output costs no diagnostics.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

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

// The packaged app has no console window to close, so the hub page needs a way
// to stop the server. process.exit fires the 'exit' handler below, which clears
// the single-instance marker.
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true });
  res.on('finish', () => process.exit(0));
});

app.use('/admin', require('./routes/admin'));
app.use('/standings', require('./routes/standingsView'));
app.use('/bracket', require('./routes/bracketView'));
app.use('/scoreboard', require('./routes/scoreboardView'));
app.use('/rotation', require('./routes/rotationView'));
app.use('/draft', require('./routes/draftView'));

const singleInstance = process.pkg ? require('./lib/singleInstance') : null;

async function start() {
  if (singleInstance) await singleInstance.killStaleInstance();

  const server = app.listen(PORT, () => {
    console.log(`Summer Classic running at http://localhost:${PORT}`);
    console.log(`  Admin:           http://localhost:${PORT}/admin`);
    console.log(`  Standings TV:    http://localhost:${PORT}/standings/display`);
    console.log(`  Bracket TV:      http://localhost:${PORT}/bracket/display`);
    console.log(`  Game TV:         http://localhost:${PORT}/rotation/display`);
    console.log(`  Draft TV:        http://localhost:${PORT}/draft/display`);

    if (singleInstance) singleInstance.writePidFile();

    if (process.pkg && !process.env.SUMMER_CLASSIC_NO_BROWSER) {
      require('open')(`http://localhost:${PORT}/`)
        .then(child => child && child.on('error', () => {}))
        .catch(() => {});
    }
  });

  server.on('error', err => {
    console.error(`Summer Classic failed to start: ${err.message}`);
    process.exit(1);
  });

  process.on('exit', () => {
    if (singleInstance) singleInstance.clearPidFile();
  });

  // Node's default disposition for these signals terminates the process
  // without firing 'exit', so the marker file would never get cleaned up
  // unless we explicitly exit ourselves.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => process.exit(0));
  }
}

start();
