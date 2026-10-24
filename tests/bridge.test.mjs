import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffGigs, buildReport, createBridge } from '../scripts/bridge-0.1.0.js';

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

test('the report carries the client, reward and notes, and a stable key', () => {
  const r = buildReport({ id: 'q1', status: 'done', client: '  Arasaka ', reward: 2000, title: 'Courier', desc: 'Deliver a case', notes: '[NCI: ARA]', giver: 'poi1', target: 'poi2' }, 'done');
  assert.deepEqual(r, {
    gigId: 'q1', sourceKey: 'gig:q1:done', outcome: 'done', client: 'Arasaka', reward: '2000', title: 'Courier', desc: 'Deliver a case', notes: '[NCI: ARA]',
  });
  assert.deepEqual(buildReport({ id: 'q2' }, 'failed'), { gigId: 'q2', sourceKey: 'gig:q2:failed', outcome: 'failed', client: '', reward: '', title: '', desc: '', notes: '' });
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
