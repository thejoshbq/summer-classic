// Roster tab — single source of truth for player names and variation data.

function renderRoster() {
  const root = document.getElementById('tab-roster');
  const players = Admin.state.players;

  // Capture open details state and unsaved input values before re-render
  const openDetails = new Map();
  root.querySelectorAll('details[data-player-id]').forEach(det => {
    if (det.open) {
      const pid = det.dataset.playerId;
      const vals = {};
      det.querySelectorAll('input[data-var-input]').forEach(inp => {
        vals[inp.dataset.varInput] = inp.value;
      });
      openDetails.set(pid, vals);
    }
  });

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
          : players.map(p => renderPlayerRow(p, openDetails)).join('')}
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

  // Clamp variation inputs 0..5 on input event
  root.querySelectorAll('input[data-var-input]').forEach(inp => {
    inp.addEventListener('input', () => {
      const v = parseInt(inp.value, 10);
      if (!isNaN(v)) {
        if (v < 0) inp.value = 0;
        if (v > 5) inp.value = 5;
      }
    });
  });

  // Restore unsaved in-flight values (only for players whose server values
  // haven't changed from what was cached before re-render)
  for (const [pid, vals] of openDetails) {
    root.querySelectorAll(`input[data-var-input][data-pid="${pid}"]`).forEach(inp => {
      const key = inp.dataset.varInput;
      if (vals[key] !== undefined) inp.value = vals[key];
    });
  }
}

function renderPlayerRow(p, openDetails) {
  const team = Admin.teamFor(p.id);
  const teamChip = team ? `<span class="chip">${esc(team.name)}</span>` : '';
  const score = p.scoutScore == null ? '' : p.scoutScore;
  const variations = p.variations || [];

  // Variation inputs (details expandable)
  const varRows = variations.map((v, vi) => {
    const throwInputs = (v.throws || []).map((val, ti) => {
      const key = `${vi}-${ti}`;
      return `<input type="number" min="0" max="5" step="1" value="${val}"
        data-var-input="${key}" data-pid="${esc(p.id)}"
        style="width:44px;padding:4px 6px;background:#fff;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center">`;
    }).join('');

    return `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:12px;color:#555;width:72px;font-weight:500">${esc(v.name)}</span>
        ${throwInputs}
      </div>`;
  }).join('');

  const isOpen = openDetails?.has(p.id) ? ' open' : '';

  return `
    <div class="list-row" style="flex-direction:column;align-items:stretch;gap:6px">
      <div style="display:flex;gap:10px;align-items:center">
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
      <details data-player-id="${esc(p.id)}"${isOpen} style="margin-top:2px">
        <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#555;user-select:none">
          Variations (5 throws each)
        </summary>
        <div style="margin-top:8px;padding:8px 10px;background:#f7f7fa;border:1px solid #e8e8ec;border-radius:4px">
          ${varRows || '<div style="font-size:12px;color:#999">No variation data.</div>'}
        </div>
      </details>
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

  // Serialize ALL variation inputs for this player (even inside closed details)
  const varMap = {};
  document.querySelectorAll(`input[data-var-input][data-pid="${id}"]`).forEach(inp => {
    varMap[inp.dataset.varInput] = inp.value;
  });

  // Reconstruct variations array from inputs
  const player = Admin.state.players.find(p => p.id === id);
  if (player && player.variations) {
    body.variations = player.variations.map((v, vi) => ({
      name: v.name,
      throws: (v.throws || []).map((_, ti) => {
        const key = `${vi}-${ti}`;
        const raw = varMap[key] !== undefined ? varMap[key] : v.throws[ti];
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, Math.min(5, n));
      })
    }));
  }

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
    await Admin.loadAll();  // cascade may have changed teams/bracket/game/draft
  } catch (e) { alert(e.message); }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
