// Bridge tab — connect to a Lumber Jill's hub league and pull its roster.
// Unlike the other tabs, bridge state isn't part of Admin.loadAll(); it's
// fetched on demand since it involves a live call out to the hub.

let bridgeStatus = null;
let bridgePreview = null;
let bridgeAccepted = new Set();
let bridgeBusy = false;

async function renderBridge() {
  const root = document.getElementById('tab-bridge');
  if (!root) return;
  if (!bridgeStatus) {
    try {
      bridgeStatus = await Admin.api('GET', '/api/bridge/status');
    } catch (e) {
      root.innerHTML = `<div class="card"><div class="empty">Couldn't load bridge status: ${esc(e.message)}</div></div>`;
      return;
    }
  }
  _renderBridgeContent(root);
}

function _renderBridgeContent(root) {
  root.innerHTML = bridgeStatus.connected ? _renderConnected() : _renderConnectForm();
  _wireBridge(root);
}

function _renderConnectForm() {
  return `
    <div class="card">
      <h2>Connect to a league</h2>
      <p style="color:#888;font-size:13px;margin-bottom:14px">
        Paste the hub URL and the connection key from the league admin (Admin &rarr; Leagues &rarr; this league &rarr;
        Connections). The key is shown once at creation — if you don't have it, ask for a new one.
      </p>
      <div class="row" style="align-items:start">
        <div>
          <label for="bridge-hub-url">Hub URL</label>
          <input type="text" id="bridge-hub-url" placeholder="https://lumberjills.example.com">
        </div>
      </div>
      <div class="row" style="align-items:start;margin-top:10px">
        <div>
          <label for="bridge-key">Connection key</label>
          <input type="text" id="bridge-key" placeholder="cksomeleagueid.somelongtoken">
        </div>
        <div class="shrink">
          <button class="primary-action" id="bridge-connect-btn" ${bridgeBusy ? 'disabled' : ''}>
            ${bridgeBusy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function _renderConnected() {
  const b = bridgeStatus;
  return `
    <div class="card">
      <div class="row" style="align-items:center">
        <div>
          <h2 style="margin-bottom:2px">${esc(b.leagueName || 'Connected league')}</h2>
          <div style="color:#888;font-size:12px">${esc(b.season || '')} &middot; ${esc(b.hubUrl)}</div>
        </div>
        <div class="shrink">
          <button class="subtle sm" id="bridge-disconnect-btn">Disconnect</button>
        </div>
      </div>
      ${_renderLastSync(b)}
    </div>

    <div class="card">
      <div class="row" style="align-items:center;margin-bottom:12px">
        <h2 style="margin:0">Roster sync</h2>
        <div class="shrink">
          <button class="subtle sm" id="bridge-preview-btn" ${bridgeBusy ? 'disabled' : ''}>
            ${bridgeBusy ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      </div>
      ${bridgePreview ? _renderPreview(bridgePreview) : '<div class="empty">Click "Check for updates" to pull the latest roster from the hub.</div>'}
    </div>
  `;
}

function _renderLastSync(b) {
  if (!b.lastSyncAt) {
    return '<div class="empty" style="padding-top:10px">Never synced yet.</div>';
  }
  if (b.lastSyncStatus === 'ERROR') {
    return `
      <div style="margin-top:10px;padding:8px 12px;background:#fdf0ee;border:1px solid #e6b3a8;border-radius:5px;font-size:12px;color:#a82e1f">
        Last sync failed (${esc(new Date(b.lastSyncAt).toLocaleString())}): ${esc(_friendlyError(b.lastSyncErrorCode, b.lastSyncError))}
      </div>
    `;
  }
  const badgeColor = b.lastSyncStatus === 'PARTIAL' ? '#F28F16' : '#196A73';
  const badgeBg = b.lastSyncStatus === 'PARTIAL' ? '#fff7eb' : '#eef6f7';
  return `
    <div style="margin-top:10px;padding:8px 12px;background:${badgeBg};border-radius:5px;font-size:12px;color:${badgeColor};font-weight:600">
      ${esc(b.lastSyncStatus)} &middot; ${esc(new Date(b.lastSyncAt).toLocaleString())}
      &middot; ${b.lastSyncAccepted ?? 0} applied${b.lastSyncSkipped ? `, ${b.lastSyncSkipped} left unresolved` : ''}
    </div>
  `;
}

function _friendlyError(code, message) {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'The connection key is no longer valid. Ask the league admin for a new one.';
    case 'LEAGUE_UNAVAILABLE':
      return 'This league is no longer available from the hub.';
    case 'RATE_LIMITED':
      return 'The hub is rate limiting this connection — try again shortly.';
    default:
      return message || 'Could not reach the hub.';
  }
}

function _renderPreview(p) {
  const conflictCount = p.teams.conflicts.length + p.players.conflicts.length + p.membership.conflicts.length;
  return `
    ${p.truncated ? `<div class="empty" style="color:#b36b00">Roster truncated by the hub — only the first ${p.totalCount} rows are shown.</div>` : ''}
    ${_renderBucket('Teams', 'team', p.teams)}
    ${_renderBucket('Players', 'player', p.players)}
    ${_renderMembershipBucket(p.membership)}
    <div class="row" style="margin-top:14px">
      <div class="shrink">
        <button class="primary-action" id="bridge-sync-btn" ${bridgeBusy ? 'disabled' : ''}>
          ${bridgeBusy ? 'Syncing…' : conflictCount > 0 ? `Sync (${bridgeAccepted.size}/${conflictCount} conflicts selected)` : 'Sync'}
        </button>
      </div>
    </div>
  `;
}

function _renderBucket(label, kind, bucket) {
  const rows = [];
  for (const row of bucket.added) rows.push(_row(row.id, `+ ${esc(row.proposed.name)}`, 'added', false));
  for (const row of bucket.updated) {
    rows.push(_row(row.id, `${esc(row.current.name)} &rarr; ${esc(row.proposed.name)}`, 'updated', false));
  }
  for (const row of bucket.conflicts) {
    rows.push(_row(row.id, _conflictLabel(kind, row), 'conflict', true));
  }
  for (const row of bucket.departed) {
    rows.push(_row(row.id, `${esc(row.current.name)} — no longer on the hub roster`, 'departed', false));
  }
  if (rows.length === 0) return '';
  return `
    <div class="pool-title" style="margin-top:14px">${esc(label)}</div>
    <div class="list">${rows.join('')}</div>
  `;
}

function _conflictLabel(kind, row) {
  const field = kind === 'team' ? 'name/contact' : 'name';
  return `${esc(row.current.name)}: local edit vs. hub's ${field} change`;
}

function _row(id, label, kind, checkable) {
  const badge = { added: '#196A73', updated: '#196A73', conflict: '#F28F16', departed: '#999' }[kind];
  const checkbox = checkable
    ? `<input type="checkbox" data-accept-id="${esc(id)}" ${bridgeAccepted.has(id) ? 'checked' : ''}>`
    : '';
  return `
    <div class="list-row">
      ${checkbox}
      <span style="flex:1">${label}</span>
      <span class="chip" style="background:${badge}">${kind}</span>
    </div>
  `;
}

function _renderMembershipBucket(m) {
  const rows = [];
  for (const row of m.updated) {
    rows.push(_row(row.id, `${esc(row.playerName)}: ${esc(row.fromTeamName)} &rarr; ${esc(row.toTeamName)}`, 'updated', false));
  }
  for (const row of m.conflicts) {
    rows.push(
      _row(
        row.id,
        `${esc(row.playerName)}: local move vs. hub's ${esc(row.fromTeamName)} &rarr; ${esc(row.toTeamName)}`,
        'conflict',
        true
      )
    );
  }
  if (rows.length === 0) return '';
  return `
    <div class="pool-title" style="margin-top:14px">Team assignments</div>
    <div class="list">${rows.join('')}</div>
  `;
}

function _wireBridge(root) {
  root.querySelector('#bridge-connect-btn')?.addEventListener('click', connectBridge);
  root.querySelector('#bridge-disconnect-btn')?.addEventListener('click', disconnectBridge);
  root.querySelector('#bridge-preview-btn')?.addEventListener('click', runPreview);
  root.querySelector('#bridge-sync-btn')?.addEventListener('click', runSync);
  root.querySelectorAll('[data-accept-id]').forEach(el => {
    el.addEventListener('change', () => {
      const id = el.dataset.acceptId;
      if (el.checked) bridgeAccepted.add(id);
      else bridgeAccepted.delete(id);
      renderBridge();
    });
  });
}

async function connectBridge() {
  const hubUrl = document.getElementById('bridge-hub-url').value.trim();
  const key = document.getElementById('bridge-key').value.trim();
  if (!hubUrl || !key) { alert('Hub URL and connection key are both required.'); return; }

  bridgeBusy = true;
  renderBridge();
  try {
    bridgeStatus = await Admin.api('POST', '/api/bridge/connect', { hubUrl, key });
    bridgePreview = null;
    bridgeAccepted = new Set();
  } catch (e) {
    alert(e.message);
  } finally {
    bridgeBusy = false;
    renderBridge();
  }
}

async function disconnectBridge() {
  if (!confirm('Disconnect from this league? You can reconnect later with a new or the same connection key.')) return;
  try {
    bridgeStatus = await Admin.api('POST', '/api/bridge/disconnect');
    bridgePreview = null;
    bridgeAccepted = new Set();
    renderBridge();
  } catch (e) { alert(e.message); }
}

async function runPreview() {
  bridgeBusy = true;
  renderBridge();
  try {
    bridgePreview = await Admin.api('GET', '/api/bridge/preview');
    bridgeAccepted = new Set();
  } catch (e) {
    alert(e.message);
    bridgePreview = null;
  } finally {
    bridgeBusy = false;
    renderBridge();
  }
}

async function runSync() {
  bridgeBusy = true;
  renderBridge();
  try {
    const result = await Admin.api('POST', '/api/bridge/sync', { accept: [...bridgeAccepted] });
    bridgeStatus = await Admin.api('GET', '/api/bridge/status');
    bridgePreview = null;
    bridgeAccepted = new Set();
    await Admin.loadAll();
    alert(`Sync ${result.status.toLowerCase()}: ${result.accepted} applied${result.skipped ? `, ${result.skipped} left unresolved` : ''}.`);
  } catch (e) {
    alert(e.message);
  } finally {
    bridgeBusy = false;
    renderBridge();
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
