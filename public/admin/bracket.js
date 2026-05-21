// Bracket tab — Murderball + Derby admin.

let bracketViewRound = 0;
const bracketScorePending = {};

function renderBracket() {
  const root = document.getElementById('tab-bracket');
  const b = Admin.state.bracket;
  if (!b) { root.innerHTML = '<div class="card">Loading…</div>'; return; }

  if (bracketViewRound >= (b.rounds?.length || 0)) {
    bracketViewRound = Math.max(0, (b.rounds?.length || 1) - 1);
  }

  root.innerHTML = `
    <div class="card">
      <h2>Bracket Setup</h2>
      <div class="row" style="margin-bottom:14px">
        <div style="flex:0 0 240px">
          <label>Mode</label>
          <div class="choice-grid">
            <button class="choice-btn ${b.mode === 'murderball' ? 'active' : ''}" data-mode="murderball">Murderball</button>
            <button class="choice-btn ${b.mode === 'derby' ? 'active' : ''}" data-mode="derby">Home Run Derby</button>
          </div>
        </div>
        ${b.mode === 'murderball' ? `
          <div style="flex:0 0 150px">
            <label>Lane count</label>
            <div class="choice-grid">
              ${[2,3,4].map(n => `
                <button class="choice-btn ${b.settings.laneCount === n ? 'active' : ''}" data-lane="${n}">${n}</button>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div style="flex:1;text-align:right">
          <a href="/bracket/display" target="_blank" style="color:#196A73;font-weight:600;font-size:13px">Open bracket display →</a>
        </div>
      </div>

      <label>Entrants ${b.mode === 'derby' ? '(top → bottom = seed 1 → N)' : '(scout score determines bye)'}</label>
      ${renderEntrants(b)}

      <div class="row" style="margin-top:14px">
        <div class="shrink"><button class="primary-action" id="generate-btn">${b.generated ? 'Regenerate Bracket' : 'Generate Bracket'}</button></div>
        ${b.generated ? '<div class="shrink"><button class="subtle" id="reset-btn">Reset Bracket</button></div>' : ''}
        <div class="shrink"><button class="subtle" id="undo-btn" ${(b.history || []).length === 0 ? 'disabled' : ''}>Undo Last Action</button></div>
      </div>
    </div>

    ${b.generated && b.rounds.length ? renderScoringCard(b) : ''}
  `;

  root.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => setMode(el.dataset.mode));
  root.querySelectorAll('[data-lane]').forEach(el => el.onclick = () => setLane(parseInt(el.dataset.lane)));
  root.querySelectorAll('[data-toggle]').forEach(el => el.onclick = () => toggleEntrant(el.dataset.toggle));
  root.querySelectorAll('[data-move-up]').forEach(el => el.onclick = () => moveEntrant(el.dataset.moveUp, -1));
  root.querySelectorAll('[data-move-down]').forEach(el => el.onclick = () => moveEntrant(el.dataset.moveDown, +1));

  document.getElementById('generate-btn').onclick = doGenerate;
  document.getElementById('reset-btn')?.addEventListener('click', doReset);
  document.getElementById('undo-btn')?.addEventListener('click', doUndo);

  if (b.generated && b.rounds.length) attachScoringHandlers(b);
}

function renderEntrants(b) {
  const ps = Admin.state.players;
  if (ps.length === 0) return '<div class="empty">No players on the roster yet. Add some on the Roster tab.</div>';

  const entrantIds = b.entrantPlayerIds || [];
  const selected = entrantIds
    .map(id => ps.find(p => p.id === id))
    .filter(Boolean);
  const unselected = ps.filter(p => !entrantIds.includes(p.id));

  const selList = selected.length === 0
    ? '<div class="empty" style="padding:8px 0">No entrants yet — pick from below.</div>'
    : selected.map((p, i) => `
        <div class="entrant-card" style="background:#fff">
          <span class="seed-pill">${i + 1}</span>
          <span style="flex:1">${esc(p.name)}</span>
          <button class="sm subtle" data-move-up="${p.id}" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="sm subtle" data-move-down="${p.id}" ${i === selected.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="sm danger" data-toggle="${p.id}">Remove</button>
        </div>
      `).join('');

  const unselList = unselected.length === 0
    ? '<div class="empty" style="padding:8px 0">All players selected as entrants.</div>'
    : unselected.map(p => `
        <div class="entrant-card">
          <span style="flex:1">${esc(p.name)}</span>
          ${p.scoutScore != null ? `<span style="font-size:11px;color:#888">${p.scoutScore}</span>` : ''}
          <button class="sm" data-toggle="${p.id}">Add</button>
        </div>
      `).join('');

  return `
    <div class="entrant-grid">
      <div>
        <div class="pool-title" style="margin-bottom:6px">Entrants (${selected.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px">${selList}</div>
      </div>
      <div>
        <div class="pool-title" style="margin-bottom:6px">Available (${unselected.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px">${unselList}</div>
      </div>
    </div>
  `;
}

function renderScoringCard(b) {
  const champ = b.championPlayerId ? Admin.playerName(b.championPlayerId) : null;
  const rounds = b.rounds;

  let roundTabs = '';
  for (let i = 0; i < rounds.length; i++) {
    roundTabs += `<div class="round-tab ${i === bracketViewRound ? 'active' : ''}" data-round="${i}">${roundLabel(b.mode, i, rounds.length)}</div>`;
  }

  let body = '';
  if (b.mode === 'murderball') body = renderMurderballAdmin(b, rounds[bracketViewRound]);
  else body = renderDerbyAdmin(b, rounds[bracketViewRound]);

  const actions = renderBracketActions(b);

  return `
    <div class="card">
      ${champ ? `
        <div class="champion-banner">
          <div class="label">${b.mode === 'derby' ? 'Derby Champion' : 'Champion'}</div>
          <div class="name">${esc(champ)}</div>
        </div>
      ` : ''}
      <div class="round-tabs">${roundTabs}</div>
      ${body}
      <div class="row" style="margin-top:14px">${actions}</div>
    </div>
  `;
}

function roundLabel(mode, i, total) {
  if (mode === 'derby') {
    if (i === total - 1) return 'Final';
    if (i === total - 2) return 'Semifinals';
    if (i === total - 3) return 'Quarters';
  }
  return `Round ${i + 1}`;
}

function renderMurderballAdmin(b, round) {
  if (!round) return '';
  return round.heats.map((h, hi) => {
    const playerRows = h.playerIds.map(pid => {
      const name = Admin.playerName(pid);
      if (h.bye) {
        return `
          <div class="heat-row">
            <span class="bye-name" style="flex:1">${esc(name)}</span>
            <span class="chip" style="background:#196A73">BYE — auto-advance</span>
          </div>`;
      }
      const isElim = h.eliminatedPlayerId === pid;
      const cls = isElim ? 'loser-name' : '';
      const canAct = bracketViewRound === b.currentRound;
      return `
        <div class="heat-row">
          <span class="${cls}" style="flex:1">${esc(name)}</span>
          <button class="sm ${isElim ? 'subtle' : 'danger'}" data-elim="${hi}:${pid}" ${canAct ? '' : 'disabled'}>
            ${isElim ? 'Undo' : 'Eliminate'}
          </button>
        </div>`;
    }).join('');
    return `
      <div class="heat-block">
        <div class="heat-block-header">${h.bye ? 'BYE' : `HEAT ${hi + 1}`}</div>
        ${playerRows}
      </div>
    `;
  }).join('');
}

function renderDerbyAdmin(b, round) {
  if (!round) return '';
  return round.matchups.map((m, mi) => {
    function row(slot) {
      const p = m[slot];
      const name = p.playerId ? Admin.playerName(p.playerId) : null;
      if (!name && !m.bye) return `<div class="matchup-row"><span style="flex:1;color:#aaa;font-style:italic">TBD</span></div>`;
      if (!name && m.bye) return `<div class="matchup-row"><span class="bye-name" style="flex:1">BYE</span></div>`;

      const cls =
        m.winnerPlayerId === p.playerId ? 'winner-name'
        : (m.winnerPlayerId && m.winnerPlayerId !== p.playerId ? 'loser-name' : '');

      const canAct = bracketViewRound === b.currentRound && !m.winnerPlayerId && !m.bye && p.playerId;
      const scoreVal = p.score != null ? p.score : '';

      return `
        <div class="matchup-row">
          ${p.seed ? `<span class="seed-pill">${p.seed}</span>` : ''}
          <span class="${cls}" style="flex:1">${esc(name)}</span>
          ${m.winnerPlayerId ? `
            <span style="font-weight:700;color:${m.winnerPlayerId === p.playerId ? '#F28F16' : '#999'}">${scoreVal}</span>
          ` : `
            <input class="score-input" type="number" min="0" max="9" placeholder="—"
                   value="${scoreVal}"
                   data-score="${mi}:${slot}"
                   ${canAct ? '' : 'disabled'}>
            <button class="sm primary-action" data-winner="${mi}:${p.playerId}" ${canAct ? '' : 'disabled'}>Set Winner</button>
          `}
        </div>
      `;
    }
    return `
      <div class="matchup-block${round.isFinal ? ' is-final' : ''}">
        <div class="matchup-block-header">${round.isFinal ? `FINAL — 7 THROWS` : `MATCHUP ${mi + 1}`}${m.bye ? ' · BYE' : ''}</div>
        ${row('player1')}
        ${row('player2')}
      </div>
    `;
  }).join('');
}

function renderBracketActions(b) {
  const cur = b.rounds[b.currentRound];
  if (!cur) return '';

  if (b.mode === 'murderball') {
    const allDone = cur.heats.every(h => h.bye || h.eliminatedPlayerId !== null);
    const survivors = cur.heats.flatMap(h =>
      h.bye ? h.playerIds : h.playerIds.filter(p => p !== h.eliminatedPlayerId)
    );
    if (allDone && survivors.length === 1 && !b.championPlayerId) {
      return '<div class="shrink"><button class="primary-action" id="champ-btn">Declare Champion</button></div>';
    }
    return '';
  } else {
    const allDone = cur.matchups.every(m => m.winnerPlayerId);
    if (allDone && cur.isFinal && !b.championPlayerId) {
      return '<div class="shrink"><button class="primary-action" id="champ-btn">Declare Derby Champion</button></div>';
    }
    return '';
  }
}

function attachScoringHandlers(b) {
  const root = document.getElementById('tab-bracket');

  root.querySelectorAll('[data-round]').forEach(el => {
    el.onclick = () => { bracketViewRound = parseInt(el.dataset.round); renderBracket(); };
  });
  root.querySelectorAll('[data-elim]').forEach(el => {
    el.onclick = () => {
      const [hi, pid] = el.dataset.elim.split(':');
      doEliminate(parseInt(hi), pid);
    };
  });
  root.querySelectorAll('[data-score]').forEach(el => {
    el.oninput = () => {
      const [mi, slot] = el.dataset.score.split(':');
      const k = `${bracketViewRound}-${mi}`;
      if (!bracketScorePending[k]) bracketScorePending[k] = {};
      bracketScorePending[k][slot] = parseInt(el.value);
    };
  });
  root.querySelectorAll('[data-winner]').forEach(el => {
    el.onclick = () => {
      const [mi, pid] = el.dataset.winner.split(':');
      doSetWinner(parseInt(mi), pid);
    };
  });
  document.getElementById('champ-btn')?.addEventListener('click', doDeclareChampion);
}

async function setMode(mode) {
  const b = Admin.state.bracket;
  if (mode === b.mode) return;
  if (b.generated && !confirm('Switching mode will reset the current bracket. Continue?')) return;
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/settings', { mode });
  bracketViewRound = 0;
  renderBracket();
}

async function setLane(n) {
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/settings', { laneCount: n });
  renderBracket();
}

async function toggleEntrant(id) {
  const b = Admin.state.bracket;
  if (b.generated) {
    if (!confirm('Bracket is already generated. Changing entrants requires regenerating. Continue?')) return;
  }
  const cur = b.entrantPlayerIds || [];
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/settings', { entrantPlayerIds: next });
  renderBracket();
}

async function moveEntrant(id, delta) {
  const b = Admin.state.bracket;
  const list = [...(b.entrantPlayerIds || [])];
  const i = list.indexOf(id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/settings', { entrantPlayerIds: list });
  renderBracket();
}

async function doGenerate() {
  const b = Admin.state.bracket;
  if ((b.entrantPlayerIds || []).length < 2) return alert('Add at least 2 entrants first.');
  if (b.generated && !confirm('Regenerate the bracket? All current progress will be cleared.')) return;
  try {
    Admin.state.bracket = await Admin.api('POST', '/api/bracket/generate');
    bracketViewRound = 0;
    renderBracket();
  } catch (e) { alert(e.message); }
}

async function doReset() {
  if (!confirm('Reset bracket? Entrants stay; rounds + champion cleared.')) return;
  Admin.state.bracket = await Admin.api('POST', '/api/bracket/reset');
  bracketViewRound = 0;
  renderBracket();
}

async function doUndo() {
  try {
    Admin.state.bracket = await Admin.api('POST', '/api/bracket/undo');
    bracketViewRound = Admin.state.bracket.currentRound;
    renderBracket();
  } catch (e) { alert(e.message); }
}

async function doEliminate(heatIndex, playerId) {
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/eliminate', {
    roundIndex: bracketViewRound, heatIndex, playerId
  });
  bracketViewRound = Admin.state.bracket.currentRound;
  renderBracket();
}

async function doSetWinner(matchupIndex, winnerPlayerId) {
  const k = `${bracketViewRound}-${matchupIndex}`;
  const pending = bracketScorePending[k] || {};
  const m = Admin.state.bracket.rounds[bracketViewRound].matchups[matchupIndex];
  const body = {
    roundIndex: bracketViewRound,
    matchupIndex,
    winnerPlayerId,
    player1Score: pending.player1 ?? m.player1.score,
    player2Score: pending.player2 ?? m.player2.score
  };
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/score', body);
  delete bracketScorePending[k];
  renderBracket();
}

async function doDeclareChampion() {
  const b = Admin.state.bracket;
  let winnerId = null;
  if (b.mode === 'murderball') {
    const round = b.rounds[b.currentRound];
    const survivors = round.heats.flatMap(h =>
      h.bye ? h.playerIds : h.playerIds.filter(p => p !== h.eliminatedPlayerId)
    );
    winnerId = survivors[0];
  } else {
    winnerId = b.rounds[b.rounds.length - 1].matchups[0]?.winnerPlayerId;
  }
  if (!winnerId) return alert('No winner determined yet.');
  Admin.state.bracket = await Admin.api('PUT', '/api/bracket/champion', { playerId: winnerId });
  renderBracket();
}
