// Scoreboard tab — runs the championship game admin.

function renderScoreboard() {
  const root = document.getElementById('tab-scoreboard');
  const g = Admin.state.game;
  if (!g) { root.innerHTML = '<div class="card">Loading…</div>'; return; }

  if (g.status === 'setup') root.innerHTML = renderSetup();
  else if (g.status === 'live') root.innerHTML = renderLive(g);
  else if (g.status === 'final') root.innerHTML = renderFinal(g);

  attachScoreboardHandlers(g);
}

function teamOptions(selectedId, excludeId) {
  return [
    '<option value="">— pick a team —</option>',
    ...Admin.state.teams
      .filter(t => t.id !== excludeId)
      .map(t => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.name)}</option>`)
  ].join('');
}

function rosterOptionsFor(teamId, selectedPlayerId) {
  const team = Admin.state.teams.find(t => t.id === teamId);
  const ids = team ? (team.playerIds || []) : [];
  const opts = ids
    .map(id => Admin.state.players.find(p => p.id === id))
    .filter(Boolean)
    .map(p => `<option value="${p.id}" ${p.id === selectedPlayerId ? 'selected' : ''}>${esc(p.name)}</option>`);
  return ['<option value="">—</option>', ...opts].join('');
}

function renderSetup() {
  const teamCount = Admin.state.teams.length;
  if (teamCount < 2) {
    return `<div class="card">
      <h2>Championship Game</h2>
      <div class="empty">Add at least two teams (on the Teams tab) before starting a championship game.</div>
    </div>`;
  }
  return `
    <div class="card">
      <h2>Game Setup</h2>
      <div class="row">
        <div>
          <label>Visitor team</label>
          <select id="visitor-sel">${teamOptions(null, null)}</select>
        </div>
        <div>
          <label>Home team</label>
          <select id="home-sel">${teamOptions(null, null)}</select>
        </div>
      </div>
      <div style="margin-top:14px"><button class="primary-action" id="start-btn">Start Championship Game</button></div>
      <p style="margin-top:10px;font-size:12px;color:#888">Pitcher & batter dropdowns will pull from whichever team's roster is on offense or defense for the half-inning.</p>
    </div>`;
}

function renderLive(g) {
  const cols = Math.max(9, g.currentInning);
  const halfLabel = g.currentHalf === 'top' ? 'Top' : 'Bottom';

  const batterTeamId = g.currentHalf === 'top' ? g.visitorTeamId : g.homeTeamId;
  const pitcherTeamId = g.currentHalf === 'top' ? g.homeTeamId : g.visitorTeamId;

  let inningOptions = '';
  for (let i = 1; i <= 12; i++) {
    inningOptions += `<option value="${i}" ${g.currentInning === i ? 'selected' : ''}>${i}</option>`;
  }

  let headCells = '<th class="team">Team</th>';
  for (let i = 1; i <= cols; i++) headCells += `<th>${i}</th>`;
  headCells += '<th>R</th>';

  function teamRow(team, label, totalRuns) {
    const innings = team === 'visitor' ? g.visitorInnings : g.homeInnings;
    let cells = `<td class="team">${esc(label)}</td>`;
    for (let col = 0; col < cols; col++) {
      const isActive =
        (team === 'visitor' && g.currentHalf === 'top' && col === g.currentInning - 1) ||
        (team === 'home' && g.currentHalf === 'bottom' && col === g.currentInning - 1);
      const val = innings[col] != null ? innings[col] : '';
      cells += `<td class="${isActive ? 'active-half' : ''}">
        <input type="number" min="0" data-team="${team}" data-col="${col}" value="${val}" id="inp-${team}-${col}">
      </td>`;
    }
    cells += `<td class="runs">${totalRuns}</td>`;
    return `<tr>${cells}</tr>`;
  }

  const outsHTML = [0,1,2].map(v =>
    `<button class="choice-btn ${g.outs === v ? 'active' : ''}" data-outs="${v}">${v}</button>`).join('');
  const ballsHTML = [0,1,2,3].map(v =>
    `<button class="choice-btn ${g.balls === v ? 'active' : ''}" data-balls="${v}">${v}</button>`).join('');

  const b = g.bases;

  return `
    <div class="card">
      <h2>Inning</h2>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:22px;font-weight:700;color:#F28F16">${halfLabel} ${g.currentInning}</div>
        <button class="primary-action" id="next-half-btn">Next half →</button>
        <div class="row" style="flex:1;min-width:300px">
          <div style="flex:0 0 100px">
            <label>Inning</label>
            <select id="inning-sel">${inningOptions}</select>
          </div>
          <div style="flex:0 0 220px">
            <label>Half</label>
            <div class="choice-grid">
              <button class="choice-btn ${g.currentHalf === 'top' ? 'active' : ''}" data-half="top">Top</button>
              <button class="choice-btn ${g.currentHalf === 'bottom' ? 'active' : ''}" data-half="bottom">Bottom</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Score</h2>
      <div style="overflow-x:auto">
        <table class="linescore-admin">
          <thead><tr>${headCells}</tr></thead>
          <tbody>
            ${teamRow('visitor', g.visitorName || 'Visitor', g.visitorTotal)}
            ${teamRow('home', g.homeName || 'Home', g.homeTotal)}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>At-Bat</h2>
      <div class="row" style="margin-bottom:12px">
        <div>
          <label>Pitcher ${pitcherTeamId ? `(${esc(Admin.teamName(pitcherTeamId))} pitching)` : ''}</label>
          <select id="pitcher-sel">${rosterOptionsFor(pitcherTeamId, g.pitcherPlayerId)}</select>
        </div>
        <div>
          <label>Batter ${batterTeamId ? `(${esc(Admin.teamName(batterTeamId))} batting)` : ''}</label>
          <select id="batter-sel">${rosterOptionsFor(batterTeamId, g.batterPlayerId)}</select>
        </div>
      </div>

      <div class="row">
        <div>
          <label>Bases</label>
          <div class="base-grid">
            <div class="base-btn ${b.first ? 'occupied' : ''}" data-base="first">1B</div>
            <div class="base-btn ${b.second ? 'occupied' : ''}" data-base="second">2B</div>
            <div class="base-btn ${b.third ? 'occupied' : ''}" data-base="third">3B</div>
          </div>
        </div>
        <div>
          <label>Outs</label>
          <div class="choice-grid">${outsHTML}</div>
        </div>
        <div>
          <label>Balls</label>
          <div class="choice-grid">${ballsHTML}</div>
        </div>
      </div>

      <div style="margin-top:12px">
        <button class="subtle" id="clear-btn">Clear bases + reset count</button>
      </div>
    </div>

    <div class="card">
      <h2>Game Actions</h2>
      <div class="row">
        <div class="shrink"><button class="primary-action" id="final-btn">Declare Final</button></div>
        <div class="shrink"><button class="danger" id="reset-btn">Reset Game</button></div>
        <div style="flex:1;text-align:right;font-size:12px;color:#888">
          <a href="/scoreboard/display" target="_blank" style="color:#196A73;font-weight:600">Open scoreboard display →</a>
        </div>
      </div>
    </div>
  `;
}

function renderFinal(g) {
  const winnerName = g.winner ? (g.winner === 'visitor' ? g.visitorName : g.homeName) : 'Tied';
  return `
    <div class="card">
      <div style="text-align:center;padding:18px">
        <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase">Final</div>
        <div style="font-size:28px;font-weight:700;color:#F28F16;margin:8px 0">${esc(winnerName)}</div>
        <div style="font-size:16px;color:#666">${g.visitorTotal} – ${g.homeTotal} · ${g.inningsPlayed} innings</div>
      </div>
      <button class="danger" id="reset-btn">Reset Game</button>
    </div>`;
}

function attachScoreboardHandlers(g) {
  const root = document.getElementById('tab-scoreboard');

  // Setup
  document.getElementById('start-btn')?.addEventListener('click', startGame);

  // Live
  document.getElementById('next-half-btn')?.addEventListener('click', nextHalf);
  document.getElementById('inning-sel')?.addEventListener('change', e => setInning(parseInt(e.target.value), g.currentHalf));
  root.querySelectorAll('[data-half]').forEach(el => el.onclick = () => setInning(g.currentInning, el.dataset.half));
  root.querySelectorAll('.linescore-admin input[data-team]').forEach(inp => {
    inp.addEventListener('change', () => {
      const team = inp.dataset.team;
      const col = parseInt(inp.dataset.col);
      const runs = Math.max(0, parseInt(inp.value) || 0);
      inp.value = runs;
      setScore(team, col, runs);
    });
  });
  document.getElementById('pitcher-sel')?.addEventListener('change', e => setAtBat({ pitcherPlayerId: e.target.value }));
  document.getElementById('batter-sel')?.addEventListener('change', e => setAtBat({ batterPlayerId: e.target.value }));
  root.querySelectorAll('[data-base]').forEach(el => {
    el.onclick = () => {
      const newBases = { ...g.bases, [el.dataset.base]: !g.bases[el.dataset.base] };
      setAtBat({ bases: newBases });
    };
  });
  root.querySelectorAll('[data-outs]').forEach(el => el.onclick = () => setAtBat({ outs: parseInt(el.dataset.outs) }));
  root.querySelectorAll('[data-balls]').forEach(el => el.onclick = () => setAtBat({ balls: parseInt(el.dataset.balls) }));
  document.getElementById('clear-btn')?.addEventListener('click', () => setAtBat({
    bases: { first: false, second: false, third: false }, outs: 0, balls: 0
  }));
  document.getElementById('final-btn')?.addEventListener('click', declareFinal);
  document.getElementById('reset-btn')?.addEventListener('click', resetGame);
}

async function startGame() {
  const visitorTeamId = document.getElementById('visitor-sel').value;
  const homeTeamId = document.getElementById('home-sel').value;
  if (!visitorTeamId || !homeTeamId) return alert('Pick both teams.');
  if (visitorTeamId === homeTeamId) return alert('Visitor and home must be different teams.');
  try {
    Admin.state.game = await Admin.api('POST', '/api/game/setup', { visitorTeamId, homeTeamId });
    renderScoreboard();
  } catch (e) { alert(e.message); }
}

async function nextHalf() {
  const g = Admin.state.game;
  let inning = g.currentInning, half = g.currentHalf;
  if (half === 'top') half = 'bottom';
  else { half = 'top'; inning++; }
  await setInning(inning, half);
}

async function setInning(inning, half) {
  Admin.state.game = await Admin.api('PUT', '/api/game/inning', { inning, half });
  renderScoreboard();
}

async function setScore(team, inningIndex, runs) {
  Admin.state.game = await Admin.api('PUT', '/api/game/score', { team, inningIndex, runs });
  renderScoreboard();
}

async function setAtBat(body) {
  Admin.state.game = await Admin.api('PUT', '/api/game/atbat', body);
  renderScoreboard();
}

async function declareFinal() {
  if (!confirm('Declare this game final?')) return;
  Admin.state.game = await Admin.api('POST', '/api/game/final');
  renderScoreboard();
}

async function resetGame() {
  if (!confirm('Reset the entire game?')) return;
  Admin.state.game = await Admin.api('POST', '/api/game/reset');
  renderScoreboard();
}
