// Teams tab — create teams, assign players from the roster.

function renderTeams() {
  const root = document.getElementById('tab-teams');
  const teams = Admin.state.teams;

  root.innerHTML = `
    <div class="card">
      <h2>Teams <span style="color:#888;font-weight:400">(${teams.length})</span></h2>
      <div class="row" style="margin-bottom:12px">
        <div>
          <label for="new-team">Add team</label>
          <input type="text" id="new-team" placeholder="Team name">
        </div>
        <div class="shrink">
          <button id="add-team-btn">Add</button>
        </div>
      </div>

      ${teams.length === 0
        ? '<div class="empty">No teams yet. Create one above, then assign players from the roster.</div>'
        : teams.map(renderTeamCard).join('')}
    </div>
  `;

  document.getElementById('add-team-btn').onclick = addTeam;
  document.getElementById('new-team').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTeam();
  });

  for (const t of teams) {
    document.getElementById(`team-name-${t.id}`).addEventListener('change', e => {
      saveTeamName(t.id, e.target.value);
    });
    document.getElementById(`team-del-${t.id}`).onclick = () => deleteTeam(t.id, t.name);
    root.querySelectorAll(`[data-team="${t.id}"][data-add]`).forEach(el => {
      el.onclick = () => assignPlayer(t.id, el.dataset.add);
    });
    root.querySelectorAll(`[data-team="${t.id}"][data-remove]`).forEach(el => {
      el.onclick = () => removePlayer(t.id, el.dataset.remove);
    });
  }
}

function renderTeamCard(t) {
  const members = (t.playerIds || [])
    .map(pid => Admin.state.players.find(p => p.id === pid))
    .filter(Boolean);

  const assignedSet = new Set();
  for (const team of Admin.state.teams) for (const pid of team.playerIds || []) assignedSet.add(pid);
  const pool = Admin.state.players.filter(p => !assignedSet.has(p.id));

  return `
    <div class="card" style="margin:14px 0;background:#fafafd">
      <div class="row" style="align-items:center;margin-bottom:10px">
        <input type="text" id="team-name-${t.id}" value="${esc(t.name)}" style="font-weight:700">
        <span class="shrink"><button class="sm danger" id="team-del-${t.id}">Delete team</button></span>
      </div>
      <div class="team-builder">
        <div class="team-roster">
          <div class="pool-title">Roster (${members.length})</div>
          ${members.length === 0
            ? '<div class="empty" style="padding:8px 0">No players yet.</div>'
            : members.map(p => `
              <div class="player-pill">
                <span>${esc(p.name)}</span>
                <button data-team="${t.id}" data-remove="${p.id}" title="Remove">×</button>
              </div>
            `).join('')}
        </div>
        <div class="player-pool">
          <div class="pool-title">Unassigned</div>
          ${pool.length === 0
            ? '<div class="empty" style="padding:8px 0">All players assigned.</div>'
            : pool.map(p => `
              <div class="player-pill">
                <span>${esc(p.name)}</span>
                <button data-team="${t.id}" data-add="${p.id}" title="Add to team">+</button>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;
}

async function addTeam() {
  const input = document.getElementById('new-team');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    Admin.state.teams = await Admin.api('POST', '/api/teams', { name });
    input.value = '';
    renderTeams();
    renderRoster?.();
    renderStandings?.();
    renderScoreboard?.();
  } catch (e) { alert(e.message); }
}

async function saveTeamName(id, name) {
  try {
    Admin.state.teams = await Admin.api('PUT', `/api/teams/${id}`, { name: name.trim() });
    renderTeams();
    renderStandings?.();
    renderScoreboard?.();
  } catch (e) { alert(e.message); }
}

async function deleteTeam(id, name) {
  if (!confirm(`Delete team "${name}"? Their W/L record and scoreboard slot will be cleared. Players stay on the roster.`)) return;
  try {
    Admin.state.teams = await Admin.api('DELETE', `/api/teams/${id}`);
    await Admin.loadAll();
  } catch (e) { alert(e.message); }
}

async function assignPlayer(teamId, playerId) {
  // Pull the player out of any other team first
  const updates = [];
  for (const t of Admin.state.teams) {
    if (t.id === teamId) continue;
    if ((t.playerIds || []).includes(playerId)) {
      updates.push(Admin.api('PUT', `/api/teams/${t.id}`, {
        playerIds: t.playerIds.filter(id => id !== playerId)
      }));
    }
  }
  await Promise.all(updates);
  const team = Admin.state.teams.find(t => t.id === teamId);
  const newIds = [...new Set([...(team.playerIds || []), playerId])];
  Admin.state.teams = await Admin.api('PUT', `/api/teams/${teamId}`, { playerIds: newIds });
  renderTeams();
  renderRoster?.();
}

async function removePlayer(teamId, playerId) {
  const team = Admin.state.teams.find(t => t.id === teamId);
  if (!team) return;
  Admin.state.teams = await Admin.api('PUT', `/api/teams/${teamId}`, {
    playerIds: (team.playerIds || []).filter(id => id !== playerId)
  });
  renderTeams();
  renderRoster?.();
}
