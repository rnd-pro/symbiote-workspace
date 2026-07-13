import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeIntegrity, isIntegrityString } from '../schema/canonical-json.js';
import {
  PRESENTATION_JOURNEY_SCHEMA_VERSION,
  PRESENTATION_JOURNEY_OUTCOMES,
  PRESENTATION_JOURNEY_PROVENANCE,
  createPresentationJourney,
  presentationJourneyReplayProjection,
  validatePresentationJourney,
} from '../runtime/presentation-journey.js';
import { createPresentationJourney as createFromRoot } from '../index.js';

let hash = (label) => computeIntegrity(label);

function baseJourney() {
  return {
    source: {
      surfaceId: 'workbench',
      routePath: '/workspace/new',
      locale: 'en-US',
      contextHash: hash('context'),
    },
    actionNames: ['workspace.create', 'module.place'],
    events: [
      {
        provenance: 'operator-input',
        sourceOffsetMs: 0,
        presentationOffsetMs: 0,
        input: {
          text: 'build me a workspace',
          cadence: [
            { offsetMs: 0, length: 1 },
            { offsetMs: 400, length: 20 },
          ],
          submitOffsetMs: 900,
        },
      },
      {
        provenance: 'tool-progress',
        sourceOffsetMs: 1000,
        presentationOffsetMs: 1000,
        action: 'workspace.create',
      },
      {
        provenance: 'resource-result',
        sourceOffsetMs: 2000,
        presentationOffsetMs: 2000,
        action: 'module.place',
        resource: { id: 'module.map', resultHash: hash('module-map') },
        replayData: { placed: true, region: 'main' },
      },
      {
        provenance: 'assistant-text',
        sourceOffsetMs: 10000,
        presentationOffsetMs: 3000,
        text: 'Here is your workspace.',
      },
    ],
    outcome: 'completed',
    timing: {
      sourceDurationMs: 10000,
      presentationDurationMs: 3000,
      segments: [
        { sourceStartMs: 0, sourceEndMs: 2000, presentationStartMs: 0, presentationEndMs: 2000 },
        { sourceStartMs: 2000, sourceEndMs: 10000, presentationStartMs: 2000, presentationEndMs: 3000 },
      ],
    },
  };
}

describe('presentation journey contract', () => {
  it('normalizes a recorded session into a canonical replay record', () => {
    let journey = createPresentationJourney(baseJourney());
    assert.equal(journey.schemaVersion, PRESENTATION_JOURNEY_SCHEMA_VERSION);
    assert.ok(isIntegrityString(journey.contentHash));
    assert.equal(journey.id, `presentation-journey:${journey.contentHash}`);
    assert.deepEqual(journey.actionNames, ['module.place', 'workspace.create']);
    assert.equal(journey.events[0].seq, 0);
    assert.equal(journey.events[3].seq, 3);
    assert.deepEqual(PRESENTATION_JOURNEY_OUTCOMES.includes(journey.outcome), true);
    assert.ok(PRESENTATION_JOURNEY_PROVENANCE.includes(journey.events[0].provenance));
    assert.ok(isIntegrityString(journey.contentHash));
    assert.deepEqual(validatePresentationJourney(journey), { ok: true, errors: [] });
  });

  it('is exported from the package root and validates through it', () => {
    let journey = createFromRoot(baseJourney());
    assert.equal(journey.id, `presentation-journey:${journey.contentHash}`);
  });

  it('derives identity independent of input key order', () => {
    let reordered = baseJourney();
    reordered.actionNames = ['workspace.create', 'module.place'];
    reordered.source = {
      contextHash: reordered.source.contextHash,
      locale: 'en-US',
      routePath: '/workspace/new',
      surfaceId: 'workbench',
    };
    assert.equal(createPresentationJourney(reordered).contentHash, createPresentationJourney(baseJourney()).contentHash);
  });

  it('exposes the replay projection without self-referential identity', () => {
    let projection = presentationJourneyReplayProjection(baseJourney());
    assert.equal('id' in projection, false);
    assert.equal('contentHash' in projection, false);
    assert.equal(computeIntegrity(projection), createPresentationJourney(baseJourney()).contentHash);
  });

  it('rejects tampered identity and content hashes', () => {
    let tamperedId = createPresentationJourney(baseJourney());
    tamperedId.id = 'presentation-journey:tampered';
    assert.match(validatePresentationJourney(tamperedId).errors[0], /id does not match canonical identity/);

    let tamperedHash = createPresentationJourney(baseJourney());
    tamperedHash.contentHash = hash('other');
    assert.match(validatePresentationJourney(tamperedHash).errors[0], /contentHash does not match/);
  });

  it('fails closed on unknown fields, versions, and terminal outcomes', () => {
    let unknown = baseJourney();
    unknown.renderSeed = {};
    assert.match(validatePresentationJourney(unknown).errors[0], /renderSeed is not supported/);

    let badVersion = baseJourney();
    badVersion.schemaVersion = 'workspace-presentation-journey-v2';
    assert.match(validatePresentationJourney(badVersion).errors[0], /unsupported presentation journey schema version/);

    let badOutcome = baseJourney();
    badOutcome.outcome = 'aborted';
    assert.match(validatePresentationJourney(badOutcome).errors[0], /not a supported terminal outcome/);
  });

  it('enforces the consumer-supplied action allowlist and provenance payloads', () => {
    let offAllowlist = baseJourney();
    offAllowlist.events[1].action = 'maximo.query';
    assert.match(validatePresentationJourney(offAllowlist).errors[0], /not in the allowlisted action set/);

    let inputWithAction = baseJourney();
    inputWithAction.events[0].action = 'workspace.create';
    assert.match(validatePresentationJourney(inputWithAction).errors[0], /action is not supported for operator-input/);

    let progressWithoutAction = baseJourney();
    delete progressWithoutAction.events[1].action;
    assert.match(validatePresentationJourney(progressWithoutAction).errors[0], /action is required for tool-progress/);

    let resourceWithoutResource = baseJourney();
    delete resourceWithoutResource.events[2].resource;
    assert.match(validatePresentationJourney(resourceWithoutResource).errors[0], /resource is required for resource-result/);
  });

  it('requires at least one operator-input event', () => {
    let noInput = baseJourney();
    noInput.events = noInput.events.slice(1);
    assert.match(validatePresentationJourney(noInput).errors[0], /at least one operator-input event/);
  });

  it('validates operator typing cadence', () => {
    let shortCadence = baseJourney();
    shortCadence.events[0].input.cadence = [{ offsetMs: 0, length: 5 }];
    assert.match(validatePresentationJourney(shortCadence).errors[0], /must end at the full input length/);

    let nonMonotonicLength = baseJourney();
    nonMonotonicLength.events[0].input.cadence = [
      { offsetMs: 0, length: 10 },
      { offsetMs: 400, length: 10 },
    ];
    assert.match(validatePresentationJourney(nonMonotonicLength).errors[0], /length must strictly increase/);

    let earlySubmit = baseJourney();
    earlySubmit.events[0].input.submitOffsetMs = 100;
    assert.match(validatePresentationJourney(earlySubmit).errors[0], /must not precede the last keystroke/);
  });

  it('enforces monotonic offsets bound to the time map', () => {
    let nonMonotonic = baseJourney();
    nonMonotonic.events[2].sourceOffsetMs = 500;
    assert.match(validatePresentationJourney(nonMonotonic).errors[0], /sourceOffsetMs must be monotonic/);

    let mismatched = baseJourney();
    mismatched.events[1].presentationOffsetMs = 1500;
    assert.match(validatePresentationJourney(mismatched).errors[0], /must equal the time-map projection/);

    let insideCompression = baseJourney();
    insideCompression.events[3].sourceOffsetMs = 6000;
    insideCompression.events[3].presentationOffsetMs = 2500;
    assert.match(validatePresentationJourney(insideCompression).errors[0], /falls inside a compressed time-map segment/);
  });

  it('proves the time map covers and never stretches presentation time', () => {
    let stretched = baseJourney();
    stretched.timing.segments = [
      { sourceStartMs: 0, sourceEndMs: 2000, presentationStartMs: 0, presentationEndMs: 2000 },
      { sourceStartMs: 2000, sourceEndMs: 2500, presentationStartMs: 2000, presentationEndMs: 3000 },
      { sourceStartMs: 2500, sourceEndMs: 10000, presentationStartMs: 3000, presentationEndMs: 3000 },
    ];
    assert.match(validatePresentationJourney(stretched).errors[0], /compress but never stretch/);

    let shortMap = baseJourney();
    shortMap.timing.segments[1].sourceEndMs = 9000;
    assert.match(validatePresentationJourney(shortMap).errors[0], /must end at sourceDurationMs/);

    let overCompressed = baseJourney();
    overCompressed.timing.presentationDurationMs = 12000;
    assert.match(validatePresentationJourney(overCompressed).errors[0], /must not exceed sourceDurationMs/);
  });

  it('structurally rejects credentials, URLs, paths, and private keys', () => {
    let cookieKey = baseJourney();
    cookieKey.events[2].replayData = { cookie: 'sid=1' };
    assert.match(validatePresentationJourney(cookieKey).errors[0], /is private and not portable/);

    let embeddedUrl = baseJourney();
    embeddedUrl.events[3].text = 'see https://internal.host/path';
    assert.match(validatePresentationJourney(embeddedUrl).errors[0], /must not contain a URL/);

    let bearer = baseJourney();
    bearer.events[3].text = 'auth Bearer abc.def';
    assert.match(validatePresentationJourney(bearer).errors[0], /must not contain credentials/);

    let absolutePath = baseJourney();
    absolutePath.events[2].replayData = { note: 'saved /Users/dev/secret.json' };
    assert.match(validatePresentationJourney(absolutePath).errors[0], /must not contain an absolute local path/);

    let nonFinite = baseJourney();
    nonFinite.events[2].replayData = { score: Number.POSITIVE_INFINITY };
    assert.match(validatePresentationJourney(nonFinite).errors[0], /must be finite/);

    let reasoningDump = baseJourney();
    reasoningDump.events[2].replayData = { reasoning: 'chain of thought' };
    assert.match(validatePresentationJourney(reasoningDump).errors[0], /is private and not portable/);
  });

  it('rejects malformed source bindings and hashes', () => {
    let badRoute = baseJourney();
    badRoute.source.routePath = '/workspace?token=1';
    assert.match(validatePresentationJourney(badRoute).errors[0], /without URL search or hash/);

    let badContext = baseJourney();
    badContext.source.contextHash = 'not-a-hash';
    assert.match(validatePresentationJourney(badContext).errors[0], /must be a sha256 integrity string/);

    let badResourceHash = baseJourney();
    badResourceHash.events[2].resource.resultHash = 'nope';
    assert.match(validatePresentationJourney(badResourceHash).errors[0], /must be a sha256 integrity string/);
  });
});
