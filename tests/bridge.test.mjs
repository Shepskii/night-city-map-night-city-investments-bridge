import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffGigs, buildReport, findRunners, createBridge, syncPins, currentDistricts } from '../scripts/bridge-0.3.1.js';

const gig = (id, status, extra = {}) => ({ id, status, title: `Gig ${id}`, client: 'Arasaka', reward: '1500 eb', ...extra });
const quiet = { info() {}, error() {} };

test('the first look only records statuses, so finished gigs are never reported', () => {
  const { next, transitions } = diffGigs(null, [gig('a', 'done'), gig('b', 'active'), gig('c', 'failed')]);
  assert.deepEqual(transitions, []);
  assert.deepEqual([...next], [['a', 'done'], ['b', 'active'], ['c', 'failed']]);
});

test('a gig that closes is reported once, with the way it closed', () => {
  const known = new Map([['a', 'active'], ['b', 'active'], ['c', 'offer'], ['d', 'hidden']]);
  const { transitions, next } = diffGigs(known, [gig('a', 'done'), gig('b', 'failed'), gig('c', 'active'), gig('d', 'done')]);
  assert.deepEqual(transitions.map((t) => [t.gig.id, t.outcome, t.from]), [['a', 'done', 'active'], ['b', 'failed', 'active'], ['d', 'done', 'hidden']]);
  assert.equal(diffGigs(next, [gig('a', 'done'), gig('b', 'failed')]).transitions.length, 0, 'not again on the next look');
});

test('flipping between done and failed, reopening, new gigs and deleted gigs are not outcomes', () => {
  const known = new Map([['a', 'done'], ['b', 'failed'], ['gone', 'active']]);
  const out = diffGigs(known, [gig('a', 'failed'), gig('b', 'done'), gig('fresh', 'done'), gig('x', 'active')]);
  assert.deepEqual(out.transitions, [], 'a gig created already finished is not counted either');
  assert.equal(out.next.has('gone'), false, 'a deleted gig is forgotten');
  const reopened = diffGigs(new Map([['a', 'done']]), [gig('a', 'active')]);
  assert.deepEqual(reopened.transitions, []);
  assert.equal(diffGigs(reopened.next, [gig('a', 'done')]).transitions.length, 1, 'but closing it again is');
  assert.deepEqual(diffGigs(null, undefined).transitions, []);
  assert.deepEqual([...diffGigs(null, [{ status: 'done' }, null]).next], []);
});

test('the report carries the client, reward, notes and runner, and a stable key', () => {
  const r = buildReport({ id: 'q1', status: 'done', client: '  Arasaka ', reward: 2000, title: 'Courier', desc: 'Deliver a case', notes: '[NCI: ARA]', giver: 'poi1', target: 'poi2', takenBy: 'V' }, 'done', ['a_v']);
  assert.deepEqual(r, {
    gigId: 'q1', sourceKey: 'gig:q1:done', outcome: 'done', client: 'Arasaka', reward: '2000', title: 'Courier', desc: 'Deliver a case', notes: '[NCI: ARA]',
    takenBy: 'V', runners: ['a_v'],
  });
  assert.deepEqual(buildReport({ id: 'q2' }, 'failed'), {
    gigId: 'q2', sourceKey: 'gig:q2:failed', outcome: 'failed', client: '', reward: '', title: '', desc: '', notes: '', takenBy: '', runners: [],
  });
});

test('the runner is the character the map named, or the character of the user it named', () => {
  const v = { id: 'a_v', type: 'character', name: 'V' };
  const jackie = { id: 'a_j', type: 'character', name: 'Jackie' };
  const world = { actors: [{ id: 'npc', type: 'npc', name: 'V' }, v, jackie], users: [{ name: 'Sam', character: jackie }, { name: 'Alex', character: null }] };
  assert.deepEqual(findRunners('V', world), ['a_v'], 'a character of that name, not an NPC');
  assert.deepEqual(findRunners(' Sam ', world), ['a_j'], 'a player with no character of that name: their character');
  assert.deepEqual(findRunners('Alex', world), [], 'a player with no character');
  assert.deepEqual(findRunners('', world), []);
  assert.deepEqual(findRunners(undefined, world), []);
});

function harness(overrides = {}) {
  const state = { gigs: [gig('a', 'active'), gig('b', 'offer')], gm: true, enabled: true, api: undefined, warnings: [] };
  const calls = [];
  state.api = { events: { reportImpact: async (p) => { calls.push(p); return { ok: true, status: 'pending' }; } } };
  const bridge = createBridge({
    getGigs: () => state.gigs,
    getApi: () => state.api,
    isActiveGM: () => state.gm,
    enabled: () => state.enabled,
    warn: (k) => state.warnings.push(k),
    logger: quiet,
    ...overrides,
  });
  return { state, calls, bridge };
}

test('a closed gig is reported to Night City Investments once', async () => {
  const { state, calls, bridge } = harness();
  await bridge.scan();
  state.gigs = [gig('a', 'done', { notes: 'x' }), gig('b', 'offer')];
  await bridge.scan();
  await bridge.scan();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceKey, 'gig:a:done');
  assert.equal(calls[0].client, 'Arasaka');
  assert.equal(bridge.outbox.size, 0);
});

test('only the active GM reports, but every GM keeps track so a handover loses nothing', async () => {
  const { state, calls, bridge } = harness();
  await bridge.scan();
  state.gm = false;
  state.gigs = [gig('a', 'failed'), gig('b', 'offer')];
  await bridge.scan();
  assert.equal(calls.length, 0, 'not the active GM');
  state.gm = true;
  await bridge.scan();
  assert.equal(calls.length, 0, 'it was seen while someone else was in charge, and they report it');
  state.gigs = [gig('a', 'failed'), gig('b', 'done')];
  await bridge.scan();
  assert.deepEqual(calls.map((c) => c.sourceKey), ['gig:b:done']);
});

test('switching reporting off drops outcomes that happen meanwhile', async () => {
  const { state, calls, bridge } = harness();
  await bridge.scan();
  state.enabled = false;
  state.gigs = [gig('a', 'done'), gig('b', 'offer')];
  await bridge.scan();
  state.enabled = true;
  state.gigs = [gig('a', 'done'), gig('b', 'failed')];
  await bridge.scan();
  assert.deepEqual(calls.map((c) => c.sourceKey), ['gig:b:failed']);
});

test('an outcome is kept and retried while Night City Investments cannot take it', async () => {
  const { state, calls, bridge } = harness();
  await bridge.scan();
  const api = state.api;

  state.api = undefined;
  state.gigs = [gig('a', 'done'), gig('b', 'offer')];
  await bridge.scan();
  await bridge.scan();
  assert.equal(bridge.outbox.size, 1, 'kept');
  assert.deepEqual(state.warnings, ['NoInvestments'], 'the GM is warned once');

  state.api = {};
  await bridge.scan();
  assert.deepEqual(state.warnings, ['NoInvestments', 'OldInvestments'], 'an old version is a different warning');

  let attempts = 0;
  state.api = { events: { reportImpact: async (p) => { attempts += 1; if (attempts < 3) return { ok: false, status: 'failed' }; calls.push(p); return { ok: true, status: 'applied' }; } } };
  await bridge.scan();
  await bridge.scan();
  await bridge.scan();
  assert.equal(calls.length, 1);
  assert.equal(bridge.outbox.size, 0);
  state.api = api;
});

test('a thrown error is retried, and an outcome that can never succeed is dropped', async () => {
  const { state, calls, bridge } = harness();
  await bridge.scan();
  let n = 0;
  state.api = { events: { reportImpact: async (p) => { n += 1; if (n === 1) throw new Error('boom'); calls.push(p); return { ok: true, status: 'duplicate' }; } } };
  state.gigs = [gig('a', 'done'), gig('b', 'offer')];
  await bridge.scan();
  assert.equal(bridge.outbox.size, 1);
  await bridge.scan();
  assert.equal(bridge.outbox.size, 0);
  assert.equal(calls.length, 1);

  state.api = { events: { reportImpact: async () => ({ ok: false, status: 'invalid' }) } };
  state.gigs = [gig('a', 'done'), gig('b', 'done')];
  await bridge.scan();
  assert.equal(bridge.outbox.size, 0, 'invalid is not retried');
});

test('it gives up after too many failed attempts', async () => {
  const { state, bridge } = harness();
  await bridge.scan();
  let n = 0;
  state.api = { events: { reportImpact: async () => { n += 1; return { ok: false, status: 'not-gm' }; } } };
  state.gigs = [gig('a', 'done'), gig('b', 'offer')];
  for (let i = 0; i < 30; i++) await bridge.scan();
  assert.equal(n, 20);
  assert.equal(bridge.outbox.size, 0);
});

test('the runner of a gig the players took goes with its outcome', async () => {
  const { state, calls } = harness();
  const bridge = createBridge({
    getGigs: () => state.gigs, getApi: () => state.api, isActiveGM: () => true, logger: quiet,
    runnersOf: (g) => (g.takenBy === 'V' ? ['a_v'] : []),
  });
  await bridge.scan();
  state.gigs = [gig('a', 'done', { takenBy: 'V' }), gig('b', 'failed')];
  await bridge.scan();
  assert.deepEqual(calls.map((c) => [c.sourceKey, c.runners]), [['gig:a:done', ['a_v']], ['gig:b:failed', []]]);
});

const shop = (id, extra = {}) => ({ id, name: `Shop ${id}`, status: 'open', district: 'watson', location: 'Upstairs', kind: 'Ripperdoc clinic', stage: 'Side business', ticker: '', ...extra });
const DISTRICTS = [{ id: 'watson', x: 0.5, y: 0.2 }];
const pinsFor = (businesses, pins = [], placed = {}) => syncPins({ pins, placed, businesses, districts: DISTRICTS });

test('an open business gets a pin near its district\'s centre, saying what the street can see', () => {
  const { pins, placed, changed } = pinsFor([shop('a'), shop('p', { status: 'pending' }), shop('f', { status: 'forming' })]);
  assert.equal(changed, true);
  assert.deepEqual(pins.map((p) => p.id), ['nci_a'], 'not until it opens');
  assert.equal(pins[0].name, 'Shop a');
  assert.equal(pins[0].desc, 'Ripperdoc clinic · Side business · Upstairs');
  assert.equal(pins[0].cat, 'custom');
  assert.equal(pins[0].hidden, false);
  assert.ok(Math.abs(pins[0].x - 0.5) < 0.03 && Math.abs(pins[0].y - 0.2) < 0.03);
  assert.deepEqual(Object.keys(placed), ['a']);
});

test('several in one district do not stack, a ticker shows, and an unknown district starts at the centre', () => {
  const { pins } = pinsFor([shop('a'), shop('b'), shop('c', { ticker: 'SCX' }), shop('d', { district: 'cd123' })]);
  assert.equal(new Set(pins.map((p) => `${p.x},${p.y}`)).size, 4);
  assert.equal(pins[2].name, 'Shop c (SCX)');
  assert.ok(Math.abs(pins[3].x - 0.5) < 0.03 && Math.abs(pins[3].y - 0.5) < 0.03);
});

test('the GM\'s changes stand: a moved pin stays, edited text stays, and a deleted one does not come back', () => {
  const first = pinsFor([shop('a')]);
  const moved = [{ ...first.pins[0], x: 0.9, y: 0.9, desc: 'A front for something', hidden: true }];
  const again = pinsFor([shop('a')], moved, first.placed);
  assert.equal(again.changed, false, 'nothing to do');
  assert.deepEqual(again.pins, moved);
  const deleted = pinsFor([shop('a')], [], first.placed);
  assert.equal(deleted.changed, false);
  assert.deepEqual(deleted.pins, []);
});

test('the business\'s own change updates its text, not where it is; closing takes the pin away', () => {
  const first = pinsFor([shop('a')]);
  const moved = [{ ...first.pins[0], x: 0.9, y: 0.9, hidden: true }];
  const renamed = pinsFor([shop('a', { name: 'New name', stage: 'Registered business' })], moved, first.placed);
  assert.equal(renamed.changed, true);
  assert.equal(renamed.pins[0].name, 'New name');
  assert.match(renamed.pins[0].desc, /Registered business/);
  assert.deepEqual([renamed.pins[0].x, renamed.pins[0].hidden], [0.9, true]);
  const closed = pinsFor([shop('a', { status: 'closed' })], moved, first.placed);
  assert.deepEqual(closed.pins, []);
  assert.deepEqual(closed.placed, {});
  const gone = pinsFor([], [...moved, { id: 'c1', name: 'The GM\'s own' }], first.placed);
  assert.deepEqual(gone.pins.map((p) => p.id), ['c1'], 'a removed business too, and nobody else\'s pin');
});

test('new pins go by the districts on the map now: the GM\'s own, if they are on', () => {
  const builtIn = [{ id: 'watson', x: 0.5, y: 0.2 }];
  const own = [{ id: 'cdport', x: 0.9, y: 0.9 }];
  assert.equal(currentDistricts({}, builtIn), builtIn);
  assert.equal(currentDistricts({ geo: { on: false, districts: own } }, builtIn), builtIn);
  assert.equal(currentDistricts({ geo: { on: true, districts: own } }, builtIn), own);
  const { pins } = syncPins({ pins: [], placed: {}, businesses: [shop('a', { district: 'cdport' })], districts: currentDistricts({ geo: { on: true, districts: own } }, builtIn) });
  assert.ok(pins[0].x > 0.7 && pins[0].y > 0.7, 'near the new district');
});
