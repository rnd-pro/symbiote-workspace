/**
 * Dispatch tool-family registry helpers.
 * @module symbiote-workspace/runtime/tools/registry
 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function withBaseRevision(tool) {
  if (tool.mutates !== true) return tool;
  let inputSchema = cloneJson(tool.inputSchema || { type: 'object', properties: {} });
  if (!isPlainObject(inputSchema.properties)) inputSchema.properties = {};
  inputSchema.properties.baseRevision = {
    type: 'integer',
    description: 'Workspace config revision this mutation is based on.',
  };
  return { ...tool, inputSchema };
}

function validateTool(tool, familyName) {
  if (!isPlainObject(tool)) {
    throw new Error(`Invalid tool definition in ${familyName}: expected an object.`);
  }
  if (typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new Error(`Invalid tool definition in ${familyName}: missing name.`);
  }
  if (typeof tool.description !== 'string' || tool.description.length === 0) {
    throw new Error(`Invalid tool definition for ${tool.name}: missing description.`);
  }
  if (!isPlainObject(tool.inputSchema)) {
    throw new Error(`Invalid tool definition for ${tool.name}: missing inputSchema.`);
  }
  if (tool.mutates === true && !tool.inputSchema?.properties?.baseRevision) {
    throw new Error(`Mutating tool ${tool.name} must accept baseRevision.`);
  }
}

function normalizeFamily(family, index) {
  if (!isPlainObject(family)) {
    throw new Error(`Invalid tool family at index ${index}: expected an object.`);
  }
  let name = family.name || `family-${index}`;
  let tools = (family.tools || []).map(withBaseRevision);
  let handlers = family.handlers || {};
  if (!Array.isArray(tools)) {
    throw new Error(`Invalid tool family ${name}: tools must be an array.`);
  }
  if (!isPlainObject(handlers)) {
    throw new Error(`Invalid tool family ${name}: handlers must be an object.`);
  }
  for (let tool of tools) {
    validateTool(tool, name);
    if (typeof handlers[tool.name] !== 'function') {
      throw new Error(`Tool ${tool.name} in ${name} has no handler.`);
    }
  }
  return { name, tools, handlers };
}

/**
 * Merge dispatch tool families into one registry.
 *
 * @param {Array<{name?: string, tools: Object[], handlers: Object<string, Function>}>} families
 * @returns {{tools: Object[], toolMap: Map<string, Object>, handlers: Map<string, Function>, families: Object[]}}
 */
export function createToolRegistry(families) {
  let normalized = families.map(normalizeFamily);
  let tools = [];
  let toolMap = new Map();
  let handlers = new Map();

  for (let family of normalized) {
    for (let tool of family.tools) {
      if (toolMap.has(tool.name)) {
        let existing = toolMap.get(tool.name);
        throw new Error(
          `Duplicate dispatch tool name "${tool.name}" in ${family.name}; already registered by ${existing.family}.`,
        );
      }
      let registeredTool = { ...tool, family: family.name };
      tools.push(registeredTool);
      toolMap.set(tool.name, registeredTool);
      handlers.set(tool.name, family.handlers[tool.name]);
    }
  }

  return { tools: Object.freeze(tools), toolMap, handlers, families: Object.freeze(normalized) };
}

/**
 * Build an ordinary tool-family object.
 *
 * @param {string} name
 * @param {Object[]} tools
 * @param {Object<string, Function>} handlers
 * @returns {{name: string, tools: Object[], handlers: Object<string, Function>}}
 */
export function defineToolFamily(name, tools, handlers) {
  return { name, tools, handlers };
}
