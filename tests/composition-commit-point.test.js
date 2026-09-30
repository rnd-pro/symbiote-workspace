import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMIT_RESULTS, createCompositionCommitPoint } from '../runtime/composition-commit-point.js';

// The commit point is what makes "the old composition stays active until the new
// one is ready" mean something observable. Three things must move together: the
// route, the state it resolves against, and the ownership of both. Commit them in
// sequence and a reader can land in between and observe a generation that never
// existed.

function generationOf(route, tag) {
  return {
    generation: 0,
    route,
    state: { tag, revisions: { [route]: 1 } },
    ownership: { mounted: `mount:${tag}`, leases: [`lease:${tag}`] },
  };
}

describe('composition commit point', () => {
  it('moves route, state, and ownership in one act', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));
    let before = point.read();

    let result = await point.commit({
      next: generationOf('/new', 'new'),
      reason: 'update',
    });

    assert.equal(result.result, COMMIT_RESULTS.committed);
    let after = point.read();

    assert.equal(after.route, '/new');
    assert.equal(after.state.tag, 'new');
    assert.equal(after.ownership.mounted, 'mount:new', 'ownership moves with the state it backs');
    assert.notEqual(after.generation, before.generation);
  });

  it('never exposes a snapshot whose parts disagree', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));
    let observed = [];
    let stop = false;

    // A reader running while the switch is applied. It must only ever see a
    // complete generation: the tag in state has to match the route and the
    // ownership that backs it.
    let reader = (async () => {
      while (!stop) {
        let snapshot = point.read();
        let tag = snapshot.route === '/old' ? 'old' : 'new';
        observed.push({
          route: snapshot.route,
          stateTag: snapshot.state.tag,
          ownerTag: snapshot.ownership.mounted.replace('mount:', ''),
          coherent: snapshot.state.tag === tag && snapshot.ownership.mounted === `mount:${tag}`,
        });
        await Promise.resolve();
      }
    })();

    await point.commit({ next: generationOf('/new', 'new') });
    stop = true;
    await reader;

    let incoherent = observed.filter((sample) => !sample.coherent);
    assert.equal(
      incoherent.length,
      0,
      `a reader observed ${incoherent.length} incoherent generation(s)`,
    );
    assert.ok(observed.length > 0, 'the reader must actually have sampled during the switch');
  });

  it('leaves the old generation intact when the apply step fails', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));

    let result = await point.commit({
      next: generationOf('/new', 'new'),
      apply: async () => { throw new Error('router refused'); },
    });

    assert.equal(result.result, COMMIT_RESULTS.rejected);
    assert.match(result.reason, /router refused/);

    let after = point.read();
    assert.equal(after.route, '/old', 'a failed switch must not move the route');
    assert.equal(after.state.tag, 'old');
    assert.equal(after.ownership.mounted, 'mount:old');
  });

  it('refuses a commit planned against a superseded generation', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));
    let applied = false;

    let stale = await point.commit({
      next: generationOf('/stale', 'stale'),
      expectGeneration: 7,
      apply: async () => { applied = true; },
    });
    assert.equal(stale.result, COMMIT_RESULTS.stale);
    assert.equal(applied, false, 'a stale commit must not run its side effects');
    assert.equal(point.read().route, '/old');

    await point.commit({ next: generationOf('/new', 'new') });
    let late = await point.commit({
      next: generationOf('/late', 'late'),
      expectGeneration: 0,
      apply: async () => { applied = true; },
    });

    assert.equal(late.result, COMMIT_RESULTS.stale, 'the check happens at the last possible moment');
    assert.equal(point.read().route, '/new');
  });

  it('runs the apply step while readers still see the old generation', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));
    let observedDuringApply = null;

    await point.commit({
      next: generationOf('/new', 'new'),
      apply: async () => {
        observedDuringApply = point.read();
      },
    });

    assert.equal(
      observedDuringApply.route,
      '/old',
      'the side effect runs before the swap, so a failure needs no undo',
    );
  });

  it('freezes a snapshot so a reader cannot mutate what it holds', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));
    let snapshot = point.read();

    assert.throws(() => { snapshot.route = '/hijacked'; }, TypeError);
    assert.equal(point.read().route, '/old');
  });

  it('keeps history for a later audit of which generation was live', async () => {
    let point = createCompositionCommitPoint(generationOf('/old', 'old'));
    await point.commit({ next: generationOf('/new', 'new') });
    await point.commit({ next: generationOf('/newer', 'newer') });

    let history = point.getHistory();
    assert.equal(history.length, 3);
    assert.deepEqual(history.map((entry) => entry.route), ['/old', '/new', '/newer']);
    assert.equal(point.getLastCommit().result, COMMIT_RESULTS.committed);
  });
});
