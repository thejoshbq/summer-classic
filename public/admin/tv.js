// TV Mode tab — sets what /tv/main displays.

function renderTv() {
  const root = document.getElementById('tab-tv');
  const mode = Admin.state.displayMode?.mode || 'standings';

  const modes = [
    { id: 'standings', label: 'Standings', desc: 'Season leaderboard' },
    { id: 'bracket', label: 'Bracket', desc: 'Murderball / Derby (whichever is active in admin)' },
    { id: 'scoreboard', label: 'Scoreboard', desc: 'Championship Game live + final' }
  ];

  root.innerHTML = `
    <div class="card">
      <h2>Flex TV Mode</h2>
      <p style="font-size:13px;color:#555;margin-bottom:14px">
        Controls what <code>/tv/main</code> shows. Use this URL on any TV you want to swap between displays
        through the night. Fixed per-TV URLs (<code>/standings/display</code>, <code>/bracket/display</code>,
        <code>/scoreboard/display</code>) ignore this setting.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${modes.map(m => `
          <div class="list-row" style="cursor:pointer;${mode === m.id ? 'border-color:#F28F16;background:#fff7eb' : ''}" data-mode="${m.id}">
            <div style="flex:1">
              <div style="font-weight:700">${m.label}</div>
              <div style="font-size:12px;color:#888">${m.desc}</div>
            </div>
            <div style="font-size:18px;color:${mode === m.id ? '#F28F16' : '#bbb'}">●</div>
          </div>
        `).join('')}
      </div>
      <p style="margin-top:14px;font-size:12px;color:#888">
        <a href="/tv/main" target="_blank" style="color:#196A73;font-weight:600">Open /tv/main →</a>
        — pages refresh within 5s of a mode change.
      </p>
    </div>
  `;

  root.querySelectorAll('[data-mode]').forEach(el => {
    el.onclick = () => setMode(el.dataset.mode);
  });
}

async function setMode(mode) {
  Admin.state.displayMode = await Admin.api('PUT', '/api/display-mode', { mode });
  renderTv();
}
