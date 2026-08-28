import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as browserApi from '../browser.js';
import * as rootApi from '../index.js';
import * as runtimeApi from '../runtime/index.js';
import * as presentationApi from '../runtime/presentation.js';
import * as semanticSkeletonApi from '../runtime/presentation/semantic-skeleton.js';
import * as immutableProjectApi from '../runtime/presentation/presentation-project.js';
import * as authoringProjectApi from '../runtime/presentation/project.js';

const {
  PRESENTATION_NARRATION_PROJECTION_VERSION,
  WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION,
  createNarrationProjection,
  createSemanticSkeleton,
} = semanticSkeletonApi;
const {
  WORKSPACE_PRESENTATION_PROJECT_VERSION,
  createPresentationProject,
  normalizePresentationProject,
} = immutableProjectApi;
const {
  PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
} = authoringProjectApi;

function createImmutableProjectFixture() {
  let skeleton = createSemanticSkeleton({
    locale: 'en-US',
    title: 'Coexisting project authorities',
    profile: 'brief',
    personas: { guide: { role: 'operator' } },
    requiredTargets: [{ targetId: 'panel:workspace' }],
    orderedCausalRelations: [{ targetId: 'panel:workspace', focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  let projection = createNarrationProjection({
    narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Inspect the workspace panel.' }],
  }, skeleton);
  return createPresentationProject({ skeleton, projection });
}

describe('immutable presentation project v7 and authoring project v1 coexistence', () => {
  it('exports both authorities under distinct names from every Node-safe public surface', () => {
    let immutableExportNames = [
      ...Object.keys(semanticSkeletonApi),
      ...Object.keys(immutableProjectApi),
    ];
    assert.equal(new Set(immutableExportNames).size, immutableExportNames.length);
    assert.deepEqual(
      immutableExportNames.filter((name) => Object.hasOwn(authoringProjectApi, name)),
      [],
    );
    for (let api of [rootApi, browserApi, runtimeApi, presentationApi]) {
      for (let name of immutableExportNames) {
        let owner = Object.hasOwn(semanticSkeletonApi, name)
          ? semanticSkeletonApi
          : immutableProjectApi;
        assert.equal(api[name], owner[name], `${name} public export does not match its authority`);
      }
      assert.equal(api.WORKSPACE_PRESENTATION_PROJECT_VERSION, WORKSPACE_PRESENTATION_PROJECT_VERSION);
      assert.equal(
        api.WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION,
        WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION,
      );
      assert.equal(
        api.PRESENTATION_NARRATION_PROJECTION_VERSION,
        PRESENTATION_NARRATION_PROJECTION_VERSION,
      );
      assert.equal(api.createPresentationProject, createPresentationProject);
      assert.equal(
        api.PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
        PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
      );
      assert.equal(api.createPresentationAuthoringProject, createPresentationAuthoringProject);
      assert.notEqual(api.createPresentationProject, api.createPresentationAuthoringProject);
    }
  });

  it('round-trips v7 canonically and rejects cross-authority schema inputs', () => {
    let immutableProject = createImmutableProjectFixture();
    let normalized = normalizePresentationProject(JSON.parse(JSON.stringify(immutableProject)));
    let authoringProject = createPresentationAuthoringProjectFromTimeline(
      immutableProject.timeline,
    ).project;

    assert.equal(immutableProject.schemaVersion, WORKSPACE_PRESENTATION_PROJECT_VERSION);
    assert.equal(normalized.hash, immutableProject.hash);
    assert.deepEqual(normalized, immutableProject);
    assert.equal(authoringProject.schemaVersion, PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION);
    assert.throws(() => createPresentationProject(authoringProject), /Unrecognized field/);
    assert.throws(() => normalizePresentationProject(authoringProject), /Unrecognized field/);
    assert.throws(() => createPresentationAuthoringProject(immutableProject), /not supported/);
  });
});
