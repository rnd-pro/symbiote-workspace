import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPresentationAlignedSequence,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
  playWorkspacePresentationTimeline,
  projectPresentationNle,
} from '../browser.js';

function fixture() {
  let timeline = createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'browser-authoring-playback',
    title: 'Browser authoring playback',
    locale: 'en-US',
    profile: 'brief',
    personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
    grounding: { sources: [] },
    turns: [{
      id: 'intro',
      persona: 'guide',
      dialogueAct: 'open',
      text: 'Show the canonical authoring timeline.',
      sourceRefs: [],
      claims: [],
      cues: [],
    }],
  });
  let { project } = createPresentationAuthoringProjectFromTimeline(timeline);
  let alignedSequence = createPresentationAlignedSequence(timeline, {
    media: { hash: 'sha256-browser-authoring-audio', durationMs: 1200, locale: 'en-US' },
    turns: [{ startMs: 0, endMs: 1200, transcript: '', words: [] }],
  });
  let schedule = createPresentationScheduleV2(project, alignedSequence);
  return { project, alignedSequence, schedule };
}

describe('browser authoring playback convergence', () => {
  it('binds hidden playback to the exact Project/alignment/Schedule/NLE tuple', async () => {
    let value = fixture();
    let mounted = { getInterfaceContext: () => ({ targets: [] }) };
    let legacyNarrations = 0;

    let session = await playWorkspacePresentationTimeline(value, mounted, {
      adapter: {},
      onNarration: () => { legacyNarrations += 1; },
    });

    assert.equal(session.authority, 'presentation-authoring-project');
    assert.equal(session.authoringProjectHash, value.project.hash);
    assert.equal(session.timelineHash, value.schedule.timelineHash);
    assert.equal(session.scheduleHash, value.schedule.hash);
    assert.equal(session.nleHash, projectPresentationNle(value.project, value.schedule).hash);
    assert.equal(session.project, value.project);
    assert.equal(session.alignedSequence, value.alignedSequence);
    assert.equal(session.schedule, value.schedule);
    assert.equal(session.snapshot.version, 'workspace-presentation-execution-v1');
    assert.equal(session.snapshot.mediaTimeMs, null);
    assert.equal(legacyNarrations, 0);

    session.sample({ mediaTimeMs: 600, reason: 'audio-clock' });
    assert.equal(session.snapshot.mediaTimeMs, 600);
    await session.dispose();
  });
});
