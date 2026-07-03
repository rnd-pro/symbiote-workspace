function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function readRef(kind, name, context, path) {
  let source = context[kind] || {};
  if (!Object.prototype.hasOwnProperty.call(source, name)) return undefined;
  return cloneJson(source[name]);
}

export function substituteLoaderArgs(source = {}, context = {}) {
  let args = {};
  for (let [name, value] of Object.entries(source.args || {})) {
    if (typeof value !== 'string' || !value.startsWith('$')) {
      args[name] = cloneJson(value);
      continue;
    }
    let match = /^\$(params|query|mount)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
    if (!match) {
      throw new Error(`Loader arg "${name}" may only reference $params, $query, or $mount.`);
    }
    args[name] = readRef(match[1], match[2], context, name);
  }
  return args;
}

export function loaderBindAddress(loader) {
  return hasText(loader?.bind) ? loader.bind : `state:route.data.${loader?.id || 'loader'}`;
}

function runnerFromSource(loader, options) {
  if (typeof options.runLoader === 'function') return options.runLoader;
  if (typeof options.loaders?.[loader.id] === 'function') return options.loaders[loader.id];

  let source = loader.source || {};
  if (hasText(source.resource)) {
    let resource = options.resources?.[source.resource];
    if (typeof resource?.[source.op] === 'function') return resource[source.op].bind(resource);
  }
  if (hasText(source.collection)) {
    let collection = options.collections?.[source.collection];
    if (typeof collection?.query === 'function') return collection.query.bind(collection);
    if (typeof collection?.list === 'function') return collection.list.bind(collection);
  }
  if (hasText(source.content)) {
    let content = options.content?.[source.content] || options.contents?.[source.content];
    if (typeof content?.get === 'function') return content.get.bind(content);
    if (typeof content?.list === 'function') return content.list.bind(content);
  }
  return null;
}

function envelope(loader, fields) {
  let result = {
    id: loader.id,
    bind: loaderBindAddress(loader),
    critical: loader.critical === true,
    required: loader.required === true,
    ...fields,
  };
  return result;
}

export async function runRouteDataLoaders(match, options = {}) {
  let route = match?.route || {};
  let context = {
    params: cloneJson(match?.params || {}),
    query: cloneJson(match?.query || {}),
    mount: cloneJson(options.mount || match?.mount || {}),
  };
  let envelopes = {};
  let ordered = [];

  for (let loader of asArray(route.data)) {
    if (!isObject(loader) || !hasText(loader.id)) continue;
    let args;
    try {
      args = substituteLoaderArgs(loader.source || {}, context);
    } catch (error) {
      let item = envelope(loader, { status: 'error', error: error.message });
      envelopes[loader.id] = item;
      ordered.push(item);
      continue;
    }

    let runner = runnerFromSource(loader, options);
    if (typeof runner !== 'function') {
      let item = envelope(loader, { status: 'missing' });
      envelopes[loader.id] = item;
      ordered.push(item);
      continue;
    }

    try {
      let value = await runner({
        loader,
        source: loader.source,
        args,
        params: context.params,
        query: context.query,
        mount: context.mount,
        match,
      });
      let item = value === undefined
        ? envelope(loader, { status: 'missing' })
        : envelope(loader, { status: 'ok', value: cloneJson(value) });
      envelopes[loader.id] = item;
      ordered.push(item);
    } catch (error) {
      let item = envelope(loader, { status: 'error', error: error?.message || 'loader-error' });
      envelopes[loader.id] = item;
      ordered.push(item);
    }
  }

  return {
    envelopes,
    ordered,
    byBind: Object.fromEntries(ordered.map((item) => [item.bind, item])),
  };
}

export function hasRequiredCriticalMissing(dataResult) {
  return asArray(dataResult?.ordered).some((item) => (
    item.critical === true &&
    item.required === true &&
    (item.status === 'missing' || item.status === 'error')
  ));
}

export function buildHydrationPayload(match, dataResult) {
  return {
    route: match ? {
      view: match.viewId,
      params: cloneJson(match.params || {}),
      query: cloneJson(match.query || {}),
      url: match.url,
    } : null,
    data: cloneJson(dataResult?.envelopes || {}),
    binds: cloneJson(dataResult?.byBind || {}),
  };
}

export function serializeHydrationPayload(payload) {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export function hydrateDataEnvelopes(payload, publisher) {
  let binds = payload?.binds || {};
  for (let [address, envelopeValue] of Object.entries(binds)) {
    if (typeof publisher === 'function') {
      publisher(address, envelopeValue);
    } else if (publisher?.pub) {
      publisher.pub(address, envelopeValue);
    } else if (publisher?.add) {
      publisher.add(address, envelopeValue, true);
    } else if (publisher && typeof publisher === 'object') {
      publisher[address] = envelopeValue;
    }
  }
  return binds;
}
