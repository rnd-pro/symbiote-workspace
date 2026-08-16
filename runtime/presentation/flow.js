import { canonicalize, computeIntegrity } from '../../schema/canonical-json.js';
import {
  LESSON_CONTEXT_SCHEMA_VERSION,
  auditPresentationLessonContext,
  createPresentationLessonContext,
} from '../lesson-context.js';
import {
  createNarrationProjectionGrounding,
  normalizeSemanticSkeleton,
} from './semantic-skeleton.js';

export const WORKSPACE_PRESENTATION_FLOW_TASK_VERSION = 'workspace-presentation-flow-task-v1';
export const WORKSPACE_PROJECT_ADAPTATION_VERSION = 'workspace-project-adaptation-v1';
export const WORKSPACE_PRESENTATION_FLOW_BASIS_VERSION = 'workspace-presentation-flow-basis-v1';
export const WORKSPACE_PRESENTATION_PLAN_OPTIONS_VERSION = 'workspace-presentation-plan-options-v4';
export const WORKSPACE_PRESENTATION_PLAN_SELECTION_VERSION = 'workspace-presentation-plan-selection-v1';
export const WORKSPACE_PRESENTATION_PLANNING_REQUEST_VERSION = 'workspace-presentation-planning-request-v1';
export const WORKSPACE_PRESENTATION_AUTHORING_REQUEST_VERSION = 'workspace-presentation-authoring-request-v1';
export const WORKSPACE_PRESENTATION_FLOW_REPAIR_VERSION = 'workspace-presentation-flow-repair-v1';
export const WORKSPACE_PRESENTATION_DEEPENING_REQUEST_VERSION = 'workspace-presentation-deepening-request-v1';

const TASK_MODES = new Set(['author', 'review', 'repair']);
const ARTIFACT_KINDS = new Set(['live-tour']);

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function exactKeys(value, allowed, path) {
  for (const key of Object.keys(record(value, path))) {
    if (!allowed.includes(key)) throw new TypeError(`Unrecognized field "${key}" in ${path}`);
  }
}

function requiredText(value, path) {
  const result = String(value ?? '').normalize('NFC').trim();
  if (!result) throw new TypeError(`${path} is required`);
  return result;
}

function optionalText(value, path) {
  const result = String(value ?? '').normalize('NFC').trim();
  if (result.length > 512) throw new TypeError(`${path} is too long`);
  return result;
}

function uniqueRefs(value, path, { max = 64 } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (value.length > max) throw new TypeError(`${path} exceeds the supported limit`);
  const refs = value.map((item, index) => requiredText(item, `${path}[${index}]`));
  if (new Set(refs).size !== refs.length) throw new TypeError(`${path} contains duplicate ids`);
  return refs.sort();
}

function contentHash(version, value) {
  return `${version}:${computeIntegrity(value)}`;
}

function seal(version, value) {
  const payload = clone({ schemaVersion: version, ...value });
  return { ...payload, hash: contentHash(version, payload) };
}

function verify(version, input, allowed, path) {
  exactKeys(input, allowed, path);
  if (input.schemaVersion !== undefined && input.schemaVersion !== version) throw new TypeError(`${path} schemaVersion is unsupported`);
  const raw = clone(input);
  const hash = optionalText(raw.hash, `${path}.hash`);
  delete raw.hash;
  delete raw.schemaVersion;
  const normalized = { schemaVersion: version, ...raw };
  if (hash && hash !== contentHash(version, normalized)) throw new TypeError(`${path} hash does not match content`);
  return normalized;
}

function positiveInteger(value, path, { min = 0, max = 32 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${path} is out of range`);
  return value;
}

function normalizeBudgets(value = {}) {
  exactKeys(value, ['maxRepairRounds', 'maxDeepeningActions', 'maxContextQueries'], 'task.budgets');
  return {
    maxRepairRounds: positiveInteger(value.maxRepairRounds, 'task.budgets.maxRepairRounds', { max: 8 }),
    maxDeepeningActions: positiveInteger(value.maxDeepeningActions, 'task.budgets.maxDeepeningActions', { max: 16 }),
    maxContextQueries: positiveInteger(value.maxContextQueries, 'task.budgets.maxContextQueries', { min: 1, max: 64 }),
  };
}

export function createPresentationFlowTask(input = {}) {
  const raw = verify(WORKSPACE_PRESENTATION_FLOW_TASK_VERSION, input,
    ['schemaVersion', 'id', 'mode', 'artifactKind', 'objective', 'locale', 'budgets', 'hash'], 'presentationFlowTask');
  const mode = requiredText(raw.mode, 'presentationFlowTask.mode');
  const artifactKind = requiredText(raw.artifactKind, 'presentationFlowTask.artifactKind');
  if (!TASK_MODES.has(mode)) throw new TypeError('presentationFlowTask.mode is unsupported');
  if (!ARTIFACT_KINDS.has(artifactKind)) throw new TypeError('presentationFlowTask.artifactKind is unsupported');
  return seal(WORKSPACE_PRESENTATION_FLOW_TASK_VERSION, {
    id: requiredText(raw.id, 'presentationFlowTask.id'),
    mode,
    artifactKind,
    objective: requiredText(raw.objective, 'presentationFlowTask.objective'),
    locale: requiredText(raw.locale, 'presentationFlowTask.locale'),
    budgets: normalizeBudgets(raw.budgets || {}),
  });
}

export function createProjectAdaptationCapsule(input = {}) {
  const raw = verify(WORKSPACE_PROJECT_ADAPTATION_VERSION, input,
    ['schemaVersion', 'id', 'version', 'locale', 'audience', 'processObjective', 'profileRefs', 'rubricRefs', 'capabilityProfiles', 'guidance', 'hash'], 'projectAdaptation');
  const guidance = uniqueRefs(raw.guidance, 'projectAdaptation.guidance', { max: 16 });
  if (guidance.some((item) => item.length > 512)) throw new TypeError('projectAdaptation.guidance entry is too long');
  return seal(WORKSPACE_PROJECT_ADAPTATION_VERSION, {
    id: requiredText(raw.id, 'projectAdaptation.id'),
    version: requiredText(raw.version, 'projectAdaptation.version'),
    locale: requiredText(raw.locale, 'projectAdaptation.locale'),
    audience: optionalText(raw.audience, 'projectAdaptation.audience'),
    processObjective: optionalText(raw.processObjective, 'projectAdaptation.processObjective'),
    profileRefs: uniqueRefs(raw.profileRefs, 'projectAdaptation.profileRefs'),
    rubricRefs: uniqueRefs(raw.rubricRefs, 'projectAdaptation.rubricRefs'),
    capabilityProfiles: uniqueRefs(raw.capabilityProfiles, 'projectAdaptation.capabilityProfiles'),
    guidance,
  });
}

function lessonPacket(value) {
  const packet = value?.schemaVersion === LESSON_CONTEXT_SCHEMA_VERSION && value?.hash
    ? clone(value)
    : createPresentationLessonContext(value || {});
  const audit = auditPresentationLessonContext(packet);
  if (audit.verdict !== 'accept') throw new TypeError(`presentation flow lesson context is invalid: ${audit.issueCodes.join(', ')}`);
  return packet;
}

function snapshotHash(snapshot, path) {
  return requiredText(snapshot?.identityHash, path);
}

export function createPresentationFlowBasis({ task, adaptation, lessonContext, generation = 0, expiresAt } = {}) {
  const normalizedTask = createPresentationFlowTask(task);
  const normalizedAdaptation = createProjectAdaptationCapsule(adaptation);
  const lesson = lessonPacket(lessonContext);
  const expiry = positiveInteger(expiresAt, 'presentationFlowBasis.expiresAt', { min: 1, max: Number.MAX_SAFE_INTEGER });
  return seal(WORKSPACE_PRESENTATION_FLOW_BASIS_VERSION, {
    taskHash: normalizedTask.hash,
    adaptationHash: normalizedAdaptation.hash,
    lessonContextHash: requiredText(lesson.hash, 'presentationFlowBasis.lessonContextHash'),
    sourceSnapshotHash: snapshotHash(lesson.sourceSnapshot, 'presentationFlowBasis.sourceSnapshotHash'),
    targetSnapshotHash: snapshotHash(lesson.targetSnapshot, 'presentationFlowBasis.targetSnapshotHash'),
    toolRegistryHash: computeIntegrity(lesson.toolDescriptors),
    generation: positiveInteger(generation, 'presentationFlowBasis.generation'),
    expiresAt: expiry,
    budgets: normalizedTask.budgets,
  });
}

function normalizeBasis(input = {}) {
  const raw = verify(WORKSPACE_PRESENTATION_FLOW_BASIS_VERSION, input,
    ['schemaVersion', 'taskHash', 'adaptationHash', 'lessonContextHash', 'sourceSnapshotHash', 'targetSnapshotHash', 'toolRegistryHash', 'generation', 'expiresAt', 'budgets', 'semanticPlanHash', 'planSelectionHash', 'hash'], 'presentationFlowBasis');
  const result = {
    taskHash: requiredText(raw.taskHash, 'presentationFlowBasis.taskHash'),
    adaptationHash: requiredText(raw.adaptationHash, 'presentationFlowBasis.adaptationHash'),
    lessonContextHash: requiredText(raw.lessonContextHash, 'presentationFlowBasis.lessonContextHash'),
    sourceSnapshotHash: requiredText(raw.sourceSnapshotHash, 'presentationFlowBasis.sourceSnapshotHash'),
    targetSnapshotHash: requiredText(raw.targetSnapshotHash, 'presentationFlowBasis.targetSnapshotHash'),
    toolRegistryHash: requiredText(raw.toolRegistryHash, 'presentationFlowBasis.toolRegistryHash'),
    generation: positiveInteger(raw.generation, 'presentationFlowBasis.generation'),
    expiresAt: positiveInteger(raw.expiresAt, 'presentationFlowBasis.expiresAt', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    budgets: normalizeBudgets(raw.budgets || {}),
  };
  const semanticPlanHash = optionalText(raw.semanticPlanHash, 'presentationFlowBasis.semanticPlanHash');
  const planSelectionHash = optionalText(raw.planSelectionHash, 'presentationFlowBasis.planSelectionHash');
  if (Boolean(semanticPlanHash) !== Boolean(planSelectionHash)) throw new TypeError('presentationFlowBasis plan binding is incomplete');
  return seal(WORKSPACE_PRESENTATION_FLOW_BASIS_VERSION, {
    ...result,
    ...(semanticPlanHash ? { semanticPlanHash, planSelectionHash } : {}),
  });
}

function assertCurrentBasis(basis, lessonContext) {
  const lesson = lessonPacket(lessonContext);
  if (basis.lessonContextHash !== lesson.hash
    || basis.sourceSnapshotHash !== snapshotHash(lesson.sourceSnapshot, 'lesson.sourceSnapshot.identityHash')
    || basis.targetSnapshotHash !== snapshotHash(lesson.targetSnapshot, 'lesson.targetSnapshot.identityHash')
    || basis.toolRegistryHash !== computeIntegrity(lesson.toolDescriptors)) {
    const error = new TypeError('presentation flow basis is stale');
    error.code = 'presentation-flow-basis-stale';
    throw error;
  }
  return lesson;
}

function normalizeActionOptions(value, lesson) {
  if (!Array.isArray(value)) throw new TypeError('presentationPlanOptions.actionOptions must be an array');
  const targets = new Set(lesson.targets.map((target) => target.id));
  const tools = new Set(lesson.toolDescriptors.map((tool) => tool.id));
  const options = value.map((entry, index) => {
    exactKeys(entry, ['id', 'actionId', 'targetId', 'toolId'], `presentationPlanOptions.actionOptions[${index}]`);
    const option = {
      id: requiredText(entry.id, `presentationPlanOptions.actionOptions[${index}].id`),
      actionId: requiredText(entry.actionId, `presentationPlanOptions.actionOptions[${index}].actionId`),
      targetId: requiredText(entry.targetId, `presentationPlanOptions.actionOptions[${index}].targetId`),
      toolId: requiredText(entry.toolId, `presentationPlanOptions.actionOptions[${index}].toolId`),
    };
    if (!targets.has(option.targetId) || !tools.has(option.toolId)) throw new TypeError('presentation plan action option is not registered in lesson context');
    return option;
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(options.map((option) => option.id)).size !== options.length
    || new Set(options.map((option) => option.actionId)).size !== options.length) throw new TypeError('presentation plan action options must be unique');
  return options;
}

export function createPresentationFlowPlanOptions({ basis, lessonContext, actionOptions = [], dialogueProfiles = [], requiredTargetIds = [], requiredFactIds = [] } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  const lesson = assertCurrentBasis(normalizedBasis, lessonContext);
  const offeredTargetIds = lesson.targets.map((target) => target.id).sort();
  const offeredFactIds = lesson.facts.map((fact) => fact.id).sort();
  const required = uniqueRefs(requiredTargetIds, 'presentationPlanOptions.requiredTargetIds');
  const requiredFacts = uniqueRefs(requiredFactIds, 'presentationPlanOptions.requiredFactIds');
  if (required.some((id) => !offeredTargetIds.includes(id))) {
    throw new TypeError('presentation plan required targets must be registered in lesson context');
  }
  if (requiredFacts.some((id) => !offeredFactIds.includes(id))) {
    throw new TypeError('presentation plan required facts must be registered in lesson context');
  }
  return seal(WORKSPACE_PRESENTATION_PLAN_OPTIONS_VERSION, {
    basisHash: normalizedBasis.hash,
    targetIds: offeredTargetIds,
    requiredTargetIds: required,
    factIds: offeredFactIds,
    requiredFactIds: requiredFacts,
    actionOptions: normalizeActionOptions(actionOptions, lesson),
    dialogueProfiles: uniqueRefs(dialogueProfiles, 'presentationPlanOptions.dialogueProfiles'),
  });
}

function normalizePlanOptions(input = {}) {
  const raw = verify(WORKSPACE_PRESENTATION_PLAN_OPTIONS_VERSION, input,
    ['schemaVersion', 'basisHash', 'targetIds', 'requiredTargetIds', 'factIds', 'requiredFactIds', 'actionOptions', 'dialogueProfiles', 'hash'], 'presentationPlanOptions');
  const targetIds = uniqueRefs(raw.targetIds, 'presentationPlanOptions.targetIds');
  const requiredTargetIds = uniqueRefs(raw.requiredTargetIds, 'presentationPlanOptions.requiredTargetIds');
  const factIds = uniqueRefs(raw.factIds, 'presentationPlanOptions.factIds');
  const requiredFactIds = uniqueRefs(raw.requiredFactIds, 'presentationPlanOptions.requiredFactIds');
  if (requiredTargetIds.some((id) => !targetIds.includes(id))) {
    throw new TypeError('presentation plan required targets must be registered in lesson context');
  }
  if (requiredFactIds.some((id) => !factIds.includes(id))) {
    throw new TypeError('presentation plan required facts must be registered in lesson context');
  }
  return seal(WORKSPACE_PRESENTATION_PLAN_OPTIONS_VERSION, {
    basisHash: requiredText(raw.basisHash, 'presentationPlanOptions.basisHash'),
    targetIds,
    requiredTargetIds,
    factIds,
    requiredFactIds,
    actionOptions: (raw.actionOptions || []).map((entry, index) => {
      exactKeys(entry, ['id', 'actionId', 'targetId', 'toolId'], `presentationPlanOptions.actionOptions[${index}]`);
      return { id: requiredText(entry.id, 'actionOption.id'), actionId: requiredText(entry.actionId, 'actionOption.actionId'), targetId: requiredText(entry.targetId, 'actionOption.targetId'), toolId: requiredText(entry.toolId, 'actionOption.toolId') };
    }).sort((left, right) => left.id.localeCompare(right.id)),
    dialogueProfiles: uniqueRefs(raw.dialogueProfiles, 'presentationPlanOptions.dialogueProfiles'),
  });
}

export function createPresentationFlowPlanSelection({ basis, options, selection = {} } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  const normalizedOptions = normalizePlanOptions(options);
  if (normalizedOptions.basisHash !== normalizedBasis.hash) throw new TypeError('presentation plan options belong to another flow basis');
  exactKeys(selection, ['targetIds', 'factIds', 'actionOptionIds', 'dialogueProfileId'], 'presentationPlanSelection');
  const selectedTargetIds = uniqueRefs(selection.targetIds, 'presentationPlanSelection.targetIds');
  const targetIds = [...new Set([...selectedTargetIds, ...normalizedOptions.requiredTargetIds])].sort();
  const selectedFactIds = uniqueRefs(selection.factIds, 'presentationPlanSelection.factIds');
  const factIds = [...new Set([...selectedFactIds, ...normalizedOptions.requiredFactIds])].sort();
  const actionOptionIds = uniqueRefs(selection.actionOptionIds, 'presentationPlanSelection.actionOptionIds');
  const dialogueProfileId = optionalText(selection.dialogueProfileId, 'presentationPlanSelection.dialogueProfileId');
  if (!targetIds.length) throw new TypeError('presentation plan requires at least one target');
  const optionActionById = new Map(normalizedOptions.actionOptions.map((option) => [option.id, option]));
  if (targetIds.some((id) => !normalizedOptions.targetIds.includes(id))
    || factIds.some((id) => !normalizedOptions.factIds.includes(id))
    || actionOptionIds.some((id) => !optionActionById.has(id))
    || actionOptionIds.some((id) => !targetIds.includes(optionActionById.get(id).targetId))
    || (dialogueProfileId && !normalizedOptions.dialogueProfiles.includes(dialogueProfileId))) {
    throw new TypeError('presentation plan selection contains an unoffered option');
  }
  return seal(WORKSPACE_PRESENTATION_PLAN_SELECTION_VERSION, {
    basisHash: normalizedBasis.hash,
    optionsHash: normalizedOptions.hash,
    targetIds,
    factIds,
    actionOptionIds,
    ...(dialogueProfileId ? { dialogueProfileId } : {}),
  });
}

function normalizePlanSelection(input = {}) {
  const raw = verify(WORKSPACE_PRESENTATION_PLAN_SELECTION_VERSION, input,
    ['schemaVersion', 'basisHash', 'optionsHash', 'targetIds', 'factIds', 'actionOptionIds', 'dialogueProfileId', 'hash'], 'presentationPlanSelection');
  return seal(WORKSPACE_PRESENTATION_PLAN_SELECTION_VERSION, {
    basisHash: requiredText(raw.basisHash, 'presentationPlanSelection.basisHash'),
    optionsHash: requiredText(raw.optionsHash, 'presentationPlanSelection.optionsHash'),
    targetIds: uniqueRefs(raw.targetIds, 'presentationPlanSelection.targetIds'),
    factIds: uniqueRefs(raw.factIds, 'presentationPlanSelection.factIds'),
    actionOptionIds: uniqueRefs(raw.actionOptionIds, 'presentationPlanSelection.actionOptionIds'),
    ...(optionalText(raw.dialogueProfileId, 'presentationPlanSelection.dialogueProfileId') ? { dialogueProfileId: optionalText(raw.dialogueProfileId, 'presentationPlanSelection.dialogueProfileId') } : {}),
  });
}

/**
 * Compiles the bounded semantic choices an agent may consider before a
 * product materializes the immutable presentation skeleton. Values remain
 * evidence authority and are intentionally not copied into this selection
 * contract; narration receives claim-local values only after plan binding.
 */
export function createPresentationFlowPlanningRequest({ task, adaptation, basis, options, lessonContext } = {}) {
  const normalizedTask = createPresentationFlowTask(task);
  const normalizedAdaptation = createProjectAdaptationCapsule(adaptation);
  const normalizedBasis = normalizeBasis(basis);
  const normalizedOptions = normalizePlanOptions(options);
  const lesson = assertCurrentBasis(normalizedBasis, lessonContext);
  if (normalizedBasis.taskHash !== normalizedTask.hash
    || normalizedBasis.adaptationHash !== normalizedAdaptation.hash
    || normalizedOptions.basisHash !== normalizedBasis.hash) {
    throw new TypeError('presentation planning request belongs to another flow basis');
  }
  if (normalizedBasis.semanticPlanHash || normalizedBasis.planSelectionHash) {
    throw new TypeError('presentation planning request is already bound to a semantic plan');
  }
  const toolsById = new Map(lesson.toolDescriptors.map((tool) => [tool.id, tool]));
  return seal(WORKSPACE_PRESENTATION_PLANNING_REQUEST_VERSION, {
    task: normalizedTask,
    adaptation: normalizedAdaptation,
    basis: normalizedBasis,
    options: normalizedOptions,
    selectionAuthority: {
      targets: lesson.targets.map((target) => ({
        id: target.id,
        title: target.title,
        kind: target.kind,
        visible: target.visible,
        ...(target.rendered !== undefined ? { rendered: target.rendered } : {}),
      })),
      facts: lesson.facts.map((fact) => ({
        id: fact.id,
        label: fact.label,
        targetRefs: fact.targetRefs,
      })),
      actionOptions: normalizedOptions.actionOptions.map((option) => ({
        id: option.id,
        targetId: option.targetId,
        toolId: option.toolId,
        ...(toolsById.get(option.toolId)?.description ? { description: toolsById.get(option.toolId).description } : {}),
      })),
      requiredTargetIds: normalizedOptions.requiredTargetIds,
      requiredFactIds: normalizedOptions.requiredFactIds,
      dialogueProfiles: normalizedOptions.dialogueProfiles,
    },
  });
}

export function bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  const normalizedOptions = normalizePlanOptions(options);
  const normalizedSelection = normalizePlanSelection(selection);
  if (normalizedOptions.basisHash !== normalizedBasis.hash || normalizedSelection.basisHash !== normalizedBasis.hash || normalizedSelection.optionsHash !== normalizedOptions.hash) {
    throw new TypeError('presentation semantic plan belongs to another flow basis');
  }
  const normalizedSkeleton = normalizeSemanticSkeleton(skeleton);
  const targetIds = normalizedSkeleton.requiredTargets.map((target) => target.targetId).sort();
  if (canonicalize(targetIds) !== canonicalize(normalizedSelection.targetIds)) throw new TypeError('semantic plan targets differ from the agent selection');
  const selectedActions = normalizedSelection.actionOptionIds.map((id) => normalizedOptions.actionOptions.find((option) => option.id === id).actionId).sort();
  const registeredActions = normalizedSkeleton.registeredActions.map((action) => action.actionId).sort();
  if (canonicalize(selectedActions) !== canonicalize(registeredActions)) throw new TypeError('semantic plan actions differ from the agent selection');
  const factIds = new Set(normalizedSkeleton.grounding.facts.map((fact) => fact.id));
  if (normalizedSelection.factIds.some((id) => !factIds.has(id))) throw new TypeError('semantic plan facts differ from the agent selection');
  return seal(WORKSPACE_PRESENTATION_FLOW_BASIS_VERSION, {
    ...Object.fromEntries(Object.entries(normalizedBasis).filter(([key]) => key !== 'hash' && key !== 'schemaVersion')),
    semanticPlanHash: normalizedSkeleton.hash,
    planSelectionHash: normalizedSelection.hash,
  });
}

/**
 * Publishes only immutable, host-registered deepening choices to the model.
 * The model may select an option id; tool input remains host-owned.
 */
export function createPresentationDeepeningRequest({ basis, options } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  const normalizedOptions = normalizePlanOptions(options);
  const optionBasis = seal(WORKSPACE_PRESENTATION_FLOW_BASIS_VERSION, {
    ...Object.fromEntries(Object.entries(normalizedBasis).filter(([key]) => (
      key !== 'hash' && key !== 'schemaVersion' && key !== 'semanticPlanHash' && key !== 'planSelectionHash'
    ))),
  });
  if (normalizedOptions.basisHash !== optionBasis.hash) {
    throw new TypeError('presentation deepening options belong to another flow basis');
  }
  return seal(WORKSPACE_PRESENTATION_DEEPENING_REQUEST_VERSION, {
    basisHash: normalizedBasis.hash,
    remainingActions: normalizedBasis.budgets.maxDeepeningActions,
    actionOptions: normalizedOptions.actionOptions.map((option) => ({
      id: option.id,
      actionId: option.actionId,
      targetId: option.targetId,
      toolId: option.toolId,
    })),
  });
}

function normalizeSafeFindings(value = []) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError('presentation repair findings are invalid');
  const findings = value.map((finding, index) => {
    exactKeys(finding, ['code', 'slotId', 'claimId'], `presentationRepair.findings[${index}]`);
    const code = requiredText(finding.code, `presentationRepair.findings[${index}].code`);
    const slotId = optionalText(finding.slotId, `presentationRepair.findings[${index}].slotId`);
    const claimId = optionalText(finding.claimId, `presentationRepair.findings[${index}].claimId`);
    return { code, ...(slotId ? { slotId } : {}), ...(claimId ? { claimId } : {}) };
  });
  return [...new Map(findings.map((finding) => [`${finding.code}\u0000${finding.slotId || ''}\u0000${finding.claimId || ''}`, finding])).values()];
}

export function createPresentationFlowRepair({ basis, candidateHash, previousCandidateHash, attempt, findings } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  if (!normalizedBasis.semanticPlanHash) throw new TypeError('presentation repair requires a bound semantic plan');
  const round = positiveInteger(attempt, 'presentationRepair.attempt', { min: 1, max: normalizedBasis.budgets.maxRepairRounds });
  const normalizedFindings = normalizeSafeFindings(findings);
  if (!normalizedFindings.length) throw new TypeError('presentation repair requires typed findings');
  return seal(WORKSPACE_PRESENTATION_FLOW_REPAIR_VERSION, {
    basisHash: normalizedBasis.hash,
    semanticPlanHash: normalizedBasis.semanticPlanHash,
    attempt: round,
    candidateHash: requiredText(candidateHash, 'presentationRepair.candidateHash'),
    ...(optionalText(previousCandidateHash, 'presentationRepair.previousCandidateHash') ? { previousCandidateHash: optionalText(previousCandidateHash, 'presentationRepair.previousCandidateHash') } : {}),
    findings: normalizedFindings,
  });
}

export function createPresentationAuthoringRequest({ basis, task, adaptation, skeleton, options, repair } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  const normalizedTask = createPresentationFlowTask(task);
  const normalizedAdaptation = createProjectAdaptationCapsule(adaptation);
  const normalizedSkeleton = normalizeSemanticSkeleton(skeleton);
  if (!normalizedBasis.semanticPlanHash || normalizedBasis.semanticPlanHash !== normalizedSkeleton.hash
    || normalizedBasis.taskHash !== normalizedTask.hash || normalizedBasis.adaptationHash !== normalizedAdaptation.hash) {
    throw new TypeError('presentation authoring request does not match the accepted flow basis');
  }
  let normalizedRepair = null;
  if (repair) {
    normalizedRepair = createPresentationFlowRepair({ ...repair, basis: normalizedBasis });
    if (normalizedRepair.basisHash !== normalizedBasis.hash) throw new TypeError('presentation repair belongs to another basis');
  }
  const deepening = options
    ? createPresentationDeepeningRequest({ basis: normalizedBasis, options })
    : null;
  return seal(WORKSPACE_PRESENTATION_AUTHORING_REQUEST_VERSION, {
    basis: {
      hash: normalizedBasis.hash,
      generation: normalizedBasis.generation,
      targetSnapshotHash: normalizedBasis.targetSnapshotHash,
      toolRegistryHash: normalizedBasis.toolRegistryHash,
      semanticPlanHash: normalizedBasis.semanticPlanHash,
      expiresAt: normalizedBasis.expiresAt,
    },
    task: {
      id: normalizedTask.id,
      objective: normalizedTask.objective,
      locale: normalizedTask.locale,
      mode: normalizedTask.mode,
    },
    adaptation: {
      id: normalizedAdaptation.id,
      version: normalizedAdaptation.version,
      locale: normalizedAdaptation.locale,
      audience: normalizedAdaptation.audience,
      processObjective: normalizedAdaptation.processObjective,
      profileRefs: normalizedAdaptation.profileRefs,
      rubricRefs: normalizedAdaptation.rubricRefs,
      capabilityProfiles: normalizedAdaptation.capabilityProfiles,
      guidance: normalizedAdaptation.guidance,
      hash: normalizedAdaptation.hash,
    },
    semanticPlan: {
      hash: normalizedSkeleton.hash,
      profile: normalizedSkeleton.profile,
      slots: normalizedSkeleton.slots.map((slot) => ({
        slotId: slot.slotId,
        semanticAct: slot.semanticAct,
        persona: slot.persona,
        ...(slot.replyToSlotId ? { replyToSlotId: slot.replyToSlotId } : {}),
        ...(slot.addressee ? { addressee: slot.addressee } : {}),
        targetId: slot.targetId,
      })),
    },
    grounding: createNarrationProjectionGrounding(normalizedSkeleton),
    ...(deepening ? { deepening } : {}),
    ...(normalizedRepair ? { repair: { attempt: normalizedRepair.attempt, findings: normalizedRepair.findings, candidateHash: normalizedRepair.candidateHash } } : {}),
  });
}

export function decidePresentationFlowTransition({ basis, currentBasis, candidateHash, previousCandidateHash, findings, attempt } = {}) {
  const normalizedBasis = normalizeBasis(basis);
  const normalizedCurrent = normalizeBasis(currentBasis || basis);
  if (normalizedBasis.hash !== normalizedCurrent.hash) return { status: 'stale', code: 'presentation-flow-basis-stale' };
  const normalizedFindings = normalizeSafeFindings(findings || []);
  if (!normalizedFindings.length) return { status: 'admit' };
  const currentCandidate = requiredText(candidateHash, 'presentationTransition.candidateHash');
  const previous = optionalText(previousCandidateHash, 'presentationTransition.previousCandidateHash');
  if (previous && previous === currentCandidate) return { status: 'reject', code: 'presentation-flow-no-progress' };
  if (!Number.isInteger(attempt) || attempt >= normalizedBasis.budgets.maxRepairRounds) return { status: 'reject', code: 'presentation-flow-repair-budget-exhausted' };
  return {
    status: 'repair',
    repair: createPresentationFlowRepair({
      basis: normalizedBasis,
      candidateHash: currentCandidate,
      previousCandidateHash: previous,
      attempt: attempt + 1,
      findings: normalizedFindings,
    }),
  };
}
