// Admin entry point: wire tab switching and initial load.

const tabRenderers = {
  roster: renderRoster,
  teams: renderTeams,
  standings: renderStandings,
  bracket: renderBracket,
  scoreboard: renderScoreboard,
  tv: renderTv
};

function activateTab(name) {
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
