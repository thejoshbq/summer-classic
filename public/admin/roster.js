// Roster tab — single source of truth for player names.

function renderRoster() {
  const root = document.getElementById('tab-roster');
  const players = Admin.state.players;

  root.innerHTML = `
    <div class="card">
      <h2>Roster <span style="color:#888;font-weight:400">(${players.length})</span></h2>
      <div class="row" style="margin-bottom:12px">
        <div>
          <label for="new-player">Add player</label>
          <input type="text" id="new-player" placeholder="Player name">
        </div>
        <div class="shrink">
          <button id="add-player-btn">Add</button>
        </div>
      </div>

      <div class="list" id="players-list">
        ${players.length === 0
          ? '<div class="empty">No players yet. Add the first one above.</div>'
          : players.map(renderPlayerRow).join('')}
      </div>

      <p style="margin-top:14px;font-size:12px;color:#888">
        Scout score is optional. Used to assign Murderball byes — lowest-scored player gets the bye when a round can't be split evenly.
      </p>
    </div>
  `;

  document.getElementById('add-player-btn').onclick = addPlayer;
  document.getElementById('new-player').addEventListener('keydown', e => {
    if (e.key === 'Enter') addPlayer();
  });

  for (const p of players) {
    document.getElementById(`save-${p.id}`).onclick = () => savePlayer(p.id);
    document.getElementById(`del-${p.id}`).onclick = () => deletePlayer(p.id, p.name);
  }
}

function renderPlayerRow(p) {
  const team = Admin.teamFor(p.id);
  const teamChip = team ? `<span class="chip">${esc(team.name)}</span>` : '';
  const score = p.scoutScore == null ? '' : p.scoutScore;
  return `
    <div class="list-row">
      <div style="flex:1.5">
        <input type="text" id="name-${p.id}" value="${esc(p.name)}">
      </div>
      <div style="flex:0 0 110px">
        <input type="number" id="score-${p.id}" placeholder="Scout" value="${score}" step="0.5">
      </div>
      ${teamChip}
      <button class="sm" id="save-${p.id}">Save</button>
      <button class="sm danger" id="del-${p.id}">Delete</button>
    </div>
  `;
}

async function addPlayer() {
  const input = document.getElementById('new-player');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    Admin.state.players = await Admin.api('POST', '/api/players', { name });
    input.value = '';
    renderRoster();
    // Refresh adjacent tabs that show the roster
    renderTeams?.();
    renderBracket?.();
    renderScoreboard?.();
  } catch (e) { alert(e.message); }
}

async function savePlayer(id) {
  const name = document.getElementById(`name-${id}`).value.trim();
  const scoreVal = document.getElementById(`score-${id}`).value;
  const body = { name };
  if (scoreVal === '') body.scoutScore = null;
  else body.scoutScore = parseFloat(scoreVal);
  try {
    Admin.state.players = await Admin.api('PUT', `/api/players/${id}`, body);
    renderRoster();
    renderTeams?.();
    renderBracket?.();
    renderScoreboard?.();
  } catch (e) { alert(e.message); }
}

async function deletePlayer(id, name) {
  if (!confirm(`Delete "${name}"? They will be removed from any team, bracket entrants, and active at-bat.`)) return;
  try {
    Admin.state.players = await Admin.api('DELETE', `/api/players/${id}`);
    await Admin.loadAll();  // cascade may have changed teams/bracket/game
  } catch (e) { alert(e.message); }
}
