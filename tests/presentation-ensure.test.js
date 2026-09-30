import assert from 'node:assert/strict';
import test from 'node:test';

import { ENSURE_STATUS, createEnsureController } from '../runtime/presentation/ensure.js';

function observation(state, extra = {}) {
  return {
    targetId: 'panel.graph',
    role: 'panel',
    presence: 'present',
    state,
    capabilities: {
      supported: ['open', 'close'],
      available: ['open', 'close'],
      unavailable: [],
      effects: { open: { open: true }, close: { open: false } },
    },
    ...extra,
  };
}

function fakeRegistry(sequence) {
  let index = 0;
  return () => {
    const observation = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    return { observation, freshness: { observedAt: index, generation: index } };
  };
}

test('ensure on already-satisfied state never invokes a transition', async () => {
  let invoked = 0;
  const controller = createEnsureController({
    observe: fakeRegistry([observation({ open: true })]),
    invokeTransition: () => { invoked += 1; },
  });
  const result = await controller.ensure('panel.graph', { open: true });
  assert.equal(result.status, ENSURE_STATUS.ALREADY_SATISFIED);
  assert.equal(invoked, 0);
  assert.equal(result.attempts, 1);
});

test('ensure picks the available transition whose effects cover the missing keys', async () => {
  let invoked = [];
  const states = [observation({ open: false }), observation({ open: false }), observation({ open: true })];
  const controller = createEnsureController({
    observe: fakeRegistry(states),
    invokeTransition: async ({ transitionId }) => { invoked.push(transitionId); return { ok: true }; },
    sleep: async () => {},
  });
  const result = await controller.ensure('panel.graph', { open: true });
  assert.equal(result.status, ENSURE_STATUS.ACHIEVED);
  assert.deepEqual(invoked, ['open']);
  assert.equal(result.transition.id, 'open');
  assert.equal(result.observations.at(-1).state.open, true);
});

test('ensure refuses when no available transition declares matching effects', async () => {
  let invoked = 0;
  const controller = createEnsureController({
    observe: fakeRegistry([{
      ...observation({ open: false }),
      capabilities: { supported: ['open'], available: ['open'], unavailable: [], effects: {} },
    }]),
    invokeTransition: () => { invoked += 1; },
  });
  const result = await controller.ensure('panel.graph', { open: true });
  assert.equal(result.status, ENSURE_STATUS.NO_TRANSITION);
  assert.equal(invoked, 0);
});

test('ensure never invokes against unknown or unmounted targets', async () => {
  let invoked = 0;
  for (const presence of ['unknown', 'unmounted']) {
    const controller = createEnsureController({
      observe: fakeRegistry([observation({}, { presence })]),
      invokeTransition: () => { invoked += 1; },
    });
    const result = await controller.ensure('panel.graph', { open: true });
    assert.equal(result.status, ENSURE_STATUS.TARGET_UNKNOWN);
    assert.equal(result.observations[0].presence, presence);
  }
  assert.equal(invoked, 0);
});

test('ensure fails explicitly when verification never matches within the budget', async () => {
  let invoked = 0;
  let nowValue = 0;
  const controller = createEnsureController({
    observe: fakeRegistry([
      observation({ open: false }),
      // Effect claims success but verification keeps reading the old state.
      ...Array.from({ length: 40 }, () => observation({ open: false })),
    ]),
    invokeTransition: () => { invoked += 1; },
    now: () => nowValue,
    sleep: async (ms) => { nowValue += ms; },
    settleBudgetMs: 100,
    maxAttempts: 1,
  });
  const result = await controller.ensure('panel.graph', { open: true });
  assert.equal(result.status, ENSURE_STATUS.FAILED);
  assert.equal(invoked, 1);
});

test('ensure retries once more after a failed attempt and reports bounded attempts', async () => {
  const states = [
    observation({ open: false }),   // attempt 1 observe
    observation({ open: false }),   // attempt 1 verify ×3
    observation({ open: false }),
    observation({ open: false }),
    observation({ open: false }),   // attempt 2 observe
    observation({ open: true }),    // attempt 2 verify
  ];
  let invoked = 0;
  let nowValue = 0;
  const controller = createEnsureController({
    observe: fakeRegistry(states),
    invokeTransition: () => { invoked += 1; },
    now: () => nowValue,
    sleep: async (ms) => { nowValue += ms; },
    settleBudgetMs: 60,
    maxAttempts: 2,
  });
  const result = await controller.ensure('panel.graph', { open: true });
  assert.equal(result.status, ENSURE_STATUS.ACHIEVED);
  assert.equal(invoked, 2);
  assert.equal(result.attempts, 2);
});

test('ensure rejects an empty target or desired state', async () => {
  const controller = createEnsureController({ observe: fakeRegistry([observation({ open: true })]) });
  assert.equal((await controller.ensure('', { open: true })).status, ENSURE_STATUS.FAILED);
  assert.equal((await controller.ensure('panel.graph', {})).status, ENSURE_STATUS.FAILED);
});

test('createEnsureController requires an observe function', () => {
  assert.throws(() => createEnsureController({}), /observe/);
});
