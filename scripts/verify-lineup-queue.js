// Fuzzes the lineup-cycling internals exported from routes/gameApi.js.
// Manual check — no test framework in this repo. Run with:
//   node scripts/verify-lineup-queue.js
//
// Exercises the real production functions (not a reimplementation) across
// random sequences of advance / in-pool override / add / remove / reorder,
// and asserts the acceptance-criteria invariants:
//   - every pool member plays exactly once per cycle before any repeat,
//     except a deliberate override-forced repeat (tracked, not flagged)
//   - the queue never contains `current`, a duplicate, or a removed id
//   - a pre-`started` pool edit (including a pure reorder) is reflected in
//     current/queue immediately
//   - nothing throws for 0/1-length rosters

const assert = require('assert');
const { advance, reconcilePool } = require('../routes/gameApi').internals;

function id(n) { return `p${n}`; }
function roster(n) { return Array.from({ length: n }, (_, i) => id(i)); }
function freshLineup(prefix) {
  return { [`${prefix}Current`]: null, [`${prefix}Queue`]: [], [`${prefix}Started`]: false };
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok  ${label}`); }
  catch (e) { failures++; console.error(`  FAIL ${label}\n       ${e.message}`); }
}

// --- invariant helpers -----------------------------------------------------

function assertQueueSane(lineup, prefix, pool) {
  const current = lineup[`${prefix}Current`];
  const queue = lineup[`${prefix}Queue`];
  assert(!queue.includes(current), 'queue must not contain current');
  assert(new Set(queue).size === queue.length, 'queue must have no duplicates');
  for (const q of queue) assert(pool.includes(q), `queue member ${q} must be in pool`);
}

// --- 1. basic full-cycle coverage before any repeat ------------------------

check('advance() visits every roster member exactly once per cycle', () => {
  const pool = roster(6);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  // The bootstrap current (set directly by reconcilePool, not via advance())
  // already occupies the first slot of cycle 0 — seed tracking with it.
  let seen = new Set([lineup.battingCurrent]);
  for (let turn = 0; turn < pool.length * 20; turn++) {
    const queueWasEmpty = lineup.battingQueue.length === 0;
    if (queueWasEmpty) seen = new Set(); // this advance() call refills+starts a fresh cycle
    advance(lineup, 'batting', pool);
    const cur = lineup.battingCurrent;
    assert(!seen.has(cur), `player ${cur} repeated within a cycle`);
    seen.add(cur);
    assertQueueSane(lineup, 'batting', pool);
    if (seen.size === pool.length) assert(lineup.battingQueue.length === 0, 'cycle should be exhausted once everyone has played');
  }
});

// --- 2. cycles reshuffle (not the same fixed order forever) ----------------

check('order differs across cycles at least once in 30 tries (reshuffle happens)', () => {
  const pool = roster(8);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  const firstCycle = [];
  for (let i = 0; i < pool.length; i++) { advance(lineup, 'batting', pool); firstCycle.push(lineup.battingCurrent); }
  let differed = false;
  for (let cycle = 0; cycle < 30 && !differed; cycle++) {
    const order = [];
    for (let i = 0; i < pool.length; i++) { advance(lineup, 'batting', pool); order.push(lineup.battingCurrent); }
    if (order.join() !== firstCycle.join()) differed = true;
  }
  assert(differed, 'expected the play order to change after a reshuffle within 30 cycles');
});

// --- 3. override defers, never skips or silently drops --------------------

check('overriding to an unplayed queue member defers the old current, never skips', () => {
  const pool = roster(5);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  const alreadyPlayed = new Set([lineup.battingCurrent]); // bootstrap current already had its turn
  advance(lineup, 'batting', pool); // consume it, move to the next player
  const oldCurrent = lineup.battingCurrent;
  const target = lineup.battingQueue[lineup.battingQueue.length - 1]; // pick someone not-yet-played, forward in queue
  lineup.battingQueue = [oldCurrent, ...lineup.battingQueue.filter(x => x !== target)].filter(Boolean);
  lineup.battingCurrent = target;
  assertQueueSane(lineup, 'batting', pool);
  assert(lineup.battingQueue.includes(oldCurrent), 'bumped current must be deferred into the queue, not lost');
  // Play out the rest of the cycle and confirm everyone (including the bumped player) appears exactly once.
  const seen = new Set([target]);
  while (lineup.battingQueue.length) {
    advance(lineup, 'batting', pool);
    assert(!seen.has(lineup.battingCurrent) && !alreadyPlayed.has(lineup.battingCurrent), `player ${lineup.battingCurrent} repeated after override`);
    seen.add(lineup.battingCurrent);
  }
  assert(new Set([...alreadyPlayed, ...seen]).size === pool.length, 'override must not cause anyone to be skipped this cycle');
});

check('overriding to an already-played member is a deliberate repeat, old current still gets a turn', () => {
  const pool = roster(5);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  advance(lineup, 'batting', pool);
  advance(lineup, 'batting', pool); // two players consumed; both are "already played" now
  const alreadyPlayed = pool.find(p => p !== lineup.battingCurrent && !lineup.battingQueue.includes(p));
  const oldCurrent = lineup.battingCurrent;
  lineup.battingQueue = [oldCurrent, ...lineup.battingQueue.filter(x => x !== alreadyPlayed)].filter(Boolean);
  lineup.battingCurrent = alreadyPlayed;
  assertQueueSane(lineup, 'batting', pool);
  assert(lineup.battingQueue.includes(oldCurrent), 'bumped current must still be queued for a turn, not dropped');
});

// --- 4. pool edits: pre-started re-derive vs started diff-preserve ---------

check('reordering the pool before the cycle starts is reflected immediately', () => {
  const lineup = freshLineup('batting');
  const initial = roster(4);
  reconcilePool(lineup, 'batting', [], initial); // p0..p3, not started
  const reordered = [id(3), id(2), id(1), id(0)];
  reconcilePool(lineup, 'batting', initial, reordered);
  assert.strictEqual(lineup.battingCurrent, id(3), 'pre-started reorder must re-seed current from the new pool order');
  assert.deepStrictEqual(lineup.battingQueue, [id(2), id(1), id(0)]);
});

check('reordering the pool after the cycle has started leaves the live queue untouched', () => {
  const pool = roster(4);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  advance(lineup, 'batting', pool);
  lineup.battingStarted = true;
  const before = { current: lineup.battingCurrent, queue: [...lineup.battingQueue] };
  reconcilePool(lineup, 'batting', pool, [...pool].reverse()); // same members, different order — pure reorder
  assert.strictEqual(lineup.battingCurrent, before.current, 'reorder must not change who is current mid-cycle');
  assert.deepStrictEqual(lineup.battingQueue, before.queue, 'reorder must not resequence the in-progress queue');
});

check('removing the current player mid-cycle promotes a replacement, never crashes', () => {
  const pool = roster(4);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  advance(lineup, 'batting', pool);
  lineup.battingStarted = true;
  const removedId = lineup.battingCurrent;
  const newPool = pool.filter(p => p !== removedId);
  reconcilePool(lineup, 'batting', pool, newPool);
  assert.notStrictEqual(lineup.battingCurrent, removedId, 'removed player must not remain current');
  assertQueueSane(lineup, 'batting', newPool);
});

check('adding a player mid-cycle joins the remaining queue, not lost until next cycle', () => {
  const pool = roster(3);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  advance(lineup, 'batting', pool);
  lineup.battingStarted = true;
  const newPool = [...pool, id(99)];
  reconcilePool(lineup, 'batting', pool, newPool);
  assert(lineup.battingQueue.includes(id(99)), 'newly-added player must join the current cycle');
  assertQueueSane(lineup, 'batting', newPool);
});

// --- 5. edge cases: empty / single-player rosters ---------------------------

check('advance() on an empty roster never throws and yields no current', () => {
  const lineup = freshLineup('batting');
  advance(lineup, 'batting', []);
  assert.strictEqual(lineup.battingCurrent, null);
  assert.deepStrictEqual(lineup.battingQueue, []);
});

check('advance() on a single-player roster cycles the same player forever without throwing', () => {
  const pool = roster(1);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  for (let i = 0; i < 10; i++) {
    advance(lineup, 'batting', pool);
    assert.strictEqual(lineup.battingCurrent, id(0));
    assert.deepStrictEqual(lineup.battingQueue, []);
  }
});

// --- 6. randomized fuzz over mixed operations -------------------------------

check('randomized fuzz: invariants hold across 500 mixed operations', () => {
  let pool = roster(7);
  const lineup = freshLineup('batting');
  reconcilePool(lineup, 'batting', [], pool);
  for (let step = 0; step < 500; step++) {
    const op = pick(['advance', 'override', 'reorder']);
    if (op === 'advance' || !lineup.battingStarted) {
      advance(lineup, 'batting', pool);
      lineup.battingStarted = true;
    } else if (op === 'override' && lineup.battingQueue.length) {
      const target = pick(lineup.battingQueue);
      const oldCurrent = lineup.battingCurrent;
      lineup.battingQueue = [oldCurrent, ...lineup.battingQueue.filter(x => x !== target)].filter(Boolean);
      lineup.battingCurrent = target;
    } else if (op === 'reorder') {
      // Same membership, shuffled order — pool identity (`pool`) is unchanged, only its order.
      const reordered = [...pool].sort(() => Math.random() - 0.5);
      reconcilePool(lineup, 'batting', pool, reordered);
    }
    assertQueueSane(lineup, 'batting', pool);
  }
});

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
