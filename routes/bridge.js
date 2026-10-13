'use strict';

/**
 * League Bridge — pulls a roster from the Lumber Jill's hub and merges it
 * into teams.json/players.json via lib/leagueSync.js (vendored, unmodified)
 * plus lib/teamMembershipSync.js for the one relationship the generic engine
 * can't model directly: which team a player belongs to.
 *
 * Nothing here writes local state except POST /sync, and even that only
 * applies rows the operator explicitly accepted (or that fall in
 * leagueSync's AUTO_APPLICABLE set — added/updated with no local conflict).
 */

const express = require('express');
const { teams, players, bridge } = require('../lib/stores');
const { uid } = require('../lib/ids');
const {
  OUTCOME,
  AUTO_APPLICABLE,
  planMerge,
  applyMerge,
  fetchRoster,
  parseConnectionString
} = require('../lib/leagueSync');
const {
  AUTO_APPLICABLE: MEMBERSHIP_AUTO_APPLICABLE,
  planMembership,
  applyMembership
} = require('../lib/teamMembershipSync');

/**
 * applyMerge/applyMembership only fall back to their own auto-applicable
 * default when `accept` is omitted entirely — an empty ARRAY is truthy in
 * JS, so passing `[]` (which req.body.accept normalizes to when nothing was
 * checked) would suppress every auto-apply, not just leave conflicts alone.
 * Building the full accept list explicitly here sidesteps that footgun.
 */
function withAutoApplicable(plan, autoSet, idOf, explicitIds) {
  const ids = plan.filter(e => autoSet.has(e.outcome)).map(idOf);
  return [...ids, ...explicitIds];
}

const router = express.Router();

// contactEmail/contactPhone live on the team record, not the player — see
// buildIncomingTeams below. scoutScore/variations/captainId are deliberately
// absent: local-only, the hub has no opinion on them.
const TEAM_OWNED_FIELDS = ['name', 'contactEmail', 'contactPhone'];
const PLAYER_OWNED_FIELDS = ['name'];

function emptyBridgeDefaults() {
  return {
    hubUrl: null,
    connectionKey: null,
    leagueId: null,
    leagueName: null,
    season: null,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncErrorCode: null,
    lastSyncAccepted: null,
    lastSyncSkipped: null,
    snapshot: { teams: {}, players: {}, membership: {} }
  };
}

/** Never send the raw token back to the browser once it's stored. */
function publicBridgeState() {
  const b = bridge.get();
  const { connectionKey, snapshot, ...rest } = b;
  return { ...rest, connected: Boolean(connectionKey) };
}

function errorCode(err) {
  return err.code || 'NETWORK';
}

function statusForError(err) {
  switch (err.code) {
    case 'UNAUTHORIZED': return 401;
    case 'LEAGUE_UNAVAILABLE': return 404;
    case 'RATE_LIMITED': return 429;
    default: return 502; // HUB_ERROR, or a raw network failure with no leagueSync code
  }
}

function sendHubError(res, err) {
  res.status(statusForError(err)).json({ error: err.message, code: errorCode(err) });
}

/** Every hub team's contact info rides on its isContact player row, not the team row itself. */
function buildIncomingTeams(roster) {
  return roster.teams.map(t => {
    const contact = roster.players.find(p => p.isContact && p.teamExternalId === t.externalId);
    return {
      externalId: t.externalId,
      name: t.name,
      contactEmail: contact ? contact.email : null,
      contactPhone: contact ? contact.phone : null
    };
  });
}

function buildIncomingPlayers(roster) {
  return roster.players.map(p => ({ externalId: p.externalId, fullName: p.fullName }));
}

/** Pull the hub roster and compute all three plans, without writing anything. */
async function pullAndPlan() {
  const b = bridge.get();
  const roster = await fetchRoster({ baseUrl: b.hubUrl, leagueId: b.leagueId, token: b.connectionKey });
  const snapshot = b.snapshot || { teams: {}, players: {}, membership: {} };

  const localTeams = teams.get();
  const localPlayers = players.get();

  const teamPlan = planMerge({
    local: localTeams,
    snapshot: snapshot.teams || {},
    incoming: buildIncomingTeams(roster),
    ownedFields: TEAM_OWNED_FIELDS
  });

  const incomingPlayers = buildIncomingPlayers(roster);
  const playerPlan = planMerge({
    local: localPlayers,
    snapshot: snapshot.players || {},
    incoming: incomingPlayers.map(p => ({ externalId: p.externalId, name: p.fullName })),
    ownedFields: PLAYER_OWNED_FIELDS
  });

  const membershipPlan = planMembership({
    localPlayers,
    localTeams,
    incomingPlayers: roster.players.map(p => ({ externalId: p.externalId, teamExternalId: p.teamExternalId })),
    snapshot: snapshot.membership || {}
  });

  return { roster, teamPlan, playerPlan, membershipPlan };
}

/**
 * Buckets a plan into what the admin preview shows: added/updated auto-apply
 * (shown for transparency, no checkbox needed), conflicts need one, departed
 * is informational only. Carries both `current` (local) and `proposed`
 * (incoming) values so the operator can actually compare a conflict instead
 * of just seeing a name.
 */
function summarizePlan(plan, prefix) {
  const bucket = { added: [], updated: [], conflicts: [], departed: [] };
  for (const entry of plan) {
    const row = {
      id: `${prefix}:${entry.externalId}`,
      current: entry.local ?? null,
      proposed: entry.incoming ?? null
    };
    if (entry.outcome === OUTCOME.ADDED) bucket.added.push(row);
    else if (entry.outcome === OUTCOME.UPDATED) bucket.updated.push(row);
    else if (entry.outcome === OUTCOME.LOCAL_MODIFIED) bucket.conflicts.push(row);
    else if (entry.outcome === OUTCOME.DEPARTED) bucket.departed.push(row);
  }
  return bucket;
}

function summarizeMembership(plan, localTeams, rosterTeams) {
  // A hub-side reassignment can point at a team that's ADDED in this same
  // pull (not yet a local row) — fall back to the incoming roster's own
  // name for those so the preview label isn't just "Unknown team".
  const nameByHubId = new Map(rosterTeams.map(t => [t.externalId, t.name]));
  for (const t of localTeams) {
    if (t.hubId != null) nameByHubId.set(t.hubId, t.name);
  }
  const teamLabel = (hubId) => (hubId == null ? 'Unrostered' : nameByHubId.get(hubId) ?? 'Unknown team');

  const bucket = { updated: [], conflicts: [] };
  for (const entry of plan) {
    const row = {
      id: `membership:${entry.playerExternalId}`,
      playerName: entry.playerName,
      fromTeamName: teamLabel(entry.fromTeamHubId),
      toTeamName: teamLabel(entry.toTeamHubId)
    };
    if (entry.outcome === 'updated') bucket.updated.push(row);
    else if (entry.outcome === 'localModified') bucket.conflicts.push(row);
  }
  return bucket;
}

router.get('/status', (req, res) => {
  res.json(publicBridgeState());
});

router.post('/connect', async (req, res) => {
  const hubUrl = String(req.body?.hubUrl || '').trim().replace(/\/+$/, '');
  const key = String(req.body?.key || '').trim();

  if (!hubUrl) return res.status(400).json({ error: 'Hub URL is required.' });
  if (!/^https:\/\//i.test(hubUrl)) {
    return res.status(400).json({ error: 'Hub URL must use https.' });
  }
  const parsed = parseConnectionString(key);
  if (!parsed) {
    return res.status(400).json({
      error: 'Connection key is malformed — paste it exactly as shown by the league admin.'
    });
  }

  let roster;
  try {
    roster = await fetchRoster({ baseUrl: hubUrl, leagueId: parsed.leagueId, token: parsed.token });
  } catch (err) {
    return sendHubError(res, err);
  }

  await bridge.set({
    ...emptyBridgeDefaults(),
    hubUrl,
    connectionKey: parsed.token,
    leagueId: parsed.leagueId,
    leagueName: roster.league?.name ?? null,
    season: roster.league?.season ?? null
  });

  res.json(publicBridgeState());
});

router.post('/disconnect', async (req, res) => {
  await bridge.set(emptyBridgeDefaults());
  res.json(publicBridgeState());
});

router.get('/preview', async (req, res) => {
  const b = bridge.get();
  if (!b.connectionKey) return res.status(400).json({ error: 'Not connected to a hub league yet.' });

  try {
    const { roster, teamPlan, playerPlan, membershipPlan } = await pullAndPlan();
    res.json({
      leagueName: roster.league?.name ?? null,
      season: roster.league?.season ?? null,
      truncated: roster.truncated,
      totalCount: roster.totalCount,
      teams: summarizePlan(teamPlan, 'team'),
      players: summarizePlan(playerPlan, 'player'),
      membership: summarizeMembership(membershipPlan, teams.get(), roster.teams)
    });
  } catch (err) {
    sendHubError(res, err);
  }
});

router.post('/sync', async (req, res) => {
  const b = bridge.get();
  if (!b.connectionKey) return res.status(400).json({ error: 'Not connected to a hub league yet.' });

  const acceptRaw = Array.isArray(req.body?.accept) ? req.body.accept.map(String) : [];
  const acceptFor = (prefix) =>
    acceptRaw.filter(id => id.startsWith(`${prefix}:`)).map(id => id.slice(prefix.length + 1));

  let planned;
  try {
    planned = await pullAndPlan();
  } catch (err) {
    await bridge.update(curr => ({
      ...curr,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'ERROR',
      lastSyncError: err.message,
      lastSyncErrorCode: errorCode(err)
    }));
    sendHubError(res, err);
    return;
  }

  const { roster, teamPlan, playerPlan, membershipPlan } = planned;
  const snapshot = b.snapshot || { teams: {}, players: {}, membership: {} };

  const teamMerge = applyMerge({
    local: teams.get(),
    snapshot: snapshot.teams || {},
    plan: teamPlan,
    ownedFields: TEAM_OWNED_FIELDS,
    accept: withAutoApplicable(teamPlan, AUTO_APPLICABLE, e => e.externalId, acceptFor('team')),
    createLocal: (row) => ({
      id: uid(),
      name: row.name,
      contactEmail: row.contactEmail ?? null,
      contactPhone: row.contactPhone ?? null,
      playerIds: [],
      captainId: null
    })
  });
  await teams.set(teamMerge.records);

  const playerMerge = applyMerge({
    local: players.get(),
    snapshot: snapshot.players || {},
    plan: playerPlan,
    ownedFields: PLAYER_OWNED_FIELDS,
    accept: withAutoApplicable(playerPlan, AUTO_APPLICABLE, e => e.externalId, acceptFor('player')),
    createLocal: (row) => ({ id: uid(), name: row.name, scoutScore: null, variations: null })
  });
  await players.set(playerMerge.records);

  // Newly-added players get placed on their hub-declared team right away —
  // there's no prior local assignment to conflict with, so this isn't a
  // membership-plan decision, it's part of accepting the ADD itself. Their
  // placement must also seed the membership snapshot (below) — otherwise the
  // *next* pull sees no baseline for them, treats their current team as an
  // unexplained local value, and misreports a genuine hub-side move as a
  // local/hub conflict instead of a clean update.
  const addedByExternalId = new Map(
    playerPlan.filter(e => e.outcome === OUTCOME.ADDED).map(e => [e.externalId, e])
  );
  const rosterByExternalId = new Map(roster.players.map(p => [p.externalId, p]));
  const addedMembershipSnapshot = {};
  if (playerMerge.applied.some(id => addedByExternalId.has(id))) {
    const teamsWithNewMembers = teams.get().map(t => ({ ...t, playerIds: [...(t.playerIds || [])] }));
    const teamsByHubId = new Map(teamsWithNewMembers.filter(t => t.hubId != null).map(t => [t.hubId, t]));
    const playersByHubId = new Map(players.get().map(p => [p.hubId, p]));
    for (const externalId of playerMerge.applied) {
      if (!addedByExternalId.has(externalId)) continue;
      const teamExternalId = rosterByExternalId.get(externalId)?.teamExternalId ?? null;
      const team = teamExternalId != null ? teamsByHubId.get(teamExternalId) : null;
      const localPlayer = playersByHubId.get(externalId);
      if (team && localPlayer && !team.playerIds.includes(localPlayer.id)) {
        team.playerIds.push(localPlayer.id);
      }
      addedMembershipSnapshot[externalId] = team ? teamExternalId : null;
    }
    await teams.set(teamsWithNewMembers);
  }

  const membershipMerge = applyMembership({
    teams: teams.get(),
    plan: membershipPlan,
    snapshot: snapshot.membership || {},
    accept: withAutoApplicable(
      membershipPlan,
      MEMBERSHIP_AUTO_APPLICABLE,
      e => e.playerExternalId,
      acceptFor('membership')
    )
  });
  await teams.set(membershipMerge.teams);
  const membershipSnapshot = { ...membershipMerge.snapshot, ...addedMembershipSnapshot };

  const accepted = teamMerge.applied.length + playerMerge.applied.length + membershipMerge.applied.length;
  const skipped = teamMerge.skipped.length + playerMerge.skipped.length + membershipMerge.skipped.length;
  const status = skipped > 0 ? 'PARTIAL' : 'SUCCESS';

  await bridge.update(curr => ({
    ...curr,
    leagueName: roster.league?.name ?? curr.leagueName,
    season: roster.league?.season ?? curr.season,
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: status,
    lastSyncError: null,
    lastSyncErrorCode: null,
    lastSyncAccepted: accepted,
    lastSyncSkipped: skipped,
    snapshot: {
      teams: teamMerge.snapshot,
      players: playerMerge.snapshot,
      membership: membershipSnapshot
    }
  }));

  res.json({
    status,
    accepted,
    skipped,
    departed: {
      teams: teamMerge.departed,
      players: playerMerge.departed
    }
  });
});

module.exports = router;
