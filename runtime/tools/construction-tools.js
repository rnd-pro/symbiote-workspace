/**
 * Construction dispatch-tool family.
 * @module symbiote-workspace/runtime/tools/construction-tools
 */

import { WORKSPACE_REGISTER_VALUES } from '../../schema/workspace-schema.js';
import { scaffoldFromScratch } from '../../handlers/scaffold.js';
import { defineToolFamily } from './registry.js';

const WORKSPACE_CONSTRUCTION_HANDOFF_TYPE = 'workspace-construction-handoff';
const CONSTRUCTION_HANDOFF_SCHEMA_PROPERTIES = {
  _type: {
    type: 'string',
    enum: [WORKSPACE_CONSTRUCTION_HANDOFF_TYPE],
    description: 'Construction handoff sentinel returned by pack_handoff_create.',
  },
  valid: { type: 'boolean', description: 'Whether the source construction context is structurally valid.' },
  ready: { type: 'boolean', description: 'Whether the handoff can be constructed without readiness gaps.' },
  requirements: { type: 'object', description: 'Package or package-collection capability requirements.' },
  missing: { type: 'object', description: 'Missing package capabilities grouped by kind.' },
  source: { type: 'object', description: 'Primary package source metadata.' },
  sources: { type: 'array', items: { type: 'object' }, description: 'Package source metadata list.' },
  summary: { type: 'object', description: 'Package construction context summary.' },
  compatibility: { type: 'object', description: 'Package compatibility diagnostics.' },
  warnings: { type: 'array', items: { type: 'object' }, description: 'Non-blocking handoff diagnostics.' },
  errors: { type: 'array', items: { type: 'object' }, description: 'Blocking handoff diagnostics.' },
};

const constructionIntentProperties = {
  intent: { description: 'Workspace brief string or construction intent object.' },
  template: { type: 'string', description: 'Explicit template override.' },
  name: { type: 'string', description: 'Workspace name override.' },
  register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
  targetRegister: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
  audience: { type: 'array', items: { type: 'string' } },
  constraints: { type: 'array', items: { type: 'string' } },
  requiredCapabilities: { type: 'array', items: { type: 'string' } },
  preferredTheme: { type: 'object' },
  options: { type: 'object', description: 'Constructor options, such as handoff.options.' },
  moduleCapabilities: { type: 'array', items: { type: 'object' } },
  workspaceTemplates: { type: 'array', items: { type: 'object' } },
  answers: { type: 'object', description: 'Question answers keyed by question ID.' },
};

export const constructionTools = [
  {
    name: 'construction_template_list',
    description: 'List available workspace construction templates.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'construction_scaffold',
    description: 'Create a workspace from a template or intent text.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name or intent text.' },
        name: { type: 'string', description: 'Workspace name override.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
      },
    },
    mutates: true,
  },
  {
    name: 'construction_scaffold_blank',
    description: 'Create a blank workspace config from scratch.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workspace name.' },
        register: { type: 'string', enum: WORKSPACE_REGISTER_VALUES },
      },
    },
    mutates: true,
  },
  {
    name: 'construction_classify',
    description: 'Classify workspace intent and return the normalized intent, questionnaire, and next planning action.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'Workspace brief or intent text.' },
        workspaceTemplates: { type: 'array', items: { type: 'object' } },
      },
      required: ['intent'],
    },
  },
  {
    name: 'construction_questions_build',
    description: 'Build deterministic construction questions for an intent without planning or mutating the session.',
    inputSchema: {
      type: 'object',
      properties: constructionIntentProperties,
      required: ['intent'],
    },
  },
  {
    name: 'construction_question_answer',
    description: 'Apply one construction answer and return the re-evaluated questionnaire without mutating the session.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: { type: 'array', items: { type: 'object' } },
        questionId: { type: 'string', description: 'Construction question ID to answer.' },
        answer: { description: 'Answer value for the selected question.' },
      },
      required: ['questions', 'questionId', 'answer'],
    },
  },
  {
    name: 'construction_plan',
    description: 'Generate construction diagnostics, questions, plan, readiness summary, and config without mutating the session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...constructionIntentProperties,
        ...CONSTRUCTION_HANDOFF_SCHEMA_PROPERTIES,
      },
      required: ['intent'],
    },
  },
  {
    name: 'construction_construct',
    description: 'Generate a construction plan and store the executable config.',
    inputSchema: {
      type: 'object',
      properties: {
        ...constructionIntentProperties,
        ...CONSTRUCTION_HANDOFF_SCHEMA_PROPERTIES,
      },
      required: ['intent'],
    },
    mutates: true,
  },
];

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = child;
  }
  return result;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function packageContextFromHandoff(args) {
  if (!isConstructionHandoffArgs(args)) return undefined;
  let context = isObject(args.options?.packageContext) ? cloneJson(args.options.packageContext) : {};
  for (let field of [
    'valid',
    'ready',
    'requirements',
    'missing',
    'source',
    'sources',
    'summary',
    'compatibility',
    'warnings',
    'errors',
    'readiness',
  ]) {
    if (args[field] !== undefined) context[field] = cloneJson(args[field]);
  }
  return compactObject(context);
}

function constructionIntentFromArgs(args) {
  let intent = args.intent;
  if (typeof intent !== 'string' && !isObject(intent)) return intent;

  let result = typeof intent === 'string' ? { brief: intent } : { ...intent };
  for (let field of [
    'template',
    'targetRegister',
    'audience',
    'constraints',
    'requiredCapabilities',
    'preferredTheme',
  ]) {
    if (args[field] !== undefined && result[field] === undefined) result[field] = args[field];
  }
  if (args.register !== undefined && result.targetRegister === undefined) {
    result.targetRegister = args.register;
  }
  return result;
}

function constructionOptionsFromArgs(args, intent) {
  if (args.options !== undefined && !isObject(args.options)) {
    throw new Error('Construction options must be a plain object when provided.');
  }

  let options = args.options ? { ...args.options } : {};
  let optionRegister = options.register;
  delete options.register;

  if (args.targetRegister !== undefined) {
    options.register = args.targetRegister;
  } else if (args.register !== undefined && !intent?.targetRegister) {
    options.register = args.register;
  } else if (optionRegister !== undefined && !intent?.targetRegister) {
    options.register = optionRegister;
  }

  for (let field of ['name', 'answers', 'moduleCapabilities', 'workspaceTemplates', 'theme']) {
    if (args[field] !== undefined) options[field] = args[field];
  }
  let packageContext = packageContextFromHandoff(args);
  if (packageContext !== undefined) options.packageContext = packageContext;

  return options;
}

function isConstructionHandoffArgs(args) {
  return isObject(args)
    && (isObject(args.intent) || typeof args.intent === 'string')
    && isObject(args.options)
    && (
      args._type === WORKSPACE_CONSTRUCTION_HANDOFF_TYPE
      || args.valid !== undefined
      || args.ready !== undefined
      || Array.isArray(args.errors)
      || Array.isArray(args.warnings)
      || args.source !== undefined
      || args.sources !== undefined
      || isObject(args.options.packageContext)
    );
}

function flatMissingCapabilities(missing) {
  if (!isObject(missing)) return [];
  return Object.values(missing).filter(Array.isArray).flat();
}

const MISSING_RECOVERY_ACTIONS = {
  components: 'register-component',
  plugins: 'install-plugin',
  packages: 'import-package',
  hostServices: 'provide-host-service',
  runtimeSlots: 'provide-runtime-slot',
};

function missingRecoverySteps(missing) {
  if (!isObject(missing)) return [];
  let steps = [];
  for (let [kind, items] of Object.entries(missing)) {
    if (!Array.isArray(items)) continue;
    let action = MISSING_RECOVERY_ACTIONS[kind] || 'provide-capability';
    for (let item of items) steps.push({ kind, item, action });
  }
  return steps;
}

function constructionReadinessFromPackageContext(context = {}, overrides = {}) {
  let warnings = Array.isArray(context.warnings) ? context.warnings : [];
  let errors = Array.isArray(context.errors) ? context.errors : [];
  let missing = flatMissingCapabilities(context.missing);
  let recovery = missingRecoverySteps(context.missing);
  let errorCount = errors.length;
  let ready = context.valid === true && context.ready === true && missing.length === 0 && errorCount === 0;

  return compactObject({
    ready,
    valid: context.valid === true,
    status: ready ? 'ready' : (errorCount > 0 ? 'blocked' : 'warning'),
    missingCount: missing.length,
    warningCount: warnings.length,
    errorCount,
    missing: cloneJson(context.missing),
    recovery: recovery.length > 0 ? recovery : undefined,
    warnings: cloneJson(warnings),
    errors: cloneJson(errors),
    source: cloneJson(context.source),
    sources: cloneJson(context.sources),
    ...overrides,
  });
}

function constructionReadinessFromHandoff(args, overrides = {}) {
  return constructionReadinessFromPackageContext(packageContextFromHandoff(args) || {}, overrides);
}

function moduleCapabilityAlternatives(capabilities, capability) {
  let byCapability = Array.isArray(capabilities.byCapability) ? capabilities.byCapability : [];
  let match = byCapability.find((item) => item?.capability === capability);
  let alternatives = Array.isArray(match?.alternatives) ? match.alternatives : [];
  return alternatives.length > 0 ? cloneJson(alternatives) : undefined;
}

function constructionReadinessFromPlan(plan, overrides = {}) {
  let capabilities = plan?.capabilities || {};
  let missing = Array.isArray(capabilities.missing) ? capabilities.missing : [];
  return compactObject({
    ready: missing.length === 0,
    valid: true,
    status: missing.length > 0 ? 'blocked' : 'ready',
    nextAction: missing.length > 0 ? 'provide-module-capabilities' : 'construction_construct',
    missingCount: missing.length,
    warningCount: 0,
    errorCount: 0,
    missing: missing.length > 0 ? { moduleCapabilities: cloneJson(missing) } : undefined,
    recovery: missing.length > 0
      ? missing.map((item) => compactObject({
        kind: 'moduleCapabilities',
        item,
        action: 'provide-module-capability',
        alternatives: moduleCapabilityAlternatives(capabilities, item),
      }))
      : undefined,
    requiredCapabilities: cloneJson(capabilities.required),
    matchedCapabilities: cloneJson(capabilities.matched),
    ...overrides,
  });
}

function topLevelConstructionReadiness(plan) {
  let packageReadiness = cloneJson(plan?.readiness?.package);
  let capabilityReadiness = constructionReadinessFromPlan(plan);
  if (!packageReadiness) return capabilityReadiness.ready ? undefined : capabilityReadiness;
  if (!packageReadiness.ready) {
    let context = plan?.packageContext;
    return context ? constructionReadinessFromPackageContext(context, packageReadiness) : packageReadiness;
  }
  if (capabilityReadiness.ready) return packageReadiness;
  return capabilityReadiness;
}

function assertUsableConstructionHandoff(args, { requireReady = false } = {}) {
  if (!isConstructionHandoffArgs(args)) return;
  let context = packageContextFromHandoff(args) || {};
  let errors = Array.isArray(context.errors) ? context.errors : [];
  let warnings = Array.isArray(context.warnings) ? context.warnings : [];
  let missing = flatMissingCapabilities(context.missing);
  if (context.valid === false || errors.length > 0) {
    let detail = errors
      .map((error) => error?.message || error?.path)
      .filter(Boolean)
      .join('; ');
    let err = new Error(`Construction handoff is invalid${detail ? `: ${detail}` : '.'}`);
    err.code = 'construction_handoff_invalid';
    err.nextAction = 'fix-package-context';
    err.readiness = constructionReadinessFromHandoff(args, {
      ready: false,
      status: 'blocked',
    });
    throw err;
  }
  if (requireReady && (context.ready !== true || missing.length > 0 || warnings.length > 0)) {
    let detail = [
      ...missing,
      ...warnings.map((warning) => warning?.message || warning?.path).filter(Boolean),
    ].join('; ');
    let err = new Error(`Construction handoff is not ready${detail ? `: ${detail}` : '.'}`);
    err.code = 'construction_handoff_not_ready';
    err.nextAction = 'review-package-readiness';
    err.readiness = constructionReadinessFromHandoff(args, {
      ready: false,
      status: 'warning',
      errorCount: 0,
    });
    throw err;
  }
}

function assertConstructiblePlan(result) {
  let missing = result?.plan?.capabilities?.missing;
  if (!Array.isArray(missing) || missing.length === 0) return;
  let err = new Error(`Construction plan is missing required capabilities: ${missing.join(', ')}.`);
  err.code = 'construction_capabilities_missing';
  err.nextAction = 'provide-module-capabilities';
  err.readiness = constructionReadinessFromPlan(result.plan, { ready: false });
  err.plan = result.plan;
  throw err;
}

function constructionError(toolName, err) {
  return compactObject({
    status: 'error',
    tool: toolName,
    hint: err.message,
    code: err.code,
    nextAction: err.nextAction,
    readiness: cloneJson(err.readiness),
    plan: cloneJson(err.plan),
  });
}

async function getConstructor() {
  return import('../../constructor/index.js');
}

async function constructionTemplateList(args) {
  let c = await getConstructor();
  let templates = c.listTemplates({ workspaceTemplates: args.workspaceTemplates });
  return { templates, count: templates.length };
}

async function constructionScaffold(args) {
  let c = await getConstructor();
  let config = c.planWorkspace(args.template || '', {
    name: args.name,
    register: args.register,
  });
  return { config, status: 'ok', hint: `Workspace "${config.name}" created.` };
}

function constructionScaffoldBlank(args) {
  let config = scaffoldFromScratch({ name: args.name, register: args.register });
  return { config, status: 'ok', hint: `Blank workspace "${config.name}" created.` };
}

async function constructionClassify(args) {
  let c = await getConstructor();
  try {
    let constructionIntent = constructionIntentFromArgs(args);
    let options = constructionOptionsFromArgs(args, constructionIntent);
    let normalized = c.normalizeConstructionIntent(constructionIntent, options);
    let templateMatch = c.matchTemplate(normalized.brief, options);
    return {
      status: 'ok',
      templateName: normalized.template,
      fallback: !templateMatch && !constructionIntent?.template,
      intent: normalized,
      questions: c.buildConstructionQuestions(normalized, options),
      readiness: {
        ready: true,
        valid: true,
        status: 'ready',
        nextAction: 'construction_plan',
      },
      nextAction: 'construction_plan',
    };
  } catch (err) {
    return constructionError('construction_classify', err);
  }
}

async function constructionQuestionsBuild(args) {
  let c = await getConstructor();
  try {
    let constructionIntent = constructionIntentFromArgs(args);
    let options = constructionOptionsFromArgs(args, constructionIntent);
    let intent = c.normalizeConstructionIntent(constructionIntent, options);
    return {
      status: 'ok',
      intent,
      templateName: intent.template,
      questions: c.buildConstructionQuestions(intent, options),
      readiness: {
        ready: true,
        valid: true,
        status: 'ready',
        nextAction: 'construction_plan',
      },
      nextAction: 'construction_plan',
    };
  } catch (err) {
    return constructionError('construction_questions_build', err);
  }
}

async function constructionQuestionAnswer(args) {
  let c = await getConstructor();
  try {
    let questions = c.answerConstructionQuestion(args.questions, args.questionId, args.answer);
    return {
      status: 'ok',
      questions,
      answeredQuestionId: args.questionId,
      readiness: {
        ready: true,
        valid: true,
        status: 'ready',
        nextAction: 'construction_plan',
      },
      nextAction: 'construction_plan',
    };
  } catch (err) {
    return constructionError('construction_question_answer', err);
  }
}

async function constructionPlan(args) {
  let c = await getConstructor();
  let result;
  try {
    assertUsableConstructionHandoff(args);
    let constructionIntent = constructionIntentFromArgs(args);
    result = c.planWorkspaceConstruction(
      constructionIntent,
      constructionOptionsFromArgs(args, constructionIntent),
    );
  } catch (err) {
    return constructionError('construction_plan', err);
  }
  return compactObject({
    status: 'ok',
    templateName: result.intent.template,
    intent: result.intent,
    questions: result.questions,
    plan: result.plan,
    readiness: topLevelConstructionReadiness(result.plan),
    verification: cloneJson(result.plan.verification),
    config: result.config,
  });
}

async function constructionConstruct(args) {
  let c = await getConstructor();
  let result;
  try {
    assertUsableConstructionHandoff(args, { requireReady: true });
    let constructionIntent = constructionIntentFromArgs(args);
    result = c.planWorkspaceConstruction(
      constructionIntent,
      constructionOptionsFromArgs(args, constructionIntent),
    );
    assertConstructiblePlan(result);
  } catch (err) {
    return constructionError('construction_construct', err);
  }
  return compactObject({
    status: 'ok',
    templateName: result.intent.template,
    intent: result.intent,
    questions: result.questions,
    plan: result.plan,
    readiness: topLevelConstructionReadiness(result.plan),
    verification: cloneJson(result.plan.verification),
    config: result.config,
    hint: `Workspace "${result.config.name}" constructed from "${result.intent.template}".`,
  });
}

const handlers = {
  construction_template_list: constructionTemplateList,
  construction_scaffold: constructionScaffold,
  construction_scaffold_blank: constructionScaffoldBlank,
  construction_classify: constructionClassify,
  construction_questions_build: constructionQuestionsBuild,
  construction_question_answer: constructionQuestionAnswer,
  construction_plan: constructionPlan,
  construction_construct: constructionConstruct,
};

export const constructionToolFamily = defineToolFamily('construction', constructionTools, handlers);
