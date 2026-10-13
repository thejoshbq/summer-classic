'use strict';

/**
 * Reconciles which local team a synced player belongs to.
 *
 * leagueSync's planMerge/applyMerge model a hub-owned field as a scalar on
 * one record (ownedFields + Object.assign). Team membership isn't that: in
 * summer-classic it lives as teams[].playerIds[], a list on the OTHER side
 * of the relationship, with no `teamId` field on the player row at all. So
 * it can't flow through the generic engine — this module applies the same
 * three-way (local vs. snapshot vs. incoming) reasoning by hand, for this
 * one relationship, without touching lib/leagueSync.js.
 *
 * Never reorders an existing team's playerIds: a hub-driven move removes the
 * player from their old team's list and appends them to the new one, so
 * draft order for everyone who didn't move is untouched.
 */

const OUTCOME = {
  ADDED: 'added',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  LOCAL_ONLY: 'localOnly',
  LOCAL_MODIFIED: 'localModified'
};

/** Which local team (by hubId), if any, currently lists this player. */
function currentTeamHubId(playerId, teams) {
  const team = teams.find(t => (t.playerIds || []).includes(playerId));
  return team ? team.hubId ?? null : null;
}

/**
 * @param {object}   args
 * @param {object[]} args.localPlayers   players.json rows (post player-merge, hubId populated)
 * @param {object[]} args.localTeams     teams.json rows (post team-merge, hubId populated)
 * @param {object[]} args.incomingPlayers  hub rows: [{ externalId, teamExternalId }]
 * @param {object}   args.snapshot       externalId -> teamExternalId|null, as last applied
 * @returns {{outcome:string, playerExternalId:string, playerId:string, playerName:string,
 *            fromTeamHubId:string|null, toTeamHubId:string|null}[]}
 */
function planMembership({ localPlayers, localTeams, incomingPlayers, snapshot }) {
  const byHubId = new Map();
  for (const p of localPlayers) {
    if (p.hubId != null) byHubId.set(p.hubId, p);
  }

  const plan = [];
  for (const row of incomingPlayers) {
    const player = byHubId.get(row.externalId);
    // Not a hub-tracked local player yet — either a brand-new ADDED row (the
    // route places these directly at creation, no conflict is possible), or
    // one the operator hasn't accepted yet. Either way, nothing to reconcile
    // until the player actually exists locally.
    if (!player) continue;

    const toTeamHubId = row.teamExternalId ?? null;
    const fromTeamHubId = currentTeamHubId(player.id, localTeams);
    const hasSnapshot = Object.prototype.hasOwnProperty.call(snapshot, row.externalId);
    const snapTeamHubId = hasSnapshot ? snapshot[row.externalId] : undefined;

    let outcome;
    if (!hasSnapshot) {
      // No snapshot: either the first pull after this player was placed by
      // hand, or the snapshot was lost. Can't prove the local assignment came
      // from the hub, so any mismatch needs consent rather than a silent
      // overwrite — same rule leagueSync.js applies to a missing snapshot.
      outcome = toTeamHubId === fromTeamHubId ? OUTCOME.UNCHANGED : OUTCOME.LOCAL_MODIFIED;
    } else {
      const hubChanged = toTeamHubId !== snapTeamHubId;
      const localChanged = fromTeamHubId !== snapTeamHubId;
      if (hubChanged && localChanged) {
        // Both moved since the last pull — a venue reassignment and a hub
        // change disagree. Applying would silently discard the venue move.
        outcome = fromTeamHubId === toTeamHubId ? OUTCOME.UNCHANGED : OUTCOME.LOCAL_MODIFIED;
      } else if (hubChanged) {
        outcome = OUTCOME.UPDATED;
      } else if (localChanged) {
        // Hub is unmoved; the venue reassigned this player locally. Nothing
        // to import, and nothing at risk.
        outcome = OUTCOME.LOCAL_ONLY;
      } else {
        outcome = OUTCOME.UNCHANGED;
      }
    }

    if (outcome === OUTCOME.UNCHANGED) continue;

    plan.push({
      outcome,
      playerExternalId: row.externalId,
      playerId: player.id,
      playerName: player.name,
      fromTeamHubId,
      toTeamHubId
    });
  }

  return plan;
}

/** Applied without operator consent, same as leagueSync's ADDED/UPDATED — the hub moved, local didn't. */
const AUTO_APPLICABLE = new Set([OUTCOME.UPDATED]);

/** Which outcomes `accept` may name at all; LOCAL_ONLY is force-skipped regardless, same rationale as leagueSync. */
const ACCEPTABLE = new Set([OUTCOME.UPDATED, OUTCOME.LOCAL_MODIFIED]);

/**
 * Apply accepted membership moves for players the hub already tracked before
 * this pull. A brand-new player (ADDED in the player plan) doesn't go through
 * here at all — there's no prior local team assignment to conflict with, so
 * the route places them on their hub-declared team directly at creation time,
 * the same moment it accepts the ADD itself.
 *
 * Mirrors applyMerge's snapshot-advance rule: a skipped conflict keeps its
 * old snapshot entry so the next pull still sees it as a conflict rather
 * than quietly adopting the hub's value.
 *
 * @returns {{teams: object[], snapshot: object, applied: string[], skipped: string[]}}
 */
function applyMembership({ teams, plan, snapshot = {}, accept = [] }) {
  const acceptSet = new Set(accept);

  const nextTeams = teams.map(t => ({ ...t, playerIds: [...(t.playerIds || [])] }));
  const nextByHubId = new Map();
  for (const t of nextTeams) {
    if (t.hubId != null) nextByHubId.set(t.hubId, t);
  }

  const nextSnapshot = { ...snapshot };
  const applied = [];
  const skipped = [];

  for (const entry of plan) {
    if (!ACCEPTABLE.has(entry.outcome)) continue;
    if (!acceptSet.has(entry.playerExternalId)) {
      skipped.push(entry.playerExternalId);
      continue;
    }

    const fromTeam = entry.fromTeamHubId != null ? nextByHubId.get(entry.fromTeamHubId) : null;
    if (fromTeam) fromTeam.playerIds = fromTeam.playerIds.filter(pid => pid !== entry.playerId);

    const toTeam = entry.toTeamHubId != null ? nextByHubId.get(entry.toTeamHubId) : null;
    if (toTeam && !toTeam.playerIds.includes(entry.playerId)) {
      toTeam.playerIds.push(entry.playerId);
    }

    nextSnapshot[entry.playerExternalId] = entry.toTeamHubId;
    applied.push(entry.playerExternalId);
  }

  return { teams: nextTeams, snapshot: nextSnapshot, applied, skipped };
}

module.exports = { OUTCOME, AUTO_APPLICABLE, ACCEPTABLE, planMembership, applyMembership, currentTeamHubId };
