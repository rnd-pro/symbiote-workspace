/**
 * Execution dispatch-tool family.
 *
 * This family is intentionally isolated from runtime/dispatch.js until the L1
 * integration splice imports it into the composition root.
 *
 * @module symbiote-workspace/runtime/tools/execution-tools
 */

import { createJobRuntime } from '../../server/jobs.js';
import { defineToolFamily } from './registry.js';

function objectSchema(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function contextSession(context = {}) {
  return context?.session || context;
}

export function resolveExecutionRuntime(context = {}, options = {}) {
  if (options.runtime) return options.runtime;
  let session = contextSession(context);
  if (session.executionRuntime) return session.executionRuntime;
  if (session.jobRuntime) return session.jobRuntime;
  if (session.jobs) return session.jobs;
  if (session.runtime?.execution) return session.runtime.execution;
  if (!session.__executionRuntime) {
    session.__executionRuntime = createJobRuntime({
      config: context.config || session.config || {},
      store: session.executionStore,
      runner: session.executionRunner,
      broadcast: session.broadcast,
      capacityGroups: session.executionCapacityGroups,
      autoStart: session.executionAutoStart,
    });
  }
  return session.__executionRuntime;
}

export const tools = Object.freeze([
  {
    name: 'execution_submit',
    description: 'Submit an interactive or detached execution run through the host execution runtime.',
    inputSchema: objectSchema({
      target: { type: 'object', description: 'Execution target: graph/node, pack/nodeType, or host-owned target.' },
      graphId: { type: 'string' },
      nodeId: { type: 'string' },
      doc: { type: 'string' },
      docAddress: { type: 'string' },
      mode: { type: 'string', enum: ['interactive', 'job'] },
      trigger: { type: 'object' },
      jobKey: { type: 'string' },
      groupId: { type: 'string' },
      actor: { type: 'object' },
      principal: { type: 'object' },
    }),
  },
  {
    name: 'execution_cancel',
    description: 'Cancel an execution run by runId using the runtime-owned AbortSignal.',
    inputSchema: objectSchema({
      runId: { type: 'string' },
      reason: { type: 'string' },
    }, ['runId']),
  },
  {
    name: 'execution_reorder',
    description: 'Reorder a queued execution run within the host-owned queue.',
    inputSchema: objectSchema({
      runId: { type: 'string' },
      beforeRunId: { type: 'string' },
      afterRunId: { type: 'string' },
      position: { type: 'integer' },
    }, ['runId']),
  },
  {
    name: 'execution_attach',
    description: 'Attach to an execution snapshot and receive advisory realtime topic names.',
    inputSchema: objectSchema({
      runId: { type: 'string' },
    }, ['runId']),
  },
  {
    name: 'execution_list',
    description: 'List durable execution records with optional status and capacity-group filters.',
    inputSchema: objectSchema({
      status: { type: 'string' },
      groupId: { type: 'string' },
    }),
  },
]);

export function createExecutionToolHandlers(options = {}) {
  let runtimeFor = options.runtimeFor || ((context, args) => resolveExecutionRuntime(context, options));
  return {
    execution_submit: async (args = {}, context = {}) => {
      let session = contextSession(context);
      let runtime = runtimeFor(context, args);
      return runtime.submit({
        ...args,
        signal: args.signal || session.executionSignal || session.signal || session.abortSignal,
      });
    },
    execution_cancel: async (args = {}, context = {}) => runtimeFor(context, args).cancel(args),
    execution_reorder: async (args = {}, context = {}) => runtimeFor(context, args).reorder(args),
    execution_attach: async (args = {}, context = {}) => runtimeFor(context, args).attach(args),
    execution_list: async (args = {}, context = {}) => runtimeFor(context, args).list(args),
  };
}

export const handlers = createExecutionToolHandlers();

export const executionToolFamily = defineToolFamily('execution', tools, handlers);

export default executionToolFamily;
