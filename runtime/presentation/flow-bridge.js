import { canonicalize } from '../../schema/canonical-json.js';
import {
  lessonToolIsSafeForDeepening,
  validateLessonToolInput,
} from '../lesson-context.js';
import {
  createPresentationFlowBasis,
  createPresentationFlowPlanOptions,
} from './flow.js';

export const WORKSPACE_PRESENTATION_FLOW_BRIDGE_VERSION = 'workspace-presentation-flow-bridge-v1';

function clone(value) {
  return JSON.parse(canonicalize(value));
}

function requiredFunction(value, path) {
  if (typeof value !== 'function') throw new TypeError(`${path} must be a function`);
  return value;
}

function nonnegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${path} must be a non-negative integer`);
  return value;
}

function futureInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${path} must be a positive integer`);
  return value;
}

function normalizeContextDescriptor(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('presentation flow bridge context must be an object');
  const keys = Object.keys(value);
  if (keys.some((key) => !['lessonContext', 'generation', 'expiresAt'].includes(key))) throw new TypeError('presentation flow bridge context contains an unrecognized field');
  return {
    lessonContext: value.lessonContext,
    generation: nonnegativeInteger(value.generation, 'presentation flow bridge context.generation'),
    expiresAt: futureInteger(value.expiresAt, 'presentation flow bridge context.expiresAt'),
  };
}

function staleError(code = 'presentation-flow-basis-stale') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function bridgeSnapshot(state) {
  return clone({
    schemaVersion: WORKSPACE_PRESENTATION_FLOW_BRIDGE_VERSION,
    basis: state.basis,
    options: state.options,
    remainingDeepeningActions: state.task.budgets.maxDeepeningActions - state.deepeningActions,
  });
}

/**
 * Creates the host boundary for a scoped presentation agent. The host owns
 * transport and WebMCP execution; this bridge admits only a current basis,
 * offered option id, safe descriptor, and schema-valid input.
 */
export function createPresentationFlowBridge({ task, adaptation, loadContext, listActionOptions, executeAction, now = Date.now } = {}) {
  const load = requiredFunction(loadContext, 'presentation flow bridge loadContext');
  const listOptions = requiredFunction(listActionOptions, 'presentation flow bridge listActionOptions');
  const execute = requiredFunction(executeAction, 'presentation flow bridge executeAction');
  const clock = requiredFunction(now, 'presentation flow bridge now');
  let state = null;

  async function installContext() {
    const context = normalizeContextDescriptor(await load());
    if (clock() >= context.expiresAt) throw staleError('presentation-flow-context-expired');
    const basis = createPresentationFlowBasis({
      task,
      adaptation,
      lessonContext: context.lessonContext,
      generation: context.generation,
      expiresAt: context.expiresAt,
    });
    const actionOptions = await listOptions(clone(context.lessonContext));
    const options = createPresentationFlowPlanOptions({
      basis,
      lessonContext: context.lessonContext,
      actionOptions: actionOptions || [],
    });
    state = {
      task: { budgets: basis.budgets },
      lessonContext: clone(context.lessonContext),
      basis,
      options,
      deepeningActions: state?.deepeningActions || 0,
    };
    return bridgeSnapshot(state);
  }

  async function start() {
    if (state) throw new Error('presentation flow bridge is already started');
    return installContext();
  }

  async function refresh() {
    if (!state) throw new Error('presentation flow bridge has not started');
    return installContext();
  }

  async function executeDeepening({ basisHash, actionOptionId, input = {} } = {}) {
    if (!state || String(basisHash || '') !== state.basis.hash || clock() >= state.basis.expiresAt) throw staleError();
    if (state.deepeningActions >= state.task.budgets.maxDeepeningActions) {
      const error = new Error('presentation-flow-deepening-budget-exhausted');
      error.code = 'presentation-flow-deepening-budget-exhausted';
      throw error;
    }
    const actionOption = state.options.actionOptions.find((option) => option.id === String(actionOptionId || ''));
    if (!actionOption) throw new TypeError('presentation flow action option is not offered');
    const descriptor = state.lessonContext.toolDescriptors.find((tool) => tool.id === actionOption.toolId);
    if (!descriptor || !lessonToolIsSafeForDeepening(descriptor)) {
      const error = new Error('presentation-flow-action-not-safe');
      error.code = 'presentation-flow-action-not-safe';
      throw error;
    }
    const issues = validateLessonToolInput(descriptor.inputSchema, input);
    if (issues.length) {
      const error = new TypeError('presentation-flow-action-input-invalid');
      error.code = 'presentation-flow-action-input-invalid';
      throw error;
    }
    await execute({ actionOption: clone(actionOption), input: clone(input), basis: clone(state.basis) });
    state.deepeningActions += 1;
    return refresh();
  }

  return Object.freeze({ start, refresh, executeDeepening });
}
