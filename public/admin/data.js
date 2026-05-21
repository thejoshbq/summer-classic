// Shared admin client — JSON state cache + API helpers + tiny event bus.

const Admin = (() => {
  const state = {
    players: [],
    teams: [],
    standings: { day: 1, records: {} },
    bracket: null,
    game: null,
    displayMode: { mode: 'standings' }
  };

  const listeners = new Set();
  function emit() { listeners.forEach(fn => fn(state)); }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let msg = 'Request failed';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function loadAll() {
    const [players, teams, standings, bracket, game, displayMode] = await Promise.all([
      api('GET', '/api/players'),
      api('GET', '/api/teams'),
      api('GET', '/api/standings'),
      api('GET', '/api/bracket'),
      api('GET', '/api/game'),
      api('GET', '/api/display-mode')
    ]);
    state.players = players;
    state.teams = teams;
    state.standings = standings;
    state.bracket = bracket;
    state.game = game;
    state.displayMode = displayMode;
    emit();
  }

  function playerName(id) {
    const p = state.players.find(x => x.id === id);
    return p ? p.name : '';
  }

  function teamName(id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : '';
  }

  function teamFor(playerId) {
    return state.teams.find(t => (t.playerIds || []).includes(playerId));
  }

  return { state, on, api, loadAll, playerName, teamName, teamFor };
})();
