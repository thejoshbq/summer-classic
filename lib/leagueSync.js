'use strict';

/**
 * Pull a league roster from the Lumber Jill's hub and merge it into this app's
 * local stores.
 *
 * The merge is three-way — local vs. last-synced snapshot vs. incoming — because
 * a season's roster gets hand-corrected at the venue between pulls. Comparing
 * only local-vs-incoming cannot tell "the hub changed this" apart from "a
 * staffer fixed a typo at 7pm on league night", and guessing wrong destroys the
 * correction. The snapshot is what makes those two distinguishable.
 *
 * Nothing here deletes. woodchuck's nights.json keys attendance as
 * teamId -> playerId[], so dropping a roster row silently orphans historical
 * scoring — the same hazard DELETE /api/players/:id already guards with a
 * scrub-cascade and a 409 against locked nights. Departed rows are reported for
 * the caller to flag, never removed.
 */

/** A record the hub owns, keyed locally by `hubId`. */
const HUB_ID_KEY = 'hubId';

/**
 * Buckets a merge sorts incoming rows into. `localModified` is the only one a
 * caller must not apply without explicit per-row consent.
 */
const OUTCOME = {
  ADDED: 'added',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  LOCAL_ONLY: 'localOnly',
  LOCAL_MODIFIED: 'localModified',
  DEPARTED: 'departed'
};

function pick(source, fields) {
  const out = {};
  for (const f of fields) out[f] = source == null ? undefined : source[f];
  return out;
}

function shallowEqual(a, b, fields) {
  for (const f of fields) {
    const av = a == null ? undefined : a[f];
    const bv = b == null ? undefined : b[f];
    // Treat null and undefined as the same absence: the hub omits optional
    // fields while a local JSON round-trip preserves them as null.
    if (av == null && bv == null) continue;
    if (av !== bv) return false;
  }
  return true;
}

/**
 * Sort incoming hub rows against local state and the last-synced snapshot.
 *
 * @param {object}   args
 * @param {object[]} args.local      current local records
 * @param {object}   args.snapshot   externalId -> hub-owned fields as last applied
 * @param {object[]} args.incoming   rows from the hub, each carrying `externalId`
 * @param {string[]} args.ownedFields fields the hub owns; everything else is local-only
 * @param {string}   [args.idKey]    local property holding the hub's externalId
 * @returns {{outcome: string, externalId: string, incoming?: object, local?: object, changes?: object}[]}
 */
function planMerge({ local, snapshot, incoming, ownedFields, idKey = HUB_ID_KEY }) {
  const byHubId = new Map();
  for (const row of local) {
    const id = row[idKey];
    if (id != null) byHubId.set(id, row);
  }

  const plan = [];
  const seen = new Set();

  for (const row of incoming) {
    const id = row.externalId;
    // A repeated externalId means the hub broke its own uniqueness guarantee.
    // Fail loudly: quietly picking a winner would double-create the row on a
    // first sync, and on later ones would let the last copy win at random.
    if (seen.has(id)) {
      throw new Error(`Duplicate externalId in roster payload: ${id}`);
    }
    seen.add(id);
    const localRow = byHubId.get(id);

    if (!localRow) {
      plan.push({ outcome: OUTCOME.ADDED, externalId: id, incoming: row });
      continue;
    }

    const snap = snapshot[id];
    const incomingMatchesLocal = shallowEqual(row, localRow, ownedFields);

    // No snapshot: either the first pull after this row was created by hand, or
    // the snapshot was lost. We cannot prove the local values came from the hub,
    // so anything differing needs consent rather than a silent overwrite.
    if (!snap) {
      plan.push(
        incomingMatchesLocal
          ? { outcome: OUTCOME.UNCHANGED, externalId: id, incoming: row, local: localRow }
          : {
              outcome: OUTCOME.LOCAL_MODIFIED,
              externalId: id,
              incoming: row,
              local: localRow,
              changes: pick(row, ownedFields)
            }
      );
      continue;
    }

    const hubChanged = !shallowEqual(row, snap, ownedFields);
    const localChanged = !shallowEqual(localRow, snap, ownedFields);

    let outcome;
    if (hubChanged && localChanged) {
      // Both moved since the last pull. Applying would discard the venue edit.
      outcome = incomingMatchesLocal ? OUTCOME.UNCHANGED : OUTCOME.LOCAL_MODIFIED;
    } else if (hubChanged) {
      outcome = OUTCOME.UPDATED;
    } else if (localChanged) {
      // Hub is unmoved, so there is nothing to apply and nothing at risk.
      outcome = OUTCOME.LOCAL_ONLY;
    } else {
      outcome = OUTCOME.UNCHANGED;
    }

    plan.push({
      outcome,
      externalId: id,
      incoming: row,
      local: localRow,
      changes: pick(row, ownedFields)
    });
  }

  // Rows the hub no longer returns — cancelled, or filtered out by status.
  for (const [id, localRow] of byHubId) {
    if (!seen.has(id)) {
      plan.push({ outcome: OUTCOME.DEPARTED, externalId: id, local: localRow });
    }
  }

  return plan;
}

/**
 * Which outcomes are applied when the caller passes no explicit `accept` list.
 * `localModified` is absent by design — it needs consent.
 */
const AUTO_APPLICABLE = new Set([OUTCOME.ADDED, OUTCOME.UPDATED]);

/**
 * Which outcomes `accept` is even allowed to name.
 *
 * unchanged/localOnly/departed are absent deliberately, and force-skipped below
 * regardless of what a caller asks for. A localOnly row is one where the hub has
 * NOT moved and a staffer has — "applying" it writes the hub's stale value over
 * the venue's edit and advances the snapshot, so the edit is gone without a
 * trace. That is the exact failure this module exists to prevent, and it must
 * not be reachable by a UI that treats "accept" as a generic checkbox.
 */
const ACCEPTABLE = new Set([OUTCOME.ADDED, OUTCOME.UPDATED, OUTCOME.LOCAL_MODIFIED]);

/**
 * Apply selected plan entries onto local records, writing only hub-owned fields.
 * Local-only fields (declaredRoster, rosterLockedAt, captainId, scoutScore, …)
 * are never touched — the hub has no opinion on them.
 *
 * @returns {{records: object[], snapshot: object, applied: string[], skipped: string[], departed: string[]}}
 */
function applyMerge({
  local,
  snapshot,
  plan,
  ownedFields,
  accept,
  idKey = HUB_ID_KEY,
  createLocal
}) {
  // NOTE: an omitted `accept` means "apply the auto-applicable defaults"; an
  // empty array means "apply nothing". [] is truthy, so those are NOT the same
  // call — a caller that passes a selection list which happens to be empty
  // suppresses every add and update, not just the conflicts. Callers should
  // build the full list explicitly (auto-applicable ids from the plan, plus
  // whatever the operator checked) rather than relying on that distinction.
  const acceptSet = accept
    ? new Set(accept)
    : new Set(plan.filter((e) => AUTO_APPLICABLE.has(e.outcome)).map((e) => e.externalId));

  const records = local.map((r) => ({ ...r }));
  const byHubId = new Map();
  for (const row of records) {
    const id = row[idKey];
    if (id != null) byHubId.set(id, row);
  }

  const nextSnapshot = { ...snapshot };
  const applied = [];
  const skipped = [];
  const departed = [];

  for (const entry of plan) {
    if (entry.outcome === OUTCOME.DEPARTED) {
      // Surfaced in the return value so a caller doesn't have to re-scan the
      // plan to find rows the hub stopped sending. Never removed here.
      departed.push(entry.externalId);
      continue;
    }
    // Nothing pending, or pending only in a direction that must not be
    // overwritten. Not "skipped" — there was never anything to take.
    if (!ACCEPTABLE.has(entry.outcome)) continue;
    if (!acceptSet.has(entry.externalId)) {
      skipped.push(entry.externalId);
      continue;
    }

    if (entry.outcome === OUTCOME.ADDED) {
      const created = createLocal(entry.incoming);
      created[idKey] = entry.externalId;
      records.push(created);
      byHubId.set(entry.externalId, created);
    } else {
      const target = byHubId.get(entry.externalId);
      if (!target) {
        skipped.push(entry.externalId);
        continue;
      }
      Object.assign(target, pick(entry.incoming, ownedFields));
    }

    // Snapshot advances only for rows actually applied. A skipped row keeps its
    // old snapshot so the next pull still sees the conflict rather than
    // silently adopting the hub's value.
    nextSnapshot[entry.externalId] = pick(entry.incoming, ownedFields);
    applied.push(entry.externalId);
  }

  return { records, snapshot: nextSnapshot, applied, skipped, departed };
}

/**
 * Fetch a roster payload from the hub.
 *
 * Refuses plaintext transport before the credential leaves the process: the
 * bearer token grants read access to registrant contact details, and a
 * misconfigured local override must not be able to put it on the wire in the
 * clear.
 */
async function fetchRoster({ baseUrl, leagueId, token, fetchImpl = globalThis.fetch }) {
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error('Hub URL must use https — refusing to send the connection key over plaintext.');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/league-sync/v1/leagues/${encodeURIComponent(leagueId)}/roster`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });

  if (res.status === 401) {
    const err = new Error('This connection key is no longer valid. Ask the league admin for a new one.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  if (res.status === 404) {
    const err = new Error('This league is no longer available from the hub.');
    err.code = 'LEAGUE_UNAVAILABLE';
    throw err;
  }
  if (res.status === 429) {
    const err = new Error('The hub is rate limiting this connection. Try again shortly.');
    err.code = 'RATE_LIMITED';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Hub returned ${res.status}.`);
    err.code = 'HUB_ERROR';
    throw err;
  }

  return res.json();
}

/** Split the single string an operator pastes: `<leagueId>.<token>`. */
function parseConnectionString(value) {
  const trimmed = String(value == null ? '' : value).trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  return { leagueId: trimmed.slice(0, dot), token: trimmed.slice(dot + 1) };
}

module.exports = {
  OUTCOME,
  AUTO_APPLICABLE,
  ACCEPTABLE,
  planMerge,
  applyMerge,
  fetchRoster,
  parseConnectionString,
  shallowEqual
};
