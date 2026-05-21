// Standings tab — set current day, edit each team's W/L. Points computed server-side.

function renderStandings() {
  const root = document.getElementById('tab-standings');
  const data = Admin.state.standings;  // { day, teams: [...] }

  root.innerHTML = `
    <div class="card">
      <h2>Current Day</h2>
      <div class="row" style="align-items:end">
        <div style="flex:0 0 120px">
          <label for="day-input">Day (1–6)</label>
          <input type="number" id="day-input" min="1" max="6" value="${data.day}">
        </div>
        <div class="shrink">
          <button id="save-day-btn">Save</button>
          <span class="flash" id="day-flash">Saved</span>
        </div>
        <div style="flex:1;text-align:right;font-size:12px;color:#888">
          <a href="/standings/display" target="_blank" style="color:#196A73;font-weight:600">Open standings display →</a>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Team Records</h2>
      ${data.teams.length === 0
        ? '<div class="empty">No teams yet. Add teams on the Teams tab first.</div>'
        : `
          <div class="standings-row" style="font-size:11px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding-bottom:6px;border-bottom:1px solid #eee;margin-bottom:6px">
            <span>Team</span>
            <span style="text-align:center">W</span>
            <span style="text-align:center">L</span>
            <span style="text-align:center">Pts</span>
            <span></span>
          </div>
          <div class="list">
            ${data.teams.map(renderTeamRecord).join('')}
          </div>
        `}
    </div>
  `;

  document.getElementById('save-day-btn').onclick = saveDay;

  for (const t of data.teams) {
    document.getElementById(`w-${t.id}`).addEventListener('input', () => recalcPts(t.id));
    document.getElementById(`save-${t.id}`).onclick = () => saveTeamRecord(t.id);
  }
}

function renderTeamRecord(t) {
  return `
    <div class="standings-row">
      <span class="name">${esc(t.name)}</span>
      <input type="number" min="0" id="w-${t.id}" value="${t.w}">
      <input type="number" min="0" id="l-${t.id}" value="${t.l}">
      <span class="pts" id="pts-${t.id}">${t.points}</span>
      <button class="sm" id="save-${t.id}">Save</button>
    </div>
  `;
}

function recalcPts(id) {
  const w = Math.max(0, parseInt(document.getElementById(`w-${id}`).value) || 0);
  document.getElementById(`pts-${id}`).textContent = w * 3;
}

async function saveDay() {
  const day = parseInt(document.getElementById('day-input').value);
  Admin.state.standings = await Admin.api('PUT', '/api/standings/day', { day });
  flash('day-flash');
}

async function saveTeamRecord(id) {
  const w = Math.max(0, parseInt(document.getElementById(`w-${id}`).value) || 0);
  const l = Math.max(0, parseInt(document.getElementById(`l-${id}`).value) || 0);
  Admin.state.standings = await Admin.api('PUT', `/api/standings/team/${id}`, { w, l });
  renderStandings();
}

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1200);
}
