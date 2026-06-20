// Draft tab — captain snake-draft admin UI.
// Polls /api/draft/view every 5s to stay in sync with picks made on the
// display page. Timer is cleaned up on tab leave via tabCleanups in main.js.

let draftRefreshTimer = null;

function renderDraft() {
  // Clear any previous timer before starting a new one
  if (draftRefreshTimer) { clearInterval(draftRefreshTimer); draftRefreshTimer = null; }

  const root = document.getElementById('tab-draft');
  if (!root) return;

  _renderDraftContent(root);

  // Self-refresh every 5s — bi-directional with /draft/display page picks
  draftRefreshTimer = setInterval(async () => {
    try {
      const data = await Admin.api('GET', '/api/draft/view');
      // Update state without calling emit() (avoid stomping Roster tab mid-typing)
      Admin.state.draft = data.draft;
      Admin.state.players = data.players;
      Admin.state.teams = data.teams;
      _renderDraftContent(root);
    } catch (e) {
      console.error('draft refresh error', e);
    }
  }, 5000);
}

function draftCleanup() {
  if (draftRefreshTimer) { clearInterval(draftRefreshTimer); draftRefreshTimer = null; }
}

function _renderDraftContent(root) {
  const d = Admin.state.draft;
  if (!d) { root.innerHTML = '<div class="card">Loading…</div>'; return; }

  // Pending-commit banner visible from other tabs
  const pendingBanner = d.status === 'ended'
    ? `<div style="background:#fff7eb;border:1px solid #F28F16;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;font-weight:600;color:#b36b00">
         Uncommitted draft pending — review &amp; commit below.
       </div>`
    : '';

  if (d.status === 'setup') {
    root.innerHTML = `<div class="card">${pendingBanner}${_renderSetup(d)}</div>`;
    _wireSetup(root, d);
  } else if (d.status === 'active') {
    root.innerHTML = `<div class="card">${_renderActive(d)}</div>`;
    _wireActive(root, d);
  } else if (d.status === 'ended') {
    root.innerHTML = `<div class="card">${pendingBanner}${_renderEnded(d)}</div>`;
    _wireEnded(root, d);
  } else if (d.status === 'committed') {
    root.innerHTML = `<div class="card">${_renderCommitted(d)}</div>`;
    _wireCommitted(root, d);
  }
}

// ── Setup view ─────────────────────────────────────────────────────────

function _renderSetup(d) {
  const allTeams = Admin.state.teams || [];
  const allPlayers = Admin.state.players || [];
  const teamOrder = d.teamOrder || [];
  const eligible = d.eligiblePlayerIds || [];

  const canStart = teamOrder.length >= 2 && eligible.length >= teamOrder.length;

  // Ordered chips with ▲▼
  const orderedList = teamOrder.length === 0
    ? '<div class="empty">No teams selected. Click a team below to add it.</div>'
    : teamOrder.map((tid, i) => {
        const t = allTeams.find(x => x.id === tid);
        const name = t ? t.name : tid;
        return `
          <div class="entrant-card" style="background:#fff">
            <span class="seed-pill">${i + 1}</span>
            <span style="flex:1">${esc(name)}</span>
            <button class="sm subtle" data-move-team-up="${tid}" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="sm subtle" data-move-team-down="${tid}" ${i === teamOrder.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="sm danger" data-remove-team="${tid}">✕</button>
          </div>`;
      }).join('');

  const unselected = allTeams.filter(t => !teamOrder.includes(t.id));
  const availableList = unselected.length === 0
    ? '<div class="empty">All teams added.</div>'
    : unselected.map(t => `
        <div class="entrant-card" style="cursor:pointer" data-add-team="${esc(t.id)}">
          <span style="flex:1">${esc(t.name)}</span>
          <span style="color:#196A73;font-weight:700;font-size:16px">+</span>
        </div>`).join('');

  const playerChecks = allPlayers.map(p => {
    const checked = eligible.includes(p.id) ? 'checked' : '';
    return `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px">
        <input type="checkbox" data-eligible-player="${esc(p.id)}" ${checked} style="width:auto;transform:scale(1.2)">
        ${esc(p.name)}
      </label>`;
  }).join('');

  return `
    <h2>Draft Setup</h2>

    <label>Draft Order (top = picks first in round 1)</label>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
      ${orderedList}
    </div>

    <label>Available Teams</label>
    <div class="entrant-grid" style="margin-bottom:20px">
      ${availableList}
    </div>

    <label>Eligible Players (${eligible.length} / ${allPlayers.length})</label>
    <div style="columns:2;gap:16px;margin-bottom:16px;background:#f7f7fa;border:1px solid #e8e8ec;border-radius:5px;padding:10px 14px">
      ${playerChecks || '<div class="empty">No players on roster yet.</div>'}
    </div>

    ${eligible.length > 0 && eligible.length % teamOrder.length !== 0 && teamOrder.length > 0
      ? `<div style="font-size:12px;color:#888;margin-bottom:10px">
           Note: ${eligible.length} players ÷ ${teamOrder.length} teams = ${Math.floor(eligible.length / teamOrder.length)} full rounds + ${eligible.length % teamOrder.length} extra pick(s).
         </div>`
      : ''}

    <div class="row">
      <div class="shrink">
        <button class="primary-action" id="start-draft-btn" ${canStart ? '' : 'disabled'}>Start Draft</button>
      </div>
      <div style="font-size:12px;color:#888;padding-bottom:4px">
        Snake order — the team that picks last in round 1 picks first in round 2.
      </div>
    </div>
    <a href="/draft/display" target="_blank" style="display:block;margin-top:10px;font-size:12px;color:#196A73;font-weight:600">Open draft display →</a>
  `;
}

function _wireSetup(root, d) {
  root.querySelectorAll('[data-add-team]').forEach(el => {
    el.onclick = () => _updateSettings({ teamOrder: [...(d.teamOrder || []), el.dataset.addTeam] });
  });
  root.querySelectorAll('[data-remove-team]').forEach(el => {
    el.onclick = () => _updateSettings({ teamOrder: (d.teamOrder || []).filter(id => id !== el.dataset.removeTeam) });
  });
  root.querySelectorAll('[data-move-team-up]').forEach(el => {
    el.onclick = () => {
      const order = [...(d.teamOrder || [])];
      const idx = order.indexOf(el.dataset.moveTeamUp);
      if (idx > 0) { [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]; }
      _updateSettings({ teamOrder: order });
    };
  });
  root.querySelectorAll('[data-move-team-down]').forEach(el => {
    el.onclick = () => {
      const order = [...(d.teamOrder || [])];
      const idx = order.indexOf(el.dataset.moveTeamDown);
      if (idx < order.length - 1) { [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]]; }
      _updateSettings({ teamOrder: order });
    };
  });
  root.querySelectorAll('[data-eligible-player]').forEach(el => {
    el.onchange = () => {
      const pid = el.dataset.eligiblePlayer;
      let eligible = [...(d.eligiblePlayerIds || [])];
      if (el.checked) { if (!eligible.includes(pid)) eligible.push(pid); }
      else { eligible = eligible.filter(id => id !== pid); }
      _updateSettings({ eligiblePlayerIds: eligible });
    };
  });
  root.getElementById?.('start-draft-btn')?.addEventListener('click', _startDraft);
  // querySelector fallback
  const startBtn = root.querySelector('#start-draft-btn');
  if (startBtn) startBtn.onclick = _startDraft;
}

async function _updateSettings(body) {
  try {
    const updated = await Admin.api('PUT', '/api/draft/settings', body);
    Admin.state.draft = updated;
    _renderDraftContent(document.getElementById('tab-draft'));
  } catch (e) { alert(e.message); }
}

async function _startDraft() {
  try {
    const updated = await Admin.api('POST', '/api/draft/start');
    Admin.state.draft = updated;
    _renderDraftContent(document.getElementById('tab-draft'));
  } catch (e) { alert(e.message); }
}

// ── Active view ────────────────────────────────────────────────────────

function _renderActive(d) {
  const allTeams = Admin.state.teams || [];
  const allPlayers = Admin.state.players || [];
  const teamOrder = d.teamOrder || [];
  const picks = d.picks || [];
  const eligible = d.eligiblePlayerIds || [];

  const tLen = teamOrder.length;
  const idx = d.currentPickIndex % (tLen || 1);
  const roundIsEven = d.currentRound % 2 === 0;
  const onClockId = roundIsEven ? teamOrder[tLen - 1 - idx] : teamOrder[idx];
  const onClockName = allTeams.find(t => t.id === onClockId)?.name || onClockId;

  const overall = picks.length + 1;

  // Pick history (most recent first)
  const historyHtml = picks.length === 0
    ? '<div class="empty">No picks yet.</div>'
    : [...picks].reverse().map(p => {
        const pName = allPlayers.find(x => x.id === p.playerId)?.name || p.playerId;
        const tName = allTeams.find(x => x.id === p.teamId)?.name || p.teamId;
        return `<div class="list-row" style="font-size:13px">
          <span class="seed-pill">${p.overall}</span>
          <span style="flex:1">${esc(pName)}</span>
          <span class="chip">${esc(tName)}</span>
          <span style="font-size:11px;color:#888">R${p.round} · P${p.pickInRound}</span>
        </div>`;
      }).join('');

  // Eligible players not yet picked (for admin pick fallback)
  const pickedIds = new Set(picks.map(p => p.playerId));
  const available = eligible
    .map(pid => allPlayers.find(p => p.id === pid))
    .filter(p => p && !pickedIds.has(p.id));

  const pickListHtml = available.length === 0
    ? '<div class="empty">All eligible players picked.</div>'
    : available.map(p => `
        <div class="list-row" style="font-size:13px">
          <span style="flex:1">${esc(p.name)}</span>
          <button class="sm primary-action" data-admin-pick="${esc(p.id)}">Pick</button>
        </div>`).join('');

  return `
    <h2>Draft — Active</h2>

    <div style="background:#f7f7fa;border:1px solid #e8e8ec;border-radius:6px;padding:14px 16px;margin-bottom:14px">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#196A73;font-weight:700;margin-bottom:2px">ON THE CLOCK</div>
      <div style="font-size:22px;font-weight:700;color:#F28F16;font-family:Oswald,sans-serif">${esc(onClockName)}</div>
      <div style="font-size:13px;color:#555;margin-top:2px">Round ${d.currentRound} · Pick ${idx + 1} of ${tLen} · Overall #${overall}</div>
      <div style="font-size:11px;color:#888;margin-top:4px">Snake order — the team that picks last in this round picks first in the next.</div>
    </div>

    <div class="row" style="margin-bottom:14px">
      <div class="shrink"><button id="undo-pick-btn" class="subtle" ${(d.history || []).length === 0 ? 'disabled' : ''}>Undo Last Pick</button></div>
      <div class="shrink"><button id="end-draft-btn" class="subtle">End Draft</button></div>
    </div>

    <label>Pick (admin fallback — use when display is on wall TV)</label>
    <div class="list" style="max-height:200px;overflow-y:auto;margin-bottom:20px">
      ${pickListHtml}
    </div>

    <details>
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#555;margin-bottom:8px">Pick History (${picks.length})</summary>
      <div class="list" style="max-height:240px;overflow-y:auto">${historyHtml}</div>
    </details>
  `;
}

function _wireActive(root, d) {
  root.querySelector('#undo-pick-btn')?.addEventListener('click', async () => {
    try {
      const updated = await Admin.api('POST', '/api/draft/undo');
      Admin.state.draft = updated;
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
  root.querySelector('#end-draft-btn')?.addEventListener('click', async () => {
    if (!confirm('End the draft early? You can still commit or undo picks.')) return;
    try {
      const updated = await Admin.api('POST', '/api/draft/end');
      Admin.state.draft = updated;
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
  root.querySelectorAll('[data-admin-pick]').forEach(el => {
    el.onclick = async () => {
      const playerId = el.dataset.adminPick;
      const expectedOverall = (d.picks || []).length + 1;
      try {
        const updated = await Admin.api('PUT', '/api/draft/pick', { playerId, expectedOverall });
        Admin.state.draft = updated;
        _renderDraftContent(root);
      } catch (e) { alert(e.message); }
    };
  });
}

// ── Ended view ─────────────────────────────────────────────────────────

function _renderEnded(d) {
  const allTeams = Admin.state.teams || [];
  const allPlayers = Admin.state.players || [];
  const teamOrder = d.teamOrder || [];
  const picks = d.picks || [];

  const grouped = teamOrder.map(tid => {
    const team = allTeams.find(t => t.id === tid);
    const teamPicks = picks.filter(p => p.teamId === tid).sort((a, b) => a.overall - b.overall);
    return { team, teamPicks };
  });

  const groupedHtml = grouped.map(({ team, teamPicks }) => `
    <div style="margin-bottom:14px">
      <div style="font-weight:700;color:#114566;margin-bottom:4px">${esc(team?.name || '?')}</div>
      ${teamPicks.length === 0
        ? '<div class="empty" style="padding:4px 0">No picks.</div>'
        : teamPicks.map(p => {
            const pName = allPlayers.find(x => x.id === p.playerId)?.name || p.playerId;
            return `<div class="list-row" style="font-size:13px">
              <span class="seed-pill">${p.overall}</span>
              <span>${esc(pName)}</span>
              <span style="font-size:11px;color:#888">R${p.round} · P${p.pickInRound}</span>
            </div>`;
          }).join('')
      }
    </div>`).join('');

  return `
    <h2>Draft — Ended</h2>
    <p style="font-size:13px;color:#555;margin-bottom:14px">${picks.length} total picks. Review below, then commit to write rosters to the Teams tab.</p>
    ${groupedHtml}
    <div class="row" style="margin-top:16px">
      <div class="shrink"><button class="primary-action" id="commit-btn">Commit Draft to Teams</button></div>
      <div class="shrink"><button class="subtle" id="undo-pick-btn2" ${(d.history || []).length === 0 ? 'disabled' : ''}>Undo Last Pick</button></div>
      <div class="shrink"><button class="subtle" id="reset-draft-btn">Reset Draft</button></div>
    </div>
  `;
}

function _wireEnded(root, d) {
  root.querySelector('#commit-btn')?.addEventListener('click', async () => {
    try {
      const preview = await Admin.api('GET', '/api/draft/commit/preview');
      const lines = preview.teamsAffected.map(t => {
        const overwrite = t.willOverwrite ? ` (replaces existing ${t.existingCount} players)` : '';
        return `  ${t.name}: ${t.newCount} picks${overwrite}`;
      }).join('\n');
      if (!confirm(`Commit draft to team rosters?\n\n${lines}\n\nThis cannot be undone without using Uncommit.`)) return;
      const updated = await Admin.api('POST', '/api/draft/commit');
      Admin.state.draft = updated;
      await _refreshTeams();
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
  root.querySelector('#undo-pick-btn2')?.addEventListener('click', async () => {
    try {
      const updated = await Admin.api('POST', '/api/draft/undo');
      Admin.state.draft = updated;
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
  root.querySelector('#reset-draft-btn')?.addEventListener('click', async () => {
    if (!confirm('Reset draft? Picks will be cleared. Team order and eligible players are preserved.')) return;
    try {
      const updated = await Admin.api('POST', '/api/draft/reset');
      Admin.state.draft = updated;
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
}

// ── Committed view ─────────────────────────────────────────────────────

function _renderCommitted(d) {
  const allTeams = Admin.state.teams || [];
  const allPlayers = Admin.state.players || [];
  const teamOrder = d.teamOrder || [];
  const picks = d.picks || [];

  const committedTime = d.committedAt
    ? new Date(d.committedAt).toLocaleString()
    : '';

  const grouped = teamOrder.map(tid => {
    const team = allTeams.find(t => t.id === tid);
    const teamPicks = picks.filter(p => p.teamId === tid).sort((a, b) => a.overall - b.overall);
    return { team, teamPicks };
  });

  const groupedHtml = grouped.map(({ team, teamPicks }) => `
    <div style="margin-bottom:14px">
      <div style="font-weight:700;color:#114566;margin-bottom:4px">${esc(team?.name || '?')}</div>
      ${teamPicks.map(p => {
        const pName = allPlayers.find(x => x.id === p.playerId)?.name || p.playerId;
        return `<div class="list-row" style="font-size:13px">
          <span class="seed-pill">${p.overall}</span>
          <span>${esc(pName)}</span>
        </div>`;
      }).join('') || '<div class="empty" style="padding:4px 0">No picks.</div>'}
    </div>`).join('');

  return `
    <h2>Draft — Committed</h2>
    <div style="background:#e8f5e9;border:1px solid #4caf50;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#2e7d32;font-weight:600">
      Rosters have been written to the Teams tab.${committedTime ? ' Committed at ' + esc(committedTime) + '.' : ''}
    </div>
    ${groupedHtml}
    <div class="row" style="margin-top:16px">
      <div class="shrink">
        <button class="subtle" id="uncommit-btn" title="Restore team rosters to pre-draft state. One-shot.">Uncommit</button>
      </div>
      <div class="shrink">
        <button class="subtle" id="reset-committed-btn">Reset Draft</button>
      </div>
    </div>
  `;
}

function _wireCommitted(root, d) {
  root.querySelector('#uncommit-btn')?.addEventListener('click', async () => {
    if (!confirm('Uncommit? This restores all affected teams to their pre-draft rosters. One-shot — cannot be redone.')) return;
    try {
      const updated = await Admin.api('POST', '/api/draft/uncommit');
      Admin.state.draft = updated;
      await _refreshTeams();
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
  root.querySelector('#reset-committed-btn')?.addEventListener('click', async () => {
    if (!confirm('Reset draft? The current committed state will be cleared. Team rosters are NOT changed by reset.')) return;
    try {
      const updated = await Admin.api('POST', '/api/draft/reset');
      Admin.state.draft = updated;
      _renderDraftContent(root);
    } catch (e) { alert(e.message); }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

async function _refreshTeams() {
  try {
    Admin.state.teams = await Admin.api('GET', '/api/teams');
  } catch (e) { /* non-fatal */ }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
