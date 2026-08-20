import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';

export const WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION = 'workspace-presentation-semantic-skeleton-v7';
export const PRESENTATION_NARRATION_PROJECTION_VERSION = 'presentation-narration-projection-v7';
export const PRESENTATION_NARRATION_GROUNDING_VERSION = 'presentation-narration-grounding-v7';

export function text(value, fallback = '') {
  let normalized = String(value ?? '').normalize('NFC').trim();
  return normalized || fallback;
}

export function requiredText(value, path) {
  let normalized = text(value);
  if (!normalized) throw new TypeError(`${path} is required`);
  return normalized;
}

function optionalBoolean(value, path) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

function occurrences(value, quote) {
  let count = 0; let cursor = 0;
  while (cursor <= value.length - quote.length) { let next = value.indexOf(quote, cursor); if (next < 0) break; count += 1; cursor = next + Math.max(1, quote.length); }
  return count;
}

export function array(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}

export function sortedReferenceSet(value, path) {
  let refs = array(value || [], path).map((item, index) => requiredText(item, `${path}[${index}]`));
  return [...new Set(refs)].sort();
}

export function verifyIntegrity(version, raw) {
  let { hash, ...rest } = raw;
  if (!hash) throw new TypeError('Missing integrity hash');
  let expected = `${version}:${computeIntegrity(rest)}`;
  if (hash !== expected) throw new Error(`Integrity hash mismatch. Expected ${expected}, got ${hash}`);
  return raw;
}

export function hashRecord(version, value) {
  let clean = JSON.parse(canonicalize(value));
  return { ...clean, hash: `${version}:${computeIntegrity(clean)}` };
}

export function assertKnownKeys(value, allowedKeys, path) {
  if (!value || typeof value !== 'object') return;
  let allowed = new Set(allowedKeys);
  for (let key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unrecognized field "${key}" in ${path}`);
    }
  }
}

function normalizeGroundingRegistry(value = {}) {
  assertKnownKeys(value, ['sources', 'facts', 'evidence', 'claims'], 'grounding');
  let normalized = {};
  for (let collection of ['sources', 'facts', 'evidence', 'claims']) {
    let ids = new Set();
    normalized[collection] = array(value[collection] || [], `grounding.${collection}`).map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`grounding.${collection}[${index}] must be an object`);
      let id = requiredText(entry.id, `grounding.${collection}[${index}].id`);
      if (ids.has(id)) throw new TypeError(`Duplicate ${collection} registry id ${id}`);
      ids.add(id);
      if (collection === 'facts' || collection === 'evidence') {
        assertKnownKeys(entry.narration, ['role', 'coverage'], `grounding.${collection}[${index}].narration`);
        if (!['structural', 'substantive'].includes(text(entry.narration?.role))) throw new TypeError(`grounding.${collection}[${index}].narration.role must be structural or substantive`);
        if (!['required', 'optional'].includes(text(entry.narration?.coverage))) throw new TypeError(`grounding.${collection}[${index}].narration.coverage must be required or optional`);
      }
      return JSON.parse(canonicalize(entry));
    });
  }
  return normalized;
}

function assertRegistryClosure(skeleton) {
  let registries = Object.fromEntries(['sources', 'facts', 'evidence', 'claims'].map((name) => [name, new Set((skeleton.grounding[name] || []).map((item) => item.id))]));
  let ensure = (refs, registry, path) => refs.forEach((ref) => { if (!registry.has(ref)) throw new TypeError(`${path} references unknown registry id ${ref}`); });
  let validate = (entry, path) => {
    ensure(entry.sourceRefs, registries.sources, `${path}.sourceRefs`);
    ensure(entry.factRefs, registries.facts, `${path}.factRefs`);
    ensure(entry.evidenceRefs, registries.evidence, `${path}.evidenceRefs`);
    entry.claimRefs.forEach((claim) => {
      if (!registries.claims.has(claim.id)) throw new TypeError(`${path}.claimRefs references unknown registry id ${claim.id}`);
      ensure(claim.factRefs, registries.facts, `${path}.claimRefs.${claim.id}.factRefs`);
      ensure(claim.evidenceRefs, registries.evidence, `${path}.claimRefs.${claim.id}.evidenceRefs`);
    });
  };
  skeleton.requiredTargets.forEach((entry, index) => validate({ ...entry, claimRefs: (entry.claimRefs || []).map((id) => ({ id, factRefs: [], evidenceRefs: [] })) }, `requiredTargets[${index}]`));
  skeleton.slots.forEach((entry, index) => validate(entry, `slots[${index}]`));
}

const NARRATIVE_METADATA_FIELDS = new Set([
  'id', 'kind', 'source', 'path',
  'targetRefs', 'factRefs', 'evidenceRefs', 'sourceRefs', 'claimRefs', 'narration',
]);

function narrativeValues(value, values = new Set()) {
  if (typeof value === 'string') {
    const candidate = text(value);
    if (candidate) values.add(candidate);
    return values;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    values.add(String(value));
    return values;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => narrativeValues(item, values));
    return values;
  }
  if (!value || typeof value !== 'object') return values;
  Object.entries(value).forEach(([key, item]) => {
    if (!NARRATIVE_METADATA_FIELDS.has(key)) narrativeValues(item, values);
  });
  return values;
}

function narrationGroundingEntry(entry) {
  let id = requiredText(entry?.id, 'narration grounding id');
  let payload = entry.value === undefined ? Object.fromEntries(Object.entries(entry).filter(([key]) => !NARRATIVE_METADATA_FIELDS.has(key))) : entry.value;
  let records = Array.isArray(payload) ? payload.map((value, index) => ({ path: `/value/${index}`, value })) : [{ path: '/value', value: payload }];
  return {
    id,
    role: requiredText(entry?.narration?.role, 'narration grounding role'),
    coverage: requiredText(entry?.narration?.coverage, 'narration grounding coverage'),
    tuples: records.map((record) => {
      let tupleId = `${id}:${record.path}:${computeIntegrity(record.value)}`;
      let atoms = [];
      let visit = (value, path) => {
        if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
          let quote = text(value);
          if (quote) atoms.push({ atomId: `${tupleId}:${path}:${computeIntegrity(quote)}`, path, quote });
        } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}/${index}`));
        else if (value && typeof value === 'object') Object.keys(value).sort().forEach((key) => visit(value[key], `${path}/${key}`));
      };
      visit(record.value, '');
      return { tupleId, path: record.path, atoms };
    }),
  };
}

/**
 * Creates the immutable, slot-local facts a narration agent may use. It exposes
 * data leaves only; topology, actions and target ownership remain in the
 * semantic skeleton rather than becoming model-editable request fields.
 */
export function createNarrationProjectionGrounding(skeletonRaw) {
  const skeleton = normalizeSemanticSkeleton(skeletonRaw);
  const facts = new Map(skeleton.grounding.facts.map((entry) => [entry.id, entry]));
  const evidence = new Map(skeleton.grounding.evidence.map((entry) => [entry.id, entry]));
  return hashRecord(PRESENTATION_NARRATION_GROUNDING_VERSION, {
    schemaVersion: PRESENTATION_NARRATION_GROUNDING_VERSION,
    skeletonHash: skeleton.hash,
    slots: skeleton.slots.map((slot) => ({
      slotId: slot.slotId,
      targetId: slot.targetId,
      ...(slot.tabId ? { tabId: slot.tabId } : {}),
      ...(slot.responseCoverage ? { responseBinding: { responderSlotId: slot.responseCoverage.responderSlotId, targetId: slot.responseCoverage.targetId, claimIds: slot.responseCoverage.claimIds } } : {}),
      facts: slot.factRefs.map((id) => narrationGroundingEntry(facts.get(id))),
      evidence: slot.evidenceRefs.map((id) => narrationGroundingEntry(evidence.get(id))),
      claims: slot.claimRefs.map((claim) => ({
        claimId: claim.id,
        tupleBindings: claim.tupleBindings,
        facts: claim.factRefs.map((id) => narrationGroundingEntry(facts.get(id))).filter((entry) => entry.role === 'substantive').map((entry) => ({ ...entry, tuples: entry.tuples.filter((tuple) => claim.tupleBindings.some((binding) => binding.sourceId === entry.id && binding.tupleId === tuple.tupleId)) })),
        evidence: claim.evidenceRefs.map((id) => narrationGroundingEntry(evidence.get(id))).filter((entry) => entry.role === 'substantive').map((entry) => ({ ...entry, tuples: entry.tuples.filter((tuple) => claim.tupleBindings.some((binding) => binding.sourceId === entry.id && binding.tupleId === tuple.tupleId)) })),
      })),
    })),
  });
}

export function normalizeSemanticSkeleton(input = {}) {
  let reconstructed = {};
  if (input.schemaVersion !== undefined && input.schemaVersion !== WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION) { let error = new TypeError('Semantic skeleton migration required for provider-derived narration authority v7'); error.code = 'tuple-scope-migration-required'; throw error; }
  if (input.hash) verifyIntegrity(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, input);

  assertKnownKeys(input, [
    'schemaVersion', 'locale', 'title', 'profile', 'personas', 'grounding',
    'requiredTargets', 'registeredActions', 'dialoguePolicy', 'slots', 'hash'
  ], 'skeletonInput');

  let slotIds = new Set();
  let resultRefs = new Set();
  let actionIds = new Set();

  reconstructed.slots = array(input.slots, 'slots').map((slot, i) => {
    assertKnownKeys(slot, [
      'slotId', 'index', 'semanticAct', 'persona', 'replyToSlotId', 'addressee',
      'targetId', 'tabId', 'factRefs', 'evidenceRefs', 'claimRefs', 'sourceRefs',
      'resultRefs', 'anchors', 'action', 'transition', 'focusMode', 'responseCoverage'
    ], `slots[${i}]`);

    if (slot.index !== i) throw new TypeError(`Incorrect sequence index at ${i}`);
    if (slotIds.has(slot.slotId)) throw new TypeError(`Duplicate slotId ${slot.slotId}`);
    slotIds.add(slot.slotId);

    if (slot.action) {
       assertKnownKeys(slot.action, ['actionId', 'targetId', 'tabId', 'source', 'tool', 'input', 'interactionType', 'reversible', 'resultRef'], `slots[${i}].action`);
       let actionId = requiredText(slot.action.actionId, `slots[${i}].action.actionId`);
       if (actionIds.has(actionId)) throw new TypeError(`Duplicate action identity ${actionId}`);
       actionIds.add(actionId);
       if (requiredText(slot.action.targetId, `slots[${i}].action.targetId`) !== requiredText(slot.targetId, `slots[${i}].targetId`)) throw new TypeError(`Action ${actionId} targets a different semantic target`);
       if (text(slot.action.tabId) !== text(slot.tabId)) throw new TypeError(`Action ${actionId} targets a different tab`);
       let resLen = array(slot.resultRefs || []).length;
       if (resLen !== 1) throw new TypeError('Action without exactly one paired result edge');
       if (requiredText(slot.action.resultRef, `slots[${i}].action.resultRef`) !== slot.resultRefs[0]) throw new TypeError(`Action ${actionId} result edge does not match slot result`);
    }

    array(slot.resultRefs || []).forEach(r => {
        if (resultRefs.has(r)) throw new TypeError('Duplicate result edge');
        resultRefs.add(r);
    });

    if (slot.transition) {
        assertKnownKeys(slot.transition, ['type', 'durationMs'], 'transition');
    }

    return {
       slotId: requiredText(slot.slotId, `slots[${i}].slotId`),
       index: Number(slot.index),
       semanticAct: requiredText(slot.semanticAct, `slots[${i}].semanticAct`),
       persona: requiredText(slot.persona, `slots[${i}].persona`),
       replyToSlotId: text(slot.replyToSlotId) || undefined,
       addressee: text(slot.addressee) || undefined,
       targetId: requiredText(slot.targetId, `slots[${i}].targetId`),
       tabId: text(slot.tabId) || undefined,
       factRefs: sortedReferenceSet(slot.factRefs, `slots[${i}].factRefs`),
       evidenceRefs: sortedReferenceSet(slot.evidenceRefs, `slots[${i}].evidenceRefs`),
       sourceRefs: sortedReferenceSet(slot.sourceRefs, `slots[${i}].sourceRefs`),
       resultRefs: sortedReferenceSet(slot.resultRefs, `slots[${i}].resultRefs`),
       claimRefs: array(slot.claimRefs || [], `slots[${i}].claimRefs`).map((c, ci) => {
           assertKnownKeys(c, ['id', 'kind', 'factRefs', 'evidenceRefs', 'tupleBindings'], `slots[${i}].claimRefs[${ci}]`);
           let tupleBindings = array(c.tupleBindings, `slots[${i}].claimRefs[${ci}].tupleBindings`).map((binding, bindingIndex) => {
             assertKnownKeys(binding, ['sourceId', 'tupleId', 'allowedAtomIds'], `tupleBindings[${bindingIndex}]`);
             return { sourceId: requiredText(binding.sourceId, 'tupleBinding.sourceId'), tupleId: requiredText(binding.tupleId, 'tupleBinding.tupleId'), allowedAtomIds: sortedReferenceSet(binding.allowedAtomIds, 'tupleBinding.allowedAtomIds') };
           });
           if (!tupleBindings.length && (c.factRefs?.length || c.evidenceRefs?.length)) throw new TypeError('claim tupleBindings are required');
           return { id: requiredText(c.id, `claim.id`), kind: requiredText(c.kind, `claim.kind`), factRefs: sortedReferenceSet(c.factRefs, `claim.factRefs`), evidenceRefs: sortedReferenceSet(c.evidenceRefs, `claim.evidenceRefs`), tupleBindings };
       }),
       anchors: array(slot.anchors || [], `slots[${i}].anchors`).map((a, ai) => {
           assertKnownKeys(a, ['intent', 'binding'], `slots[${i}].anchors[${ai}]`);
           assertKnownKeys(a.binding, ['type', 'claimId', 'atomId', 'quote', 'occurrence'], `slots[${i}].anchors[${ai}].binding`);
           let type = requiredText(a.binding.type, 'anchor.binding.type');
           if (type === 'turn-start') return { intent: requiredText(a.intent, `anchor.intent`), binding: { type } };
           if (type !== 'claim-atom') throw new TypeError('anchor.binding.type must be claim-atom or turn-start');
           return { intent: requiredText(a.intent, `anchor.intent`), binding: { type, claimId: requiredText(a.binding.claimId, 'anchor.binding.claimId'), atomId: requiredText(a.binding.atomId, 'anchor.binding.atomId'), quote: requiredText(a.binding.quote, 'anchor.binding.quote'), occurrence: Number.isInteger(a.binding.occurrence) && a.binding.occurrence > 0 ? a.binding.occurrence : (() => { throw new TypeError('anchor.binding.occurrence must be a positive integer'); })() } };
       }),
       action: slot.action ? {
           actionId: requiredText(slot.action.actionId, `slots[${i}].action.actionId`),
           targetId: requiredText(slot.action.targetId, `slots[${i}].action.targetId`),
           tabId: text(slot.action.tabId) || undefined,
           source: requiredText(slot.action.source, `slots[${i}].action.source`),
           tool: requiredText(slot.action.tool, `slots[${i}].action.tool`),
           input: slot.action.input !== undefined ? JSON.parse(canonicalize(slot.action.input)) : undefined,
           interactionType: requiredText(slot.action.interactionType, `slots[${i}].action.interactionType`),
           reversible: optionalBoolean(slot.action.reversible, `slots[${i}].action.reversible`),
           resultRef: requiredText(slot.action.resultRef, `slots[${i}].action.resultRef`),
       } : undefined,
       transition: slot.transition ? JSON.parse(canonicalize(slot.transition)) : undefined,
       focusMode: requiredText(slot.focusMode, `slots[${i}].focusMode`),
       responseCoverage: slot.responseCoverage ? (() => {
         assertKnownKeys(slot.responseCoverage, ['responderSlotId', 'targetId', 'claimIds'], `slots[${i}].responseCoverage`);
         return { responderSlotId: requiredText(slot.responseCoverage.responderSlotId, 'responseCoverage.responderSlotId'), targetId: requiredText(slot.responseCoverage.targetId, 'responseCoverage.targetId'), claimIds: sortedReferenceSet(slot.responseCoverage.claimIds, 'responseCoverage.claimIds') };
       })() : undefined,
    };
  });

  reconstructed.schemaVersion = WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION;
  reconstructed.locale = requiredText(input.locale, 'locale');
  reconstructed.title = requiredText(input.title, 'title');
  reconstructed.profile = requiredText(input.profile, 'profile');
  reconstructed.personas = input.personas ? JSON.parse(canonicalize(input.personas)) : {};
  reconstructed.grounding = normalizeGroundingRegistry(input.grounding || {});
  reconstructed.dialoguePolicy = input.dialoguePolicy === undefined ? undefined : (() => {
    assertKnownKeys(input.dialoguePolicy, ['mode', 'participantIds'], 'dialoguePolicy');
    if (requiredText(input.dialoguePolicy.mode, 'dialoguePolicy.mode') !== 'dialogue') throw new TypeError('dialoguePolicy.mode must be dialogue');
    let participantIds = sortedReferenceSet(input.dialoguePolicy.participantIds, 'dialoguePolicy.participantIds');
    if (participantIds.length !== 2) throw new TypeError('dialoguePolicy requires exactly two participants');
    return { mode: 'dialogue', participantIds };
  })();
  reconstructed.requiredTargets = array(input.requiredTargets || [], 'requiredTargets').map(t => {
      assertKnownKeys(t, ['targetId', 'tabId', 'sourceRefs', 'factRefs', 'evidenceRefs', 'claimRefs'], 'requiredTarget');
      return {
        targetId: requiredText(t.targetId),
        tabId: text(t.tabId) || undefined,
        sourceRefs: sortedReferenceSet(t.sourceRefs),
        factRefs: sortedReferenceSet(t.factRefs),
        evidenceRefs: sortedReferenceSet(t.evidenceRefs),
        claimRefs: sortedReferenceSet(t.claimRefs)
      };
  });
  reconstructed.registeredActions = array(input.registeredActions || [], 'registeredActions').map((action, index) => {
    assertKnownKeys(action, ['actionId', 'targetId', 'tabId', 'source', 'tool', 'input', 'interactionType', 'reversible', 'resultRef'], `registeredActions[${index}]`);
    return {
      actionId: requiredText(action.actionId, `registeredActions[${index}].actionId`), targetId: requiredText(action.targetId, `registeredActions[${index}].targetId`),
      tabId: text(action.tabId) || undefined, source: requiredText(action.source, `registeredActions[${index}].source`), tool: requiredText(action.tool, `registeredActions[${index}].tool`),
      input: action.input === undefined ? undefined : JSON.parse(canonicalize(action.input)), interactionType: requiredText(action.interactionType, `registeredActions[${index}].interactionType`), reversible: optionalBoolean(action.reversible, `registeredActions[${index}].reversible`), resultRef: requiredText(action.resultRef, `registeredActions[${index}].resultRef`),
    };
  });

  let targetIds = new Set();
  let actionRegistry = new Map();
  let personaIds = new Set(Object.keys(reconstructed.personas));
  if (!personaIds.size) throw new TypeError('skeleton requires at least one declared persona');
  reconstructed.requiredTargets.forEach((target) => {
    if (targetIds.has(target.targetId)) throw new TypeError(`Duplicate required target ${target.targetId}`);
    targetIds.add(target.targetId);
  });
  reconstructed.registeredActions.forEach((action) => {
    if (actionRegistry.has(action.actionId)) throw new TypeError(`Duplicate registered action ${action.actionId}`);
    if (!targetIds.has(action.targetId)) throw new TypeError(`Registered action ${action.actionId} targets an undeclared target`);
    let target = reconstructed.requiredTargets.find((item) => item.targetId === action.targetId);
    if (text(action.tabId) !== text(target.tabId)) throw new TypeError(`Registered action ${action.actionId} tab does not match target`);
    actionRegistry.set(action.actionId, action);
  });
  let priorSlots = new Map();
  let responseSlots = new Set();
  reconstructed.slots.forEach((slot, index) => {
    if (!targetIds.has(slot.targetId)) throw new TypeError(`slots[${index}] targets an undeclared required target`);
    let expectedTarget = reconstructed.requiredTargets.find((item) => item.targetId === slot.targetId);
    if (text(slot.tabId) !== text(expectedTarget.tabId)) throw new TypeError(`slots[${index}] tab does not match required target`);
    if (!personaIds.has(slot.persona)) throw new TypeError(`slots[${index}] names an undeclared persona`);
    if (slot.addressee && !personaIds.has(slot.addressee)) throw new TypeError(`slots[${index}] names an undeclared addressee`);
    if (slot.replyToSlotId) {
      let replied = priorSlots.get(slot.replyToSlotId);
      if (!replied) throw new TypeError(`slots[${index}] replyToSlotId must name an earlier slot`);
      if (slot.addressee !== replied.persona) throw new TypeError(`slots[${index}] addressee does not match replied persona`);
    }
    if (!['frame', 'none'].includes(slot.focusMode)) throw new TypeError(`slots[${index}].focusMode must be frame or none`);
    let focusAnchorCount = slot.anchors.filter((anchor) => anchor.intent === 'focus').length;
    if (focusAnchorCount > 1) throw new TypeError(`slots[${index}] cannot declare multiple focus anchors`);
    if (focusAnchorCount === 1 && slot.focusMode !== 'frame') throw new TypeError(`slots[${index}] focus anchor requires frame focusMode`);
    if (slot.action && slot.focusMode !== 'none') throw new TypeError(`slots[${index}] action cannot carry focus before interaction`);
    slot.claimRefs.forEach((claim) => {
      if (claim.factRefs.some((id) => !slot.factRefs.includes(id)) || claim.evidenceRefs.some((id) => !slot.evidenceRefs.includes(id))) throw new TypeError(`slots[${index}] claim ${claim.id} grounding must be local to the slot`);
      if ((slot.factRefs.length || slot.evidenceRefs.length) && !claim.factRefs.length && !claim.evidenceRefs.length) throw new TypeError(`slots[${index}] claim ${claim.id} lacks claim-local grounding`);
      let claimSources = new Set([...claim.factRefs, ...claim.evidenceRefs]);
      if (!claimSources.size && claim.tupleBindings.length) throw new TypeError(`slots[${index}] claim ${claim.id} has tuple bindings without claim-local grounding`);
      if (claimSources.size && !claim.tupleBindings.length) throw new TypeError(`slots[${index}] claim ${claim.id} requires tuple bindings`);
      let seenBindings = new Set();
      claim.tupleBindings.forEach((binding) => {
        if (!claimSources.has(binding.sourceId)) throw new TypeError(`slots[${index}] claim ${claim.id} tuple binding is not claim-local`);
        let source = [...reconstructed.grounding.facts, ...reconstructed.grounding.evidence].find((entry) => entry.id === binding.sourceId);
        let tuple = narrationGroundingEntry(source).tuples.find((item) => item.tupleId === binding.tupleId);
        if (!tuple) throw new TypeError(`slots[${index}] claim ${claim.id} tuple binding does not match immutable grounding`);
        if (canonicalize(binding.allowedAtomIds) !== canonicalize(tuple.atoms.map((atom) => atom.atomId).sort())) throw new TypeError(`slots[${index}] claim ${claim.id} tuple binding atoms do not match immutable grounding`);
        let key = `${binding.sourceId}\u0000${binding.tupleId}`;
        if (seenBindings.has(key)) throw new TypeError(`slots[${index}] claim ${claim.id} duplicates a tuple binding`);
        seenBindings.add(key);
      });
    });
    if (slot.responseCoverage) {
      if (slot.semanticAct !== 'ask') throw new TypeError(`slots[${index}] response coverage requires an ask semantic act`);
      if (!slot.responseCoverage.claimIds.length) throw new TypeError(`slots[${index}] response coverage requires claim ids`);
      let responder = reconstructed.slots.find((candidate) => candidate.slotId === slot.responseCoverage.responderSlotId);
      if (!responder || responder.index <= slot.index) throw new TypeError(`slots[${index}] response coverage must name a later responder slot`);
      if (responseSlots.has(responder.slotId)) throw new TypeError(`slots[${index}] response coverage duplicates responder slot`);
      responseSlots.add(responder.slotId);
      if (responder.targetId !== slot.responseCoverage.targetId || responder.replyToSlotId !== slot.slotId) throw new TypeError(`slots[${index}] response coverage does not match the fixed responder target and reply`);
      slot.responseCoverage.claimIds.forEach((claimId) => {
        let claim = responder.claimRefs.find((candidate) => candidate.id === claimId);
        if (!claim || !claim.tupleBindings.length) throw new TypeError(`slots[${index}] response coverage claim is not immutable responder grounding`);
      });
    }
    if (slot.action) {
      let registered = actionRegistry.get(slot.action.actionId);
      if (!registered || canonicalize(registered) !== canonicalize(slot.action)) throw new TypeError(`slots[${index}] action does not exactly match its registered action identity`);
    }
    if (index && slot.targetId === reconstructed.slots[index - 1].targetId && !slot.action && slot.focusMode !== 'none') throw new TypeError(`slots[${index}] repeats visual focus for the same target`);
    priorSlots.set(slot.slotId, slot);
  });

  assertRegistryClosure(reconstructed);
  let claimed = new Set(reconstructed.slots.flatMap((slot) => slot.claimRefs.flatMap((claim) => [...claim.factRefs, ...claim.evidenceRefs])));
  let boundTuples = new Set(reconstructed.slots.flatMap((slot) => slot.claimRefs.flatMap((claim) => claim.tupleBindings.map((binding) => binding.tupleId))));
  [...reconstructed.grounding.facts, ...reconstructed.grounding.evidence].forEach((entry) => {
    if (entry.narration.role === 'substantive' && entry.narration.coverage === 'required' && !claimed.has(entry.id)) throw new TypeError(`Required substantive grounding ${entry.id} lacks exact claim-local coverage`);
    if (entry.narration.role === 'substantive' && entry.narration.coverage === 'required') {
      narrationGroundingEntry(entry).tuples.forEach((tuple) => {
        if (!boundTuples.has(tuple.tupleId)) throw new TypeError(`Required substantive tuple ${entry.id}${tuple.path} lacks exact claim-local coverage`);
      });
    }
  });
  if (reconstructed.dialoguePolicy) {
    let participants = reconstructed.dialoguePolicy.participantIds;
    if (participants.some((id) => !personaIds.has(id))) throw new TypeError('dialoguePolicy names an undeclared persona');
    let used = new Set(); let handoffs = 0; let run = 0; let previous = '';
    reconstructed.slots.forEach((slot) => {
      if (!participants.includes(slot.persona)) throw new TypeError('dialoguePolicy slot persona is not a participant');
      used.add(slot.persona); run = slot.persona === previous ? run + 1 : 1; previous = slot.persona;
      if (run > 2) throw new TypeError('dialoguePolicy exceeds two consecutive turns for one persona');
      if (slot.replyToSlotId) handoffs += 1;
    });
    if (used.size !== 2) throw new TypeError('dialoguePolicy requires both participants to contribute');
    if (handoffs < (reconstructed.slots.length >= 4 ? 2 : 1)) throw new TypeError('dialoguePolicy lacks responsive cross-persona handoffs');
  }
  return hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, reconstructed);
}

export function createSemanticSkeleton(input = {}) {
  assertKnownKeys(input, [
    'locale', 'title', 'profile', 'personas', 'grounding',
    'requiredTargets', 'orderedCausalRelations', 'registeredActions', 'dialoguePolicy',
    'dialoguePlan'
  ], 'createInput');

  let requiredTargets = array(input.requiredTargets || [], 'requiredTargets');
  let targetMap = new Map();
  let grounding = normalizeGroundingRegistry(input.grounding || {});
  let allowedSources = new Set(grounding.sources.map(s => s.id));
  let allowedFacts = new Set(grounding.facts.map(f => f.id));
  let allowedEvidence = new Set(grounding.evidence.map(e => e.id));
  let allowedClaims = new Set(grounding.claims.map(c => c.id));
  let claimDefinitions = new Map(grounding.claims.map((claim) => [claim.id, claim]));
  let groundingSources = new Map([...grounding.facts, ...grounding.evidence].map((entry) => [entry.id, narrationGroundingEntry(entry)]));

  let reqTgtIds = new Set();
  requiredTargets.forEach(t => {
     assertKnownKeys(t, ['targetId', 'tabId', 'sourceRefs', 'factRefs', 'evidenceRefs', 'claimRefs'], 'requiredTarget');
     let tid = requiredText(t.targetId, 'targetId');
     if (reqTgtIds.has(tid)) throw new Error(`Duplicate targetId ${tid}`);
     reqTgtIds.add(tid);
     targetMap.set(tid, t);
  });

  let actions = array(input.registeredActions || [], 'registeredActions');
  let actionMap = new Map();
  actions.forEach(a => {
     assertKnownKeys(a, ['actionId', 'targetId', 'tabId', 'source', 'tool', 'input', 'interactionType', 'reversible', 'resultRef'], 'action');
     let actionId = requiredText(a.actionId, 'action.actionId');
     if (actionMap.has(actionId)) throw new Error(`Duplicate registered action identity ${actionId}`);
     let target = targetMap.get(requiredText(a.targetId, 'action.targetId'));
     if (!target) throw new Error(`Registered action ${actionId} targets an undeclared target`);
     if (text(a.tabId) !== text(target.tabId)) throw new Error(`Registered action ${actionId} tab does not match target`);
     requiredText(a.source, 'action.source'); requiredText(a.tool, 'action.tool'); requiredText(a.interactionType, 'action.interactionType'); optionalBoolean(a.reversible, 'action.reversible'); requiredText(a.resultRef, 'action.resultRef');
     actionMap.set(actionId, a);
  });

  let relations = array(input.orderedCausalRelations || [], 'orderedCausalRelations');
  let plan = array(input.dialoguePlan || [], 'dialoguePlan');

  if (relations.length !== plan.length) {
     throw new Error('orderedCausalRelations and dialoguePlan must have same length');
  }

  let slots = [];
  let prevTargetId = null;
  let actionConsumed = new Set();
  let resultEdges = new Set();
  let responseCoverageRows = [];

  for (let i = 0; i < relations.length; i++) {
     let rel = relations[i];
     let row = plan[i];
     assertKnownKeys(rel, ['targetId', 'factRefs', 'evidenceRefs', 'claimRefs', 'sourceRefs', 'resultRefs', 'actionRef', 'anchors', 'transition', 'focusMode'], `relation[${i}]`);
     assertKnownKeys(row, ['persona', 'dialogueAct', 'replyToOffset', 'addressee', 'responseCoverage'], `dialoguePlan[${i}]`);

     let targetId = requiredText(rel.targetId, `relation[${i}].targetId`);
     let reqTgt = targetMap.get(targetId);
     if (!reqTgt) throw new Error(`targetId ${targetId} is not in requiredTargets`);

     let validateSubset = (refs, allowed, name) => {
         refs.forEach(r => { if (!allowed.has(r)) throw new Error(`Unknown ${name} reference ${r}`); });
     };
     let slotFacts = array(rel.factRefs || [], 'factRefs').map(t => requiredText(t, 'factRef'));
     let slotSources = array(rel.sourceRefs || [], 'sourceRefs').map(t => requiredText(t, 'sourceRef'));
     let slotEvidence = array(rel.evidenceRefs || [], 'evidenceRefs').map(t => requiredText(t, 'evidenceRef'));

     validateSubset(slotFacts, new Set([...allowedFacts, ...(reqTgt.factRefs||[])]), 'fact');
     validateSubset(slotSources, new Set([...allowedSources, ...(reqTgt.sourceRefs||[])]), 'source');
     validateSubset(slotEvidence, new Set([ ...allowedEvidence, ...(reqTgt.evidenceRefs || []) ]), 'evidence');

     let actionRef = text(rel.actionRef);
     let slotAction = actionRef ? actionMap.get(actionRef) : undefined;
     if (actionRef && !slotAction) throw new Error(`Causal relation names unknown action ${actionRef}`);
     if (slotAction && actionConsumed.has(actionRef)) throw new Error(`Causal relation duplicates action ${actionRef}`);
     if (slotAction && slotAction.targetId !== targetId) throw new Error(`Causal relation action ${actionRef} targets a different target`);
     let actionAttached = Boolean(slotAction);
     if (actionAttached) {
       let resultRefs = array(rel.resultRefs || [], 'resultRefs');
       if (resultRefs.length !== 1 || resultRefs[0] !== slotAction.resultRef) throw new Error(`Action ${actionRef} must bind its exact single result edge`);
       actionConsumed.add(actionRef);
     }

     array(rel.resultRefs || []).forEach(r => resultEdges.add(r));

     let replyToSlotId = undefined;
     if (Number.isInteger(row.replyToOffset)) {
         if (row.replyToOffset >= 0 || i + row.replyToOffset < 0) throw new Error('replyToOffset must be negative and within bounds');
         let repliedSlot = slots[i + row.replyToOffset];
         replyToSlotId = repliedSlot.slotId;
         if (row.addressee && row.addressee !== repliedSlot.persona) {
             throw new Error('addressee must agree with replied persona');
         }
     }
     if (row.responseCoverage) {
       assertKnownKeys(row.responseCoverage, ['responderOffset', 'claimIds'], `dialoguePlan[${i}].responseCoverage`);
       let responderOffset = Number(row.responseCoverage.responderOffset);
       if (!Number.isInteger(responderOffset) || responderOffset <= 0 || i + responderOffset >= relations.length) throw new Error('responseCoverage.responderOffset must name a later dialogue row');
       let claimIds = sortedReferenceSet(row.responseCoverage.claimIds, 'responseCoverage.claimIds');
       if (!claimIds.length) throw new Error('responseCoverage requires claim ids');
       claimIds.forEach((claimId) => { if (!allowedClaims.has(claimId)) throw new Error(`Unknown response coverage claim ${claimId}`); });
       responseCoverageRows.push({ askIndex: i, responderIndex: i + responderOffset, claimIds });
     }

     let focusMode = requiredText(rel.focusMode, `relation[${i}].focusMode`);
     if (!['frame', 'none'].includes(focusMode)) throw new TypeError(`relation[${i}].focusMode must be frame or none`);
     if (targetId === prevTargetId && focusMode !== 'none') throw new Error(`Repeated target ${targetId} must not declare another visual focus`);

     let anchors = array(rel.anchors || []).map(a => {
         assertKnownKeys(a, ['intent', 'binding'], 'anchor');
         assertKnownKeys(a.binding, ['type', 'claimId', 'atomPath', 'occurrence'], 'anchor.binding');
         return { intent: requiredText(a.intent, 'intent'), binding: JSON.parse(canonicalize(a.binding)) };
     });
     let focusAnchorCount = anchors.filter((anchor) => anchor.intent === 'focus').length;
     if (focusAnchorCount > 1) throw new Error(`Causal relation at target ${targetId} cannot declare multiple focus anchors`);
     if (focusAnchorCount === 1 && focusMode !== 'frame') throw new Error(`Focus anchor at target ${targetId} requires frame focusMode`);
     if (actionAttached && anchors.filter(a => a.intent === 'action').length !== 1) throw new Error(`Action at target ${targetId} requires exactly one declared action word anchor`);
     if (!slotAction && anchors.some(a => a.intent === 'action')) throw new Error(`Action word anchor has no registered action at ${targetId}`);
     if (actionAttached && focusMode !== 'none') throw new Error(`Action at target ${targetId} cannot add a redundant focus frame`);

     slots.push({
         slotId: `slot-${i + 1}-${targetId}`,
         index: i,
         semanticAct: requiredText(row.dialogueAct, 'dialogueAct'),
         persona: requiredText(row.persona, 'persona'),
         targetId: targetId,
         tabId: reqTgt.tabId || undefined,
         factRefs: sortedReferenceSet(slotFacts, 'factRefs'),
         evidenceRefs: sortedReferenceSet(slotEvidence, 'evidenceRefs'),
         sourceRefs: sortedReferenceSet(slotSources, 'sourceRefs'),
         resultRefs: sortedReferenceSet(rel.resultRefs, 'resultRefs'),
         claimRefs: array(rel.claimRefs || []).map(c => {
             assertKnownKeys(c, ['id', 'kind'], 'claimRef');
             let id = requiredText(c.id, 'id');
             if (!allowedClaims.has(id) && !(reqTgt.claimRefs || []).includes(id)) throw new Error(`Unknown claim reference ${id}`);
             let definition = claimDefinitions.get(id);
             let factRefs = sortedReferenceSet(definition?.factRefs, `grounding.claims.${id}.factRefs`);
             let evidenceRefs = sortedReferenceSet(definition?.evidenceRefs, `grounding.claims.${id}.evidenceRefs`);
             if ((slotFacts.length || slotEvidence.length) && !factRefs.length && !evidenceRefs.length) throw new Error(`Claim ${id} lacks immutable claim-local grounding`);
             if (factRefs.some((factId) => !slotFacts.includes(factId)) || evidenceRefs.some((evidenceId) => !slotEvidence.includes(evidenceId))) throw new Error(`Claim ${id} grounding is not local to its causal relation`);
             let scope = definition?.tupleScope;
             let localSourceIds = [...factRefs, ...evidenceRefs];
             if (!localSourceIds.length) return { id, kind: requiredText(c.kind, 'kind'), factRefs, evidenceRefs, tupleBindings: [] };
             let selectors;
             if (scope === undefined) {
               if (localSourceIds.length !== 1 || groundingSources.get(localSourceIds[0])?.tuples.length !== 1) { let error = new Error(`Claim ${id} requires explicit tupleScope for multiple tuples`); error.code = 'tuple-scope-ambiguous'; throw error; }
               selectors = [{ sourceId: localSourceIds[0], tuplePath: groundingSources.get(localSourceIds[0]).tuples[0].path }];
             } else {
               assertKnownKeys(scope, ['mode', 'selectors'], `grounding.claims.${id}.tupleScope`);
               let mode = requiredText(scope.mode, `grounding.claims.${id}.tupleScope.mode`);
               if (!['single', 'explicit-multi'].includes(mode)) throw new Error(`Claim ${id} has unsupported tuple scope mode`);
               selectors = array(scope.selectors, `grounding.claims.${id}.tupleScope.selectors`).map((selector, selectorIndex) => {
                 assertKnownKeys(selector, ['sourceId', 'tuplePath'], `tupleScope.selectors[${selectorIndex}]`);
                 return { sourceId: requiredText(selector.sourceId, 'tupleScope.sourceId'), tuplePath: requiredText(selector.tuplePath, 'tupleScope.tuplePath') };
               });
               if ((mode === 'single' && selectors.length !== 1) || (mode === 'explicit-multi' && selectors.length < 2)) throw new Error(`Claim ${id} has invalid tuple scope selector count`);
             }
             let tupleBindings = selectors.map((selector) => {
               if (!localSourceIds.includes(selector.sourceId)) throw new Error(`Claim ${id} tuple scope source is not claim-local`);
               let source = groundingSources.get(selector.sourceId); let tuple = source?.tuples.find((item) => item.path === selector.tuplePath);
               if (!tuple) throw new Error(`Claim ${id} tuple scope path is not available`);
               return { sourceId: selector.sourceId, tupleId: tuple.tupleId, allowedAtomIds: tuple.atoms.map((atom) => atom.atomId) };
             });
             return { id, kind: requiredText(c.kind, 'kind'), factRefs, evidenceRefs, tupleBindings };
         }),
         anchors: anchors,
         action: actionAttached ? {
             actionId: actionRef,
             targetId,
             tabId: reqTgt.tabId || undefined,
             source: requiredText(slotAction.source, 'action.source'),
             tool: requiredText(slotAction.tool, 'action.tool'),
             input: slotAction.input !== undefined ? JSON.parse(canonicalize(slotAction.input)) : undefined,
             interactionType: requiredText(slotAction.interactionType, 'action.interactionType'),
             reversible: optionalBoolean(slotAction.reversible, 'action.reversible'),
             resultRef: requiredText(slotAction.resultRef, 'action.resultRef')
         } : undefined,
         replyToSlotId,
         addressee: text(row.addressee) || undefined,
         transition: rel.transition !== undefined ? JSON.parse(canonicalize(rel.transition)) : undefined,
         focusMode
     });
     let emitted = slots[slots.length - 1];
     emitted.anchors = anchors.map((anchor) => {
       let type = requiredText(anchor.binding.type, 'anchor.binding.type');
       if (type === 'turn-start') return { intent: anchor.intent, binding: { type } };
       if (type !== 'claim-atom') throw new Error('anchor.binding.type must be claim-atom or turn-start');
       let claim = emitted.claimRefs.find((item) => item.id === requiredText(anchor.binding.claimId, 'anchor.binding.claimId'));
       if (!claim) throw new Error('anchor claim binding must be local to its slot');
       if (typeof anchor.binding.atomPath !== 'string') throw new Error('anchor.binding.atomPath is required');
       let atomPath = anchor.binding.atomPath;
       let atom = claim.tupleBindings.flatMap((binding) => groundingSources.get(binding.sourceId)?.tuples.find((tuple) => tuple.tupleId === binding.tupleId)?.atoms || []).find((item) => item.path === atomPath);
       if (!atom) throw new Error('anchor atom binding must be a selected claim tuple atom');
       let occurrence = Number(anchor.binding.occurrence);
       if (!Number.isInteger(occurrence) || occurrence <= 0) throw new Error('anchor.binding.occurrence must be a positive integer');
       return { intent: anchor.intent, binding: { type, claimId: claim.id, atomId: atom.atomId, quote: atom.quote, occurrence } };
     });
     prevTargetId = targetId;
  }

  if (actionConsumed.size !== actionMap.size) {
      throw new Error('Every registered action requires one explicit causal actionRef/result binding');
  }

  responseCoverageRows.forEach((coverage) => {
    let ask = slots[coverage.askIndex]; let responder = slots[coverage.responderIndex];
    if (ask.semanticAct !== 'ask') throw new Error('responseCoverage requires an ask semantic act');
    if (responder.replyToSlotId !== ask.slotId) throw new Error('responseCoverage responder must explicitly reply to its ask');
    coverage.claimIds.forEach((claimId) => {
      let claim = responder.claimRefs.find((candidate) => candidate.id === claimId);
      if (!claim || !claim.tupleBindings.length) throw new Error(`responseCoverage claim ${claimId} is not immutable responder grounding`);
    });
    ask.responseCoverage = { responderSlotId: responder.slotId, targetId: responder.targetId, claimIds: coverage.claimIds };
  });

  let covered = new Set(slots.map(s => s.targetId));
  requiredTargets.forEach(t => {
      if (!covered.has(t.targetId)) throw new Error(`Missing coverage for target ${t.targetId}`);
  });

  return normalizeSemanticSkeleton({
    schemaVersion: WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION,
    locale: requiredText(input.locale, 'locale'),
    title: requiredText(input.title, 'title'),
    profile: requiredText(input.profile, 'profile'),
    personas: input.personas ? JSON.parse(canonicalize(input.personas)) : {},
    grounding,
    ...(input.dialoguePolicy ? { dialoguePolicy: input.dialoguePolicy } : {}),
    requiredTargets,
    registeredActions: actions,
    slots
  });
}

export function createNarrationProjection(inputRaw, skeletonRaw) {
  let skeleton = normalizeSemanticSkeleton(skeletonRaw);
  let narrativeGrounding = createNarrationProjectionGrounding(skeleton);
  let rawGroundingSources = new Map([...skeleton.grounding.facts, ...skeleton.grounding.evidence].map((entry) => [entry.id, narrationGroundingEntry(entry)]));
  let groundingByClaim = new Map(narrativeGrounding.slots.flatMap((slot) => slot.claims.map((claim) => [`${slot.slotId}\u0000${claim.claimId}`, claim])));
  let responseCoverageByResponder = new Map(skeleton.slots.filter((slot) => slot.responseCoverage).map((slot) => [slot.responseCoverage.responderSlotId, slot.responseCoverage]));
  let boundSubstantiveQuotes = new Set(skeleton.slots.flatMap((slot) => slot.claimRefs.flatMap((claim) => claim.tupleBindings.flatMap((binding) => {
    let source = rawGroundingSources.get(binding.sourceId);
    return source?.tuples.find((tuple) => tuple.tupleId === binding.tupleId)?.atoms.map((atom) => atom.quote) || [];
  }))));
  if (inputRaw.hash) verifyIntegrity(PRESENTATION_NARRATION_PROJECTION_VERSION, inputRaw);

  let input = JSON.parse(canonicalize(inputRaw));
  assertKnownKeys(input, ['narrations', 'hash', 'skeletonHash', 'schemaVersion'], 'projectionInput');

  let narrations = array(input.narrations, 'narrationProjection.narrations');
  if (narrations.length !== skeleton.slots.length) {
    throw new TypeError('Narration projection must exactly match skeleton slots count');
  }

  let normalizedNarrations = narrations.map((narration, index) => {
    let path = `narrationProjection.narrations[${index}]`;
    assertKnownKeys(narration, ['slotId', 'text'], path);

    let slot = skeleton.slots[index];
    if (requiredText(narration.slotId, `${path}.slotId`) !== slot.slotId) {
      throw new TypeError(`Narration slotId at index ${index} must match skeleton slotId`);
    }
    const narrationText = requiredText(narration.text, `${path}.text`);

    let anchors = slot.anchors.map((anchor) => {
      if (anchor.binding.type === 'turn-start') return { event: 'turn-start' };
      if (occurrences(narrationText, anchor.binding.quote) < anchor.binding.occurrence) { let error = new TypeError(`Anchor binding is absent from ${slot.slotId}`); error.code = 'anchor-binding-missing'; throw error; }
      return { quote: anchor.binding.quote, occurrence: anchor.binding.occurrence };
    });
    let claimTexts = slot.claimRefs.map((contract) => {
      let claimId = contract.id;
      const textValue = narrationText;
      const allowed = groundingByClaim.get(`${slot.slotId}\u0000${claimId}`);
      let proof;
      if (allowed && (allowed.facts.length || allowed.evidence.length)) {
        let bindings = contract.tupleBindings;
        let sourceTuples = [...allowed.facts, ...allowed.evidence].flatMap((source) => source.tuples.map((tuple) => ({ sourceId: source.id, tuple })));
        let atoms = [...new Map(sourceTuples.flatMap(({ tuple }) => tuple.atoms).filter((atom) => textValue.includes(atom.quote)).map((atom) => [atom.atomId, { atomId: atom.atomId, quote: atom.quote }])).values()];
        if (!atoms.length) { let error = new TypeError(`Claim ${claimId} requires at least one exact bound tuple atom`); error.code = 'tuple-proof-missing'; throw error; }
        let selectedTupleIds = new Set(bindings.map((binding) => binding.tupleId));
        let slotPermittedTupleIds = new Set(slot.claimRefs.flatMap((claim) => claim.tupleBindings.map((binding) => binding.tupleId)));
        let selectedQuotes = new Set(sourceTuples.filter(({ tuple }) => selectedTupleIds.has(tuple.tupleId)).flatMap(({ tuple }) => tuple.atoms.map((atom) => atom.quote)));
        let siblingUniqueAtom = bindings
          .flatMap((binding) => rawGroundingSources.get(binding.sourceId)?.tuples || [])
          .filter((candidate) => !slotPermittedTupleIds.has(candidate.tupleId))
          .flatMap((candidate) => candidate.atoms)
          .find((atom) => !selectedQuotes.has(atom.quote) && textValue.includes(atom.quote));
        if (siblingUniqueAtom) { let error = new TypeError(`Claim ${claimId} prose references an atom outside its selected tuple`); error.code = 'tuple-proof-sibling-atom'; throw error; }
        proof = { atoms };
      }
      return {
        claimId,
        text: textValue,
        ...(proof ? { groundingProof: proof } : {}),
      };
    });

    let responseCoverage = responseCoverageByResponder.get(slot.slotId);
    if (responseCoverage) {
      responseCoverage.claimIds.forEach((claimId) => {
        let claimText = claimTexts.find((claim) => claim.claimId === claimId);
        if (!claimText) { let error = new TypeError(`Responder ${slot.slotId} is missing question-bound claim text`); error.code = 'question-response-claim-missing'; throw error; }
        if (!narrationText.includes(claimText.text)) { let error = new TypeError(`Responder ${slot.slotId} does not speak a question-bound claim`); error.code = 'question-response-claim-not-audible'; throw error; }
      });
    }
    claimTexts.filter((claim) => claim.groundingProof).forEach((claim) => {
      if (!narrationText.includes(claim.text)) { let error = new TypeError(`Claim ${claim.claimId} proof is not audible in its narration slot`); error.code = 'claim-proof-not-audible'; throw error; }
    });

    let permittedSubstantiveQuotes = new Set(slot.claimRefs.flatMap((claim) => claim.tupleBindings.flatMap((binding) => {
      let source = rawGroundingSources.get(binding.sourceId);
      return source?.tuples.find((tuple) => tuple.tupleId === binding.tupleId)?.atoms.map((atom) => atom.quote) || [];
    })));
    let forbiddenSubstantiveAtom = [...boundSubstantiveQuotes]
      .find((quote) => quote && !permittedSubstantiveQuotes.has(quote) && narrationText.includes(quote));
    if (forbiddenSubstantiveAtom) { let error = new TypeError(`Slot ${slot.slotId} prose references a substantive atom outside its immutable claim scope`); error.code = 'substantive-atom-prose-forbidden'; throw error; }
    let forbiddenStructuralAtom = [...slot.factRefs, ...slot.evidenceRefs]
      .map((sourceId) => rawGroundingSources.get(sourceId))
      .filter((source) => source?.role === 'structural')
      .flatMap((source) => source.tuples.flatMap((tuple) => tuple.atoms))
      .find((atom) => !permittedSubstantiveQuotes.has(atom.quote) && narrationText.includes(atom.quote));
    if (forbiddenStructuralAtom) { let error = new TypeError(`Slot ${slot.slotId} prose references a structural atom outside permitted substantive proof`); error.code = 'structural-atom-prose-forbidden'; throw error; }

    return {
      slotId: slot.slotId,
      text: narrationText,
      claimTexts,
      anchors: anchors,
    };
  });

  return hashRecord(PRESENTATION_NARRATION_PROJECTION_VERSION, {
    schemaVersion: PRESENTATION_NARRATION_PROJECTION_VERSION,
    skeletonHash: skeleton.hash,
    narrations: normalizedNarrations,
  });
}
