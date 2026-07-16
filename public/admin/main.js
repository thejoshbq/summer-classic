// Admin entry point: wire tab switching, tab cleanup hooks, and initial load.

const tabRenderers = {
  roster: renderRoster,
  draft: renderDraft,
  teams: renderTeams,
  standings: renderStandings,
  bracket: renderBracket,
  scoreboard: renderScoreboard
};

// Each tab module can register a cleanup function (e.g. clear a self-refresh
// timer) by placing it in tabCleanups. activateTab calls it on tab leave.
const tabCleanups = {
  draft: draftCleanup
};

let currentTabCleanup = null;

function activateTab(name) {
  // Run the departing tab's cleanup
  if (typeof currentTabCleanup === 'function') currentTabCleanup();
  currentTabCleanup = tabCleanups[name] ?? null;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  tabRenderers[name]?.();
}

document.getElementById('tab-bar').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (btn) activateTab(btn.dataset.tab);
});

Admin.on(() => {
  const active = document.querySelector('.tab-btn.active')?.dataset.tab || 'roster';
  tabRenderers[active]?.();
});

Admin.loadAll().then(() => activateTab('roster'));
