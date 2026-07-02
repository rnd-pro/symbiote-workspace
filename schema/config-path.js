/**
 * @param {string|number} segment
 * @returns {string}
 */
export function escapePointerSegment(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * @param {string} segment
 * @returns {string}
 */
export function unescapePointerSegment(segment) {
  return String(segment).replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * @param {string|number} segment
 * @returns {string}
 */
export function escapeConfigPathSegment(segment) {
  return String(segment).replace(/[\\.\\[\]/]/g, (value) => `\\${value}`);
}

/**
 * @param {string} path
 * @returns {string[]}
 */
export function splitConfigPath(path) {
  if (path === '' || path === undefined || path === null) return [];
  let source = String(path);
  let segments = [];
  let current = '';
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    let char = source[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '.') {
      if (!current && segments.length > 0 && source[i - 1] === ']') {
        continue;
      }
      if (!current) throw new Error(`Invalid config path "${source}": empty segment.`);
      segments.push(current);
      current = '';
      continue;
    }
    if (char === '[') {
      let end = source.indexOf(']', i + 1);
      if (end === -1) throw new Error(`Invalid config path "${source}": missing closing bracket.`);
      let index = source.slice(i + 1, end);
      if (!/^\d+$/.test(index)) {
        throw new Error(`Invalid config path "${source}": array index must be numeric.`);
      }
      if (current) {
        segments.push(current);
        current = '';
      }
      segments.push(index);
      i = end;
      continue;
    }
    current += char;
  }

  if (escaped) throw new Error(`Invalid config path "${source}": dangling escape.`);
  if (current) segments.push(current);
  return segments;
}

/**
 * @param {string} pointer
 * @returns {string[]}
 */
export function splitJsonPointer(pointer) {
  if (pointer === '' || pointer === '/') return [];
  if (!String(pointer).startsWith('/')) {
    throw new Error(`Invalid JSON Pointer "${pointer}": expected a leading slash.`);
  }
  return String(pointer).slice(1).split('/').map(unescapePointerSegment);
}

/**
 * @param {string|string[]} path
 * @returns {string}
 */
export function pathToPointer(path) {
  if (Array.isArray(path)) {
    if (path.length === 0) return '/';
    return `/${path.map(escapePointerSegment).join('/')}`;
  }
  if (!path) return '/';
  if (String(path).startsWith('/')) return String(path);
  let segments = splitConfigPath(String(path));
  if (segments.length === 0) return '/';
  return `/${segments.map(escapePointerSegment).join('/')}`;
}

/**
 * @param {string|string[]} pointer
 * @returns {string}
 */
export function pointerToPath(pointer) {
  let segments = Array.isArray(pointer) ? pointer.map(String) : splitJsonPointer(pointer);
  let path = '';
  for (let segment of segments) {
    if (/^\d+$/.test(segment)) {
      path += `[${segment}]`;
      continue;
    }
    let escaped = escapeConfigPathSegment(segment);
    path += path ? `.${escaped}` : escaped;
  }
  return path;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function normalizeConfigPath(path) {
  return pointerToPath(pathToPointer(path));
}

/**
 * @param {string} prefix
 * @param {string} pointer
 * @returns {string}
 */
export function prefixPointer(prefix, pointer) {
  let normalizedPrefix = pathToPointer(prefix);
  let normalized = pathToPointer(pointer);
  if (normalized === '/') return normalizedPrefix;
  if (normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`)) {
    return normalized;
  }
  return `${normalizedPrefix}${normalized}`;
}
