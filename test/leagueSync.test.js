'use strict';

/**
 * The merge is the only part of the bridge that can destroy data a staffer
 * typed. These tests are written against that risk: every case that ends in
 * "a local edit survives" is load-bearing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OUTCOME,
  planMerge,
  applyMerge,
  fetchRoster,
  parseConnectionString
} = require('../lib/leagueSync');

const OWNED = ['name', 'teamId'];
const createLocal = (row) => ({ id: 'local-' + row.externalId, name: row.name, teamId: row.teamId, active: true });

function setup() {
  const local = [
    { id: 'p1', hubId: 'h1', name: 'Josh', teamId: 't1', active: true },
    { id: 'p2', hubId: 'h2', name: 'Macy', teamId: 't2', active: true }
  ];
  const snapshot = {
    h1: { name: 'Josh', teamId: 't1' },
    h2: { name: 'Macy', teamId: 't2' }
  };
  const incoming = [
    { externalId: 'h1', name: 'Josh', teamId: 't1' },
    { externalId: 'h2', name: 'Macy', teamId: 't2' }
  ];
  return { local, snapshot, incoming };
}

test('identical state produces no work', () => {
  const { local, snapshot, incoming } = setup();
  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan.length, 2);
  assert.ok(plan.every((e) => e.outcome === OUTCOME.UNCHANGED));

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.records, local);
});

test('re-pulling twice writes nothing the second time', () => {
  const { local, snapshot } = setup();
  const incoming = [
    { externalId: 'h1', name: 'Joshua', teamId: 't1' },
    { externalId: 'h2', name: 'Macy', teamId: 't2' }
  ];

  const first = applyMerge({
    local,
    snapshot,
    plan: planMerge({ local, snapshot, incoming, ownedFields: OWNED }),
    ownedFields: OWNED,
    createLocal
  });
  assert.deepEqual(first.applied, ['h1']);

  const second = planMerge({
    local: first.records,
    snapshot: first.snapshot,
    incoming,
    ownedFields: OWNED
  });
  assert.ok(second.every((e) => e.outcome === OUTCOME.UNCHANGED));
});

test('a new hub registration is added', () => {
  const { local, snapshot, incoming } = setup();
  incoming.push({ externalId: 'h3', name: 'Eric', teamId: 't1' });

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const added = plan.find((e) => e.externalId === 'h3');
  assert.equal(added.outcome, OUTCOME.ADDED);

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.equal(result.records.length, 3);
  assert.equal(result.records[2].hubId, 'h3');
  assert.equal(result.records[2].name, 'Eric');
});

test('a hub-side rename applies cleanly', () => {
  const { local, snapshot, incoming } = setup();
  incoming[0].name = 'Joshua';

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.UPDATED);

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.equal(result.records[0].name, 'Joshua');
});

test('a venue edit survives when the hub has not moved', () => {
  const { local, snapshot, incoming } = setup();
  local[0].name = 'Big Josh';

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_ONLY);

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.equal(result.records[0].name, 'Big Josh');
  assert.deepEqual(result.applied, []);
});

test('a venue edit is never silently overwritten when both sides moved', () => {
  const { local, snapshot, incoming } = setup();
  local[0].name = 'Big Josh';
  incoming[0].name = 'Joshua';

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_MODIFIED);

  // Default accept set excludes localModified entirely.
  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.equal(result.records[0].name, 'Big Josh');
  assert.ok(result.skipped.includes('h1'));
});

test('a conflict can be resolved by explicit per-row acceptance', () => {
  const { local, snapshot, incoming } = setup();
  local[0].name = 'Big Josh';
  incoming[0].name = 'Joshua';

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const result = applyMerge({
    local,
    snapshot,
    plan,
    ownedFields: OWNED,
    createLocal,
    accept: ['h1']
  });
  assert.equal(result.records[0].name, 'Joshua');
  assert.deepEqual(result.applied, ['h1']);
});

test('a skipped conflict stays a conflict on the next pull', () => {
  const { local, snapshot, incoming } = setup();
  local[0].name = 'Big Josh';
  incoming[0].name = 'Joshua';

  const first = applyMerge({
    local,
    snapshot,
    plan: planMerge({ local, snapshot, incoming, ownedFields: OWNED }),
    ownedFields: OWNED,
    createLocal
  });

  // The snapshot must NOT have advanced for the skipped row, or the next pull
  // would read the hub's value as unchanged and quietly adopt it.
  const second = planMerge({
    local: first.records,
    snapshot: first.snapshot,
    incoming,
    ownedFields: OWNED
  });
  assert.equal(second[0].outcome, OUTCOME.LOCAL_MODIFIED);
});

test('local-only fields are never touched by a sync', () => {
  const { local, snapshot, incoming } = setup();
  local[0].active = false;
  local[0].rosterLockedAt = '2026-09-09T00:00:00.000Z';
  incoming[0].name = 'Joshua';

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });

  assert.equal(result.records[0].name, 'Joshua');
  assert.equal(result.records[0].active, false);
  assert.equal(result.records[0].rosterLockedAt, '2026-09-09T00:00:00.000Z');
});

test('a row the hub stopped returning is reported, never deleted', () => {
  const { local, snapshot, incoming } = setup();
  incoming.pop();

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const departed = plan.find((e) => e.outcome === OUTCOME.DEPARTED);
  assert.equal(departed.externalId, 'h2');

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.equal(result.records.length, 2, 'departed rows must survive the merge');
});

test('purely local records are left alone', () => {
  const { local, snapshot, incoming } = setup();
  local.push({ id: 'p9', name: 'Walk-in', teamId: 't1', active: true });

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan.filter((e) => e.outcome === OUTCOME.DEPARTED).length, 0);

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.ok(result.records.some((r) => r.id === 'p9'));
});

test('a missing snapshot is treated as a conflict, not a free overwrite', () => {
  const { local, incoming } = setup();
  incoming[0].name = 'Joshua';

  const plan = planMerge({ local, snapshot: {}, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_MODIFIED);
  assert.equal(plan[1].outcome, OUTCOME.UNCHANGED);
});

test('null and undefined are the same absence', () => {
  const local = [{ id: 'p1', hubId: 'h1', name: 'Josh', teamId: null }];
  const snapshot = { h1: { name: 'Josh' } };
  const incoming = [{ externalId: 'h1', name: 'Josh', teamId: null }];

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.UNCHANGED);
});

test('a field missing entirely on a fresh local record is not a false conflict against a hub-sent null', () => {
  // Unlike the case above, this row never had a teamId key at all — not
  // even an explicit null — which is what a genuinely fresh local record
  // looks like before any sync has ever touched it.
  const local = [{ id: 'p1', hubId: 'h1', name: 'Josh' }];
  const snapshot = { h1: { name: 'Josh', teamId: null } };
  const incoming = [{ externalId: 'h1', name: 'Josh', teamId: null }];

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.UNCHANGED);
});

// ---------------------------------------------------------------------------
// Adversarial probes: identity collisions the merge does not defend against.
// ---------------------------------------------------------------------------

test('a pre-existing duplicate hubId in local storage strands one row from ever syncing again', () => {
  // Two local rows already share hubId 'h9' — e.g. left over from an earlier
  // bug, or a hand-edited JSON file. byHubId is a Map keyed on hubId, so
  // building it from `local` silently collapses both rows onto whichever is
  // last in iteration order; the other is never looked up again.
  const local = [
    { id: 'a', hubId: 'h9', name: 'Stale' },
    { id: 'b', hubId: 'h9', name: 'Stale' }
  ];
  const snapshot = { h9: { name: 'Stale', teamId: undefined } };
  const incoming = [{ externalId: 'h9', name: 'Fresh', teamId: 't1' }];

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(
    plan.filter((e) => e.externalId === 'h9').length,
    1,
    'planMerge has no way to see the shadowed duplicate at all'
  );

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  const rowA = result.records.find((r) => r.id === 'a');
  const rowB = result.records.find((r) => r.id === 'b');
  assert.equal(rowB.name, 'Fresh', 'the row byHubId resolved to gets the update');
  assert.equal(
    rowA.name,
    'Stale',
    'the shadowed duplicate is a permanent zombie: never updated, and — because h9 still counts ' +
      'as "seen" via its sibling — never reported as departed either'
  );
});

test('a duplicate externalId in one payload is rejected, not silently deduped', () => {
  const { local, snapshot } = setup();
  const incoming = [
    { externalId: 'h1', name: 'Josh', teamId: 't1' },
    { externalId: 'h2', name: 'Macy', teamId: 't2' },
    { externalId: 'h3', name: 'Eric', teamId: 't1' },
    { externalId: 'h3', name: 'Eric', teamId: 't1' } // hub sent the same registration twice
  ];

  // A repeated externalId means the hub's own uniqueness guarantee broke.
  // Picking a winner would double-create the row here and let a random copy
  // win on later pulls; failing loudly is the only honest option.
  assert.throws(
    () => planMerge({ local, snapshot, incoming, ownedFields: OWNED }),
    /Duplicate externalId/
  );
});

test('a duplicate externalId for an already-known row is rejected too', () => {
  const { local, snapshot } = setup();
  const incoming = [
    { externalId: 'h1', name: 'Joshua', teamId: 't1' },
    { externalId: 'h1', name: 'Jojo', teamId: 't1' }
  ];

  assert.throws(
    () => planMerge({ local, snapshot, incoming, ownedFields: OWNED }),
    /Duplicate externalId/
  );
});

test('accepting a localOnly row cannot revert the venue edit', () => {
  const { local, snapshot, incoming } = setup();
  local[0].name = 'Big Josh';

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_ONLY);

  // Even named explicitly, a row that was never in conflict is force-skipped.
  const result = applyMerge({
    local,
    snapshot,
    plan,
    ownedFields: OWNED,
    createLocal,
    accept: ['h1']
  });
  assert.equal(result.records[0].name, 'Big Josh');
  assert.deepEqual(result.applied, []);
  assert.equal(snapshot.h1.name, 'Josh', 'snapshot must not advance for a force-skipped row');
});

test('departed rows are reported in the return value', () => {
  const { local, snapshot, incoming } = setup();
  incoming.pop();

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });

  assert.deepEqual(result.departed, ['h2']);
  assert.equal(result.records.length, 2, 'still never removed');
});

test('a stale snapshot entry for a row gone from both local and incoming is inert, not cleaned up', () => {
  const { local, incoming } = setup();
  const snapshot = {
    h1: { name: 'Josh', teamId: 't1' },
    h2: { name: 'Macy', teamId: 't2' },
    ghost: { name: 'Gone', teamId: 't9' }
  };

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.ok(!plan.some((e) => e.externalId === 'ghost'));

  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal });
  assert.deepEqual(
    result.snapshot.ghost,
    snapshot.ghost,
    'an orphaned snapshot entry is carried forward forever — there is no pruning'
  );
});

test('hubId: null, missing, and undefined on local rows are all "not hub-tracked" alike', () => {
  const local = [
    { id: 'p1', hubId: null, name: 'NullRow' },
    { id: 'p2', name: 'MissingRow' },
    { id: 'p3', hubId: undefined, name: 'UndefinedRow' }
  ];
  const incoming = [{ externalId: 'h1', name: 'FreshHubRow', teamId: 't1' }];

  const plan = planMerge({ local, snapshot: {}, incoming, ownedFields: OWNED });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].outcome, OUTCOME.ADDED, 'none of the three local rows should be mistaken for a match');
  assert.equal(
    plan.filter((e) => e.outcome === OUTCOME.DEPARTED).length,
    0,
    'unlinked local rows must never be reported as departed'
  );
});

test('an ownedFields entry naming a field no row has is vacuously equal, not a crash', () => {
  const local = [{ id: 'p1', hubId: 'h1', name: 'Josh' }];
  const snapshot = { h1: { name: 'Josh' } };
  const incoming = [{ externalId: 'h1', name: 'Josh' }];

  assert.doesNotThrow(() => {
    const plan = planMerge({ local, snapshot, incoming, ownedFields: ['name', 'shirtSize'] });
    assert.equal(plan[0].outcome, OUTCOME.UNCHANGED);
  });
});

// ---------------------------------------------------------------------------
// Adversarial probes: the snapshot-advance rule in applyMerge.
// ---------------------------------------------------------------------------

test('an accept id absent from the plan is a harmless no-op', () => {
  const { local, snapshot, incoming } = setup();
  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const result = applyMerge({
    local,
    snapshot,
    plan,
    ownedFields: OWNED,
    createLocal,
    accept: ['not-in-plan']
  });
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.records, local);
});

test('explicitly accepting a departed id does not apply it and leaves no trace in applied/skipped', () => {
  const { local, snapshot, incoming } = setup();
  incoming.pop(); // h2 departs
  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const result = applyMerge({
    local,
    snapshot,
    plan,
    ownedFields: OWNED,
    createLocal,
    accept: ['h2']
  });

  assert.ok(!result.applied.includes('h2'));
  assert.ok(
    !result.skipped.includes('h2'),
    'departed rows are invisible to both bookkeeping lists — a caller must read plan directly to find them'
  );
  assert.deepEqual(result.snapshot.h2, snapshot.h2);
  assert.equal(result.records.length, 2, 'the departed row itself must still survive');
});

test('createLocal returning a stale hubId is overwritten with the real externalId', () => {
  const { local, snapshot, incoming } = setup();
  incoming.push({ externalId: 'h3', name: 'Eric', teamId: 't1' });
  const badCreateLocal = (row) => ({ id: 'x', hubId: 'WRONG-ID', name: row.name, teamId: row.teamId });

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  const result = applyMerge({ local, snapshot, plan, ownedFields: OWNED, createLocal: badCreateLocal });

  const created = result.records.find((r) => r.id === 'x');
  assert.equal(created.hubId, 'h3', 'applyMerge must force the correct externalId regardless of what createLocal returns');
});

test('a LOCAL_ONLY row named in accept is force-skipped, not applied', () => {
  const { local, snapshot, incoming } = setup();
  local[0].name = 'Big Josh'; // staffer edit; hub has not moved since the snapshot

  const plan = planMerge({ local, snapshot, incoming, ownedFields: OWNED });
  assert.equal(plan[0].outcome, OUTCOME.LOCAL_ONLY);

  // Nothing in applyMerge distinguishes "explicitly accepting a conflict
  // resolution" (LOCAL_MODIFIED) from "explicitly accepting a row that was
  // never in conflict" (LOCAL_ONLY). A bridge UI that lets an operator select
  // a LOCAL_ONLY row — even just to "acknowledge" it — and passes that
  // selection through as `accept` will silently revert the edit the module's
  // own header describes as the whole reason the snapshot exists.
  const result = applyMerge({
    local,
    snapshot,
    plan,
    ownedFields: OWNED,
    createLocal,
    accept: ['h1']
  });

  assert.equal(
    result.records[0].name,
    'Big Josh',
    'a LOCAL_ONLY row must never be reverted by acceptance — the hub has nothing newer to offer'
  );
});

test('the connection key is never sent over plaintext', async () => {
  let called = false;
  await assert.rejects(
    () =>
      fetchRoster({
        baseUrl: 'http://hub.example.com',
        leagueId: 'l1',
        token: 'secret',
        fetchImpl: () => {
          called = true;
        }
      }),
    /https/
  );
  assert.equal(called, false, 'must refuse before the token leaves the process');
});

test('the pasted connection string splits on the first dot only', () => {
  assert.deepEqual(parseConnectionString('abc.def.ghi'), { leagueId: 'abc', token: 'def.ghi' });
  assert.equal(parseConnectionString('nodot'), null);
  assert.equal(parseConnectionString('.leading'), null);
  assert.equal(parseConnectionString('trailing.'), null);
  assert.equal(parseConnectionString('   '), null);
  assert.equal(parseConnectionString(null), null);
});
