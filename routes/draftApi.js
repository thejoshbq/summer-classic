const express = require('express');
const { draft, teams, players, game, bracket } = require('../lib/stores');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────

function snapshot(d) {
  const copy = JSON.parse(JSON.stringify({ ...d, history: [] }));
  d.history = [{ snapshot: copy }, ...(d.history || [])].slice(0, 12);
}

// Snake order: odd rounds go forward, even rounds reverse.
// Returns the team id that is currently on the clock.
function turnFor(d) {
  const order = d.teamOrder || [];
  if (!order.length) return null;
  const idx = d.currentPickIndex % order.length;
  const roundIsEven = d.currentRound % 2 === 0;
  const teamId = roundIsEven ? order[order.length - 1 - idx] : order[idx];
  return {
    teamId,
    round: d.currentRound,
    pickInRound: idx + 1,
    overall: (d.picks || []).length + 1
  };
}

function advance(d) {
  d.currentPickIndex++;
  if (d.currentPickIndex >= (d.teamOrder || []).length) {
    d.currentPickIndex = 0;
    d.currentRound++;
  }
}

function allEligiblePicked(d) {
  return (d.picks || []).length >= (d.eligiblePlayerIds || []).length
    && (d.eligiblePlayerIds || []).length > 0;
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET / — current draft state
router.get('/', (req, res) => res.json(draft.get()));

// GET /view — combined endpoint: { players, teams, draft } for display page
router.get('/view', (req, res) => {
  const { VARIATION_NAMES, THROWS_PER_VARIATION } = require('../lib/constants');
  const defaults = VARIATION_NAMES.map(name => ({
    name,
    throws: Array(THROWS_PER_VARIATION).fill(0)
  }));
  const enrichedPlayers = players.get().map(p => ({
    ...p,
    variations: p.variations ?? JSON.parse(JSON.stringify(defaults))
  }));
  res.json({ players: enrichedPlayers, teams: teams.get(), draft: draft.get() });
});

// GET /commit/preview — show what commit would do
router.get('/commit/preview', (req, res) => {
  const d = draft.get();
  if (d.status !== 'ended') {
    return res.status(409).json({ error: 'Draft must be ended before previewing commit.' });
  }
  const allPlayers = new Set(players.get().map(p => p.id));
  const allTeams = teams.get();
  const teamsAffected = (d.teamOrder || []).map(tid => {
    const team = allTeams.find(t => t.id === tid);
    const existing = team ? (team.playerIds || []) : [];
    const newIds = (d.picks || [])
      .filter(pick => pick.teamId === tid && allPlayers.has(pick.playerId))
      .map(pick => pick.playerId);
    return {
      teamId: tid,
      name: team ? team.name : tid,
      existingCount: existing.length,
      newCount: newIds.length,
      willOverwrite: existing.length > 0,
      existingPlayerIds: existing
    };
  });
  res.json({ teamsAffected });
});

// PUT /settings — update setup config; only when status === 'setup'
router.put('/settings', async (req, res) => {
  const d = draft.get();
  if (d.status !== 'setup') {
    return res.status(409).json({ error: 'Cannot change settings while draft is active or complete.' });
  }

  const { teamOrder, eligiblePlayerIds } = req.body || {};
  let err = null;

  await draft.update(curr => {
    if (Array.isArray(teamOrder)) {
      const validTeamIds = new Set(teams.get().map(t => t.id));
      curr.teamOrder = teamOrder.filter(id => validTeamIds.has(id));
    }
    if (Array.isArray(eligiblePlayerIds)) {
      const validPlayerIds = new Set(players.get().map(p => p.id));
      curr.eligiblePlayerIds = eligiblePlayerIds.filter(id => validPlayerIds.has(id));
    }
    return curr;
  });

  if (err) return res.status(400).json({ error: err });
  res.json(draft.get());
});

// POST /start — begin the draft
router.post('/start', async (req, res) => {
  let err = null;
  await draft.update(curr => {
    const validTeamIds = new Set(teams.get().map(t => t.id));
    const validPlayerIds = new Set(players.get().map(p => p.id));

    // Validate all teamOrder IDs exist
    for (const tid of (curr.teamOrder || [])) {
      if (!validTeamIds.has(tid)) {
        err = `Team ID ${tid} no longer exists. Update team order.`;
        return curr;
      }
    }
    // Validate all eligiblePlayerIds exist
    for (const pid of (curr.eligiblePlayerIds || [])) {
      if (!validPlayerIds.has(pid)) {
        err = `Player ID ${pid} no longer exists. Update eligible players.`;
        return curr;
      }
    }

    if ((curr.teamOrder || []).length < 2) {
      err = 'Need at least 2 teams in the draft order.';
      return curr;
    }
    if ((curr.eligiblePlayerIds || []).length < (curr.teamOrder || []).length) {
      err = 'Need at least as many eligible players as teams.';
      return curr;
    }

    snapshot(curr);
    curr.status = 'active';
    curr.currentRound = 1;
    curr.currentPickIndex = 0;
    curr.picks = [];
    curr.preCommitTeamsSnapshot = null;
    curr.committedAt = null;
    return curr;
  });

  if (err) return res.status(400).json({ error: err });
  res.json(draft.get());
});

// PUT /pick — record a pick; requires expectedOverall for race protection
router.put('/pick', async (req, res) => {
  const { playerId, expectedOverall } = req.body || {};
  if (!playerId) return res.status(400).json({ error: 'playerId required' });
  let err = null;

  await draft.update(d => {
    if (d.status !== 'active') {
      err = 'Draft is not active.';
      return d;
    }
    if (!(d.eligiblePlayerIds || []).includes(playerId)) {
      err = 'Player is not eligible.';
      return d;
    }
    if ((d.picks || []).some(p => p.playerId === playerId)) {
      err = 'Player already picked.';
      return d;
    }
    // Race protection: reject if caller's expectedOverall doesn't match
    const currentOverall = (d.picks || []).length + 1;
    if (expectedOverall !== undefined && expectedOverall !== currentOverall) {
      err = `Pick out of date (expected overall ${expectedOverall}, current ${currentOverall}). Refreshed — try again.`;
      return d;
    }

    const turn = turnFor(d);
    snapshot(d);
    d.picks = d.picks || [];
    d.picks.push({
      teamId: turn.teamId,
      playerId,
      round: turn.round,
      pickInRound: turn.pickInRound,
      overall: turn.overall
    });
    advance(d);

    if (allEligiblePicked(d)) {
      d.status = 'ended';
    }
    return d;
  });

  if (err) return res.status(409).json({ error: err });
  res.json(draft.get());
});

// POST /end — manual early stop
router.post('/end', async (req, res) => {
  let err = null;
  await draft.update(d => {
    if (d.status !== 'active') {
      err = 'Draft is not active.';
      return d;
    }
    snapshot(d);
    d.status = 'ended';
    return d;
  });
  if (err) return res.status(409).json({ error: err });
  res.json(draft.get());
});

// POST /commit — write picks to team rosters
router.post('/commit', async (req, res) => {
  let err = null;
  await draft.update(d => {
    if (d.status !== 'ended') {
      err = 'Draft must be ended before committing.';
      return d;
    }

    // Interlock: block if game is live or if bracket is mid-elimination
    const g = game.get();
    if (g.status !== 'setup') {
      err = `Cannot commit: the Championship Game is currently "${g.status}". Finish or reset the game first.`;
      return d;
    }
    const br = bracket.get();
    if ((br.entrantPlayerIds || []).length > 0 && !br.championPlayerId) {
      err = 'Cannot commit: the Elimination Bracket is in progress. Finish or reset the bracket first.';
      return d;
    }

    const allPlayers = new Set(players.get().map(p => p.id));
    const allTeams = teams.get();
    const teamOrder = d.teamOrder || [];

    // Snapshot team rosters before overwriting (for uncommit)
    const preCommitSnap = Object.fromEntries(
      allTeams
        .filter(t => teamOrder.includes(t.id))
        .map(t => [t.id, [...(t.playerIds || [])]])
    );

    // Build new rosters filtered to still-existing players
    const newRosters = Object.fromEntries(
      teamOrder.map(tid => [
        tid,
        (d.picks || [])
          .filter(p => p.teamId === tid && allPlayers.has(p.playerId))
          .map(p => p.playerId)
      ])
    );

    // Single atomic teams update
    teams.update(curr => {
      for (const t of curr) {
        if (newRosters.hasOwnProperty(t.id)) {
          t.playerIds = newRosters[t.id];
        }
      }
      return curr;
    });

    d.preCommitTeamsSnapshot = preCommitSnap;
    d.committedAt = new Date().toISOString();
    d.status = 'committed';
    return d;
  });

  if (err) return res.status(409).json({ error: err });
  res.json(draft.get());
});

// POST /uncommit — one-shot restore of pre-commit team rosters
router.post('/uncommit', async (req, res) => {
  let err = null;
  await draft.update(d => {
    if (d.status !== 'committed') {
      err = 'Draft is not committed.';
      return d;
    }
    if (!d.preCommitTeamsSnapshot) {
      err = 'No pre-commit snapshot available.';
      return d;
    }

    const snap = d.preCommitTeamsSnapshot;
    teams.update(curr => {
      for (const t of curr) {
        if (snap.hasOwnProperty(t.id)) {
          t.playerIds = snap[t.id];
        }
      }
      return curr;
    });

    d.status = 'ended';
    d.preCommitTeamsSnapshot = null;
    return d;
  });

  if (err) return res.status(409).json({ error: err });
  res.json(draft.get());
});

// POST /undo — restore previous state from history
router.post('/undo', async (req, res) => {
  let err = null;
  await draft.update(d => {
    if (!d.history || !d.history.length) {
      err = 'Nothing to undo.';
      return d;
    }
    const [{ snapshot: prev }, ...rest] = d.history;
    return { ...prev, history: rest };
  });
  if (err) return res.status(400).json({ error: err });
  res.json(draft.get());
});

// POST /reset — return to setup, preserving teamOrder and eligiblePlayerIds
router.post('/reset', async (req, res) => {
  let err = null;
  await draft.update(d => {
    // Block reset when committed UNLESS snapshot is already cleared (already uncommitted)
    if (d.status === 'committed' && d.preCommitTeamsSnapshot !== null) {
      err = 'Uncommit the draft first to restore previous rosters, then reset.';
      return d;
    }
    const teamOrder = d.teamOrder || [];
    const eligiblePlayerIds = d.eligiblePlayerIds || [];
    return {
      status: 'setup',
      teamOrder,
      eligiblePlayerIds,
      picks: [],
      currentRound: 1,
      currentPickIndex: 0,
      history: [],
      preCommitTeamsSnapshot: null,
      committedAt: null
    };
  });
  if (err) return res.status(409).json({ error: err });
  res.json(draft.get());
});

module.exports = router;
