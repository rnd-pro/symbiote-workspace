/**
 * Runtime barrel export.
 * @module symbiote-workspace/runtime
 */

export { dispatch, TOOLS, TOOL_FAMILIES, TOOL_REGISTRY, getToolDefinition, isMutating } from './dispatch.js';
export { createSession } from './session.js';
export {
  REBASED_OVER_CONCURRENT_EDIT,
  WorkspaceState,
  createConfigFingerprint,
  createWorkspaceState,
} from './workspace-state.js';
export { UndoRouter, createUndoRouter } from './undo-router.js';
export { createRouter } from './router-lane.js';
export { createRouteMatcher, normalizeRoutePattern } from './route-matcher.js';
export {
  DOCUMENT_RECORD_VERSION,
  DEFAULT_DOCUMENT_HISTORY_DEPTH,
  DEFAULT_DOCUMENT_COALESCE_WINDOW_MS,
  DocumentRuntime,
  createDocumentRuntime,
  createMemoryDocumentPersistence,
  documentWriteCapability,
  isMutatingDocumentAction,
} from './documents.js';
export {
  SESSION_DOCUMENT_VERSION,
  SESSION_LAST_WRITER_WINS,
  SESSION_MEMORY_FALLBACK,
  SessionStore,
  createMemorySessionPersistence,
  createSessionStore,
  sessionDocumentAddress,
} from './session-store.js';
export { createRegistryObserver, createPollingRegistryObserver } from './registry-observer.js';
export {
  WIRE_OBSERVATION_CONTEXT,
  WIRE_OBSERVATION_EVENT_PREFIX,
  WIRE_OBSERVATION_BINDING_PREFIX,
  WIRE_VALUE_PROP,
  applyWireMap,
  compileWire,
  compileWires,
  compileWorkspaceWires,
  createRtProducerThrottle,
  installCompiledWires,
} from './wire-compiler.js';
export {
  HOOK_ACTIVITY_TYPE,
  HOOK_ACTIVITY_ACTIONS,
  ASK_AGENT_QUEUE_DEFAULT,
  bindConfigHooks,
  composeHookPolicy,
  dismissalKeyForHook,
  filterHookContext,
  hookBridgeInterfaces,
  previewHookMatches,
} from './hook-bridge.js';
export {
  createHookToolHandlers,
  hookToolFamily,
  hookTools,
} from './tools/hook-tools.js';
export {
  createSessionToolHandlers,
  resolveSessionStore,
  sessionToolFamily,
  sessionTools,
  tools as sessionToolDefinitions,
} from './tools/session-tools.js';
export {
  createDocumentToolHandlers,
  documentToolFamily,
  documentTools,
  resolveDocumentRuntime,
  tools as documentToolDefinitions,
} from './tools/document-tools.js';
export {
  routeToolFamily,
  tools as routeToolDefinitions,
} from './tools/route-tools.js';
export {
  grantHandlers,
  grantToolFamily,
  grantTools,
} from './tools/grant-tools.js';
export {
  createExecutionToolHandlers,
  executionToolFamily,
  resolveExecutionRuntime,
  tools as executionToolDefinitions,
} from './tools/execution-tools.js';
export {
  createCatalogToolFamily,
  catalogTools,
} from '../catalog/tools.js';
export {
  buildToolResultEnvelope,
  parseToolResultEnvelope,
  isToolResultEnvelope,
} from './tool-result.js';
export {
  toolConfirmPolicy,
  isMutatingTool,
  needsConfirm,
} from './tool-policy.js';
export {
  DATA_CHANGE_MESSAGE_TYPE,
  buildDataChangeMessage,
  isDataChangeMessage,
  broadcastDataChange,
} from './data-change.js';
export {
  validateStep,
  assertStep,
  buildCtx,
  toolViews,
} from './construction-agent.js';
export { runConstructionLoop } from './agent-loop.js';
export {
  createScriptedAdapter,
  createMemoryTrace,
  buildConstructionPlan,
} from './scripted-adapter.js';
export {
  LESSON_CLAIM_KINDS,
  LESSON_CONTEXT_SCHEMA_VERSION,
  LESSON_RELATION_KINDS,
  LESSON_TEXT_RULES_VERSION,
  LESSON_TYPES,
  auditPresentationLessonContext,
  auditPresentationTimelineClaims,
  createPresentationLessonContext,
  lessonTextTokens,
  lessonToolIsSafeForDeepening,
  normalizeLessonToolDescriptor,
  validateLessonToolInput,
} from './lesson-context.js';
export {
  PRESENTATION_COMPOSITION_ISSUE_CODES,
  PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION,
  PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION,
  auditPresentationCompositionPlan,
  createLessonIntentHash,
  createPresentationCompositionPlan,
  normalizePresentationOutputSpec,
  normalizePresentationRect,
  normalizePresentationTargetComposition,
  presentationOutputOrientation,
  presentationRectsIntersect,
} from './presentation-output.js';
export {
  PRESENTATION_PLANNER_INPUT_MAX_BYTES,
  PRESENTATION_PLANNER_INPUT_SCHEMA_VERSION,
  createPresentationPlannerInput,
} from './presentation-planner.js';
export {
  PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_DIALOGUE_ACTS,
  PRESENTATION_CUE_KINDS,
  PRESENTATION_INTERACTION_TYPES,
  PRESENTATION_ANNOTATION_INTENTS,
  PRESENTATION_MARKERS,
  PRESENTATION_SYMBOLS,
  PRESENTATION_ANNOTATION_PLACEMENTS,
  PRESENTATION_STATE_CONDITIONS,
  PRESENTATION_SYNC_ANCHORS,
  PRESENTATION_DELIVERY_EMOTIONS,
  PRESENTATION_DELIVERY_PACES,
  PRESENTATION_DIALOGUE_ISSUE_CODES,
  PRESENTATION_DIALOGUE_QUALITY_PROFILE,
  PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION,
  PRESENTATION_ALIGNED_SEQUENCE_VERSION,
  PRESENTATION_ALIGNMENT_RESOLUTIONS,
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION,
  PRESENTATION_LESSON_REVIEW_CODES,
  PRESENTATION_PROMPT_PROFILES,
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
  createPresentationAlignedSequence,
  createPresentationContextSnapshot,
  createPresentationLessonAuditPacket,
  createPresentationReplanRequest,
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  createPresentationTtsProjection,
  createWorkspacePresentationTimeline,
  finalizePresentationReplan,
  normalizePresentationPrompt,
  normalizePresentationTimeline,
  normalizePresentationCue,
  normalizePresentationSyncAnchor,
  presentationTimelineHashProjection,
  presentationTimelineHasTurns,
  validatePresentationAlignedSequence,
  reviewPresentationTimeline,
  reviewPresentationDialogue,
  reviewPresentationTimelineAgainstLessonContext,
  reviewPresentationTimelineAgainstSnapshot,
  summarizePresentationTimeline,
} from './presentation.js';
export {
  MEDIA_PROJECT_DEFAULT_SURFACE,
  MEDIA_PROJECT_ROUTE_JOB_PARAM,
  MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM,
  MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM,
  MEDIA_PROJECT_ROUTE_REATTACH_PARAM,
  MEDIA_PROJECT_ROUTE_PARAM,
  MEDIA_PROJECT_ROUTE_SOURCE_URL_PARAM,
  MEDIA_PROJECT_ROUTE_SOURCE_SURFACE_PARAM,
  MEDIA_PROJECT_ROUTE_SOURCE_TAB_PARAM,
  MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM,
  MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM,
  MEDIA_PROJECT_ROUTE_TIMELINE_PARAM,
  MEDIA_PROJECT_SCHEMA_VERSION,
  MEDIA_RENDER_DIRTY_SCOPES,
  MEDIA_RENDER_EVENT_SCHEMA_VERSION,
  MEDIA_RENDER_EVENT_TYPES,
  MEDIA_RENDER_READINESS_SCHEMA_VERSION,
  MEDIA_RENDER_SETTINGS_SCHEMA_VERSION,
  BROWSER_CHROME_VISIBILITIES,
  BROWSER_CHROME_THEMES,
  BROWSER_PAGE_COLOR_SCHEMES,
  applyMediaRenderEvent,
  createMediaProject,
  createMediaProjectId,
  createMediaProjectRouteSearch,
  createMediaRenderEvent,
  createMemoryMediaProjectStore,
  createStorageMediaProjectStore,
  invalidateMediaProjectArtifacts,
  isMediaRenderEventType,
  mapRenderJobEventToMediaRenderEvents,
  mapRenderJobStageToMediaRenderEventType,
  normalizeBrowserAppearance,
  normalizeMediaProject,
  normalizeMediaRenderEvent,
  normalizeMediaRenderReadiness,
  normalizeMediaRenderRouteState,
  normalizeMediaRenderSettings,
  parseMediaProjectRouteSearch,
  selectMediaProjectTimeline,
  updateMediaProjectRenderSettings,
} from './media-projects.js';
export {
  AUDIO_SYNTHESIS_RECEIPT_VERSION,
  MEDIA_ARTIFACT_GRAPH_SCHEMA_VERSION,
  MEDIA_ARTIFACT_KINDS,
  MEDIA_ARTIFACT_VERSION_INPUTS,
  MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  MEDIA_SPEAKER_IDENTITY_CLAIMS,
  createMediaArtifactCacheKey,
  createMediaArtifactGraph,
  createMediaEvidenceManifest,
  createMediaSynthesisEvidence,
  invalidateMediaArtifactGraph,
  validateMediaArtifactGraph,
  validateMediaEvidenceManifest,
  validateMediaSynthesisEvidence,
} from './media-evidence.js';
export {
  VIRTUAL_SEQUENCE_EXECUTION_TIERS,
  VIRTUAL_SEQUENCE_INVALIDATION_MODES,
  VIRTUAL_SEQUENCE_LAYER_KINDS,
  VIRTUAL_SEQUENCE_SCHEMA_VERSION,
  createVirtualSequence,
  invalidateVirtualSequence,
  projectVirtualSequenceAt,
  validateVirtualSequence,
} from './media-sequence.js';
export {
  PRESENTATION_JOURNEY_SCHEMA_VERSION,
  PRESENTATION_JOURNEY_OUTCOMES,
  PRESENTATION_JOURNEY_PROVENANCE,
  createPresentationJourney,
  presentationJourneyReplayProjection,
  validatePresentationJourney,
} from './presentation-journey.js';
export {
  mediaToolFamily,
  tools as mediaToolDefinitions,
} from './tools/media-tools.js';
