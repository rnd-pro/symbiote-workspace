import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exportConfig } from '../../sharing/index.js';
import {
  BROWSER_ENGINE_CONTRACTS_IMPORT,
  BROWSER_ENGINE_IMPORT,
  BROWSER_THEME_IMPORT,
} from '../../sharing/browser-contract.js';
import { buildRealtimeChatStateDemo } from './realtime-builder-state.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeScriptJson(value) {
  return JSON.stringify(value, null, 2).replaceAll('</script', '<\\/script');
}

function progressPercent(index, total) {
  return Math.round(((index + 1) / total) * 100);
}

function buildStreamOperations(stage) {
  let chatState = stage.chatState || {};
  let required = chatState.requiredElements || [];
  let roles = Object.keys(chatState.layoutRoles || {});
  let adaptive = chatState.adaptiveBehavior?.collapseOrder || [];
  let latestDecision = chatState.decisionTrace?.at(-1);
  return [
    {
      label: 'Read chat state',
      value: chatState.questionnaireStatus || stage.activeQuestionId,
      status: 'done',
    },
    {
      label: 'Apply workspace patch',
      value: latestDecision
        ? `${latestDecision.questionId}: ${latestDecision.operations.join(' -> ')}`
        : chatState.nextPatch || 'Waiting for next questionnaire answer.',
      status: 'active',
    },
    {
      label: 'Resolve required UI',
      value: required.length ? required.join(', ') : 'Intent panels only',
      status: required.length >= 4 ? 'done' : 'active',
    },
    {
      label: 'Rank layout behavior',
      value: roles.length
        ? `${roles.length} roles, collapse: ${adaptive.join(' -> ') || 'pending'}`
        : 'Waiting for layout roles',
      status: adaptive.length >= 3 ? 'done' : 'active',
    },
  ];
}

function generateIndexHtml(title, imports) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
  <script type="importmap">
${escapeScriptJson({ imports })}
  <\/script>
</head>
<body>
  <script type="module" src="./app.js"><\/script>
</body>
</html>`;
}

function generateAppJs(demo) {
  return `import { mountWorkspace, validateWorkspaceConfig } from 'symbiote-workspace/browser';
import { applyCascadeGeometryRegister, applyCascadeTheme, CASCADE_THEME_DEFAULTS, defineModule } from '${BROWSER_THEME_IMPORT}';
import 'symbiote-ui/board';

let demo = ${escapeScriptJson(demo)};
let stageIndex = 0;
let operationIndex = 0;
let viewportMode = 'wide';
let activeScenarioId = demo.defaultScenarioId || demo.professionalScenarios?.[0]?.id || '';
let mounted = null;
let playTimer = null;
let definedDemoModuleTags = new Set();
let layoutInstanceSeq = 0;

applyCascadeTheme(document.documentElement, CASCADE_THEME_DEFAULTS, {
  notify: false,
  source: 'realtime-builder-default',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizeLayoutNode(node, path = 'root') {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'panel') {
    return {
      ...node,
      id: node.id || \`\${path}-\${node.panelType || 'panel'}\`,
    };
  }
  if (node.type === 'split') {
    return {
      ...node,
      id: node.id || \`\${path}-split\`,
      first: normalizeLayoutNode(node.first, \`\${path}-a\`),
      second: normalizeLayoutNode(node.second, \`\${path}-b\`),
    };
  }
  return node;
}

function buildPreviewLayout(panelIds, depth = 0) {
  if (panelIds.length <= 1) {
    return { type: 'panel', panelType: panelIds[0] || 'layout-preview' };
  }
  let splitAt = Math.ceil(panelIds.length / 2);
  return {
    type: 'split',
    direction: depth % 2 === 0 ? 'horizontal' : 'vertical',
    ratio: 0.5,
    first: buildPreviewLayout(panelIds.slice(0, splitAt), depth + 1),
    second: buildPreviewLayout(panelIds.slice(splitAt), depth + 1),
  };
}

function buildLayoutPreview(stage) {
  let roles = stage.chatState?.layoutRoles || {};
  let ids = Object.keys(roles);
  if (!ids.length) ids = Object.keys(stage.config?.panelTypes || {}).slice(0, 4);
  let panelTypes = Object.fromEntries(ids.map((id) => [
    id,
    {
      title: id,
      icon: stage.config?.panelTypes?.[id]?.icon || 'web_asset',
      component: 'sn-empty-state',
      properties: {
        textContent: roles[id] || stage.config?.panelTypes?.[id]?.title || 'Layout slot',
      },
    },
  ]));
  return {
    panelTypes,
    layout: buildPreviewLayout(ids),
  };
}

function moduleField(label, value) {
  let display = Array.isArray(value) ? value.join(', ') : value;
  return \`<sn-description-item label="\${escapeHtml(label)}">\${escapeHtml(display || 'pending')}</sn-description-item>\`;
}

function collectProofValues(value, output = []) {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (let item of value) collectProofValues(item, output);
    return output;
  }
  if (typeof value === 'object') {
    for (let item of Object.values(value)) collectProofValues(item, output);
  }
  return output;
}

function demoProofText(...values) {
  return collectProofValues(values)
    .join(' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function setHydrationProof(element, panelType, ...values) {
  if (!element) return;
  element.setAttribute('data-demo-hydrated', panelType);
  let proof = demoProofText(...values);
  if (proof) element.setAttribute('data-demo-proof', proof);
}

function setDescriptionList(list, items, panelType) {
  if (!list) return;
  list.innerHTML = items.map(([label, value]) => moduleField(label, value)).join('');
  setHydrationProof(list, panelType, items);
}

function setDataTable(table, columns, rows, panelType, emptyText = 'No rows') {
  if (!table) return;
  table.setData?.({ columns, rows, emptyText });
  table.setAttribute('selection-mode', 'single');
  setHydrationProof(table, panelType, columns, rows);
}

function builderWidgetItems(stage) {
  return (stage.chatState?.widgetRegistry || []).map((widget) => ({
    id: widget.id,
    label: widget.id,
    children: [
      { id: \`\${widget.id}:role\`, label: widget.role || 'module' },
      { id: \`\${widget.id}:status\`, label: widget.status || 'pending' },
    ],
  }));
}

function validationEvents(stage) {
  let validation = validateWorkspaceConfig(stage.config, { strict: true });
  let checklist = stage.chatState?.validationChecklist || [];
  return [
    {
      id: 'strict-validation',
      title: 'Strict validation',
      description: validation.valid ? 'Workspace config passes strict validation.' : 'Workspace config has strict validation errors.',
      status: validation.valid ? 'pass' : 'fail',
      icon: validation.valid ? 'task_alt' : 'error',
      time: stage.title,
    },
    ...checklist.map((item) => ({
      id: item.id,
      title: item.id,
      description: item.status || 'pending',
      status: item.status || 'pending',
      icon: item.status === 'pass' ? 'task_alt' : 'pending',
      time: stage.title,
    })),
  ];
}

function activeScenario() {
  return (demo.professionalScenarios || []).find((scenario) => scenario.id === activeScenarioId) || null;
}

function scenarioPanelData(panelType) {
  return activeScenario()?.panelData?.[panelType] || {};
}

function findPanelElement(root, selector) {
  if (root?.matches?.(selector)) return root;
  return root?.querySelector?.(selector) || null;
}

function createVideoPosterDataUrl(media = {}) {
  let title = escapeHtml(media.title || 'Video cut');
  let subtitle = escapeHtml(media.subtitle || 'Preview');
  let frame = escapeHtml(media.frame || '00:00');
  let duration = escapeHtml(media.duration || '01:00');
  let svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#151923"/>
        <stop offset="0.48" stop-color="#273348"/>
        <stop offset="1" stop-color="#11131a"/>
      </linearGradient>
      <linearGradient id="light" x1="0" x2="1">
        <stop offset="0" stop-color="#6ee7f9" stop-opacity="0.8"/>
        <stop offset="1" stop-color="#a78bfa" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect x="78" y="58" width="1124" height="604" rx="18" fill="#0b0d13" opacity="0.62"/>
    <rect x="112" y="92" width="1056" height="504" rx="14" fill="#1f2937"/>
    <path d="M112 510 C260 402 376 490 500 380 C662 236 796 410 936 258 C1032 154 1116 194 1168 152 L1168 596 L112 596 Z" fill="url(#light)" opacity="0.78"/>
    <circle cx="280" cy="210" r="88" fill="#fbbf24" opacity="0.94"/>
    <rect x="112" y="596" width="1056" height="58" fill="#07080d" opacity="0.72"/>
    <rect x="152" y="620" width="684" height="8" rx="4" fill="#ffffff" opacity="0.16"/>
    <rect x="152" y="620" width="368" height="8" rx="4" fill="#67e8f9"/>
    <text x="154" y="136" fill="#f8fafc" font-family="Inter, system-ui, sans-serif" font-size="42" font-weight="700">\${title}</text>
    <text x="156" y="180" fill="#cbd5e1" font-family="Inter, system-ui, sans-serif" font-size="22">\${subtitle}</text>
    <text x="1012" y="638" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24">\${frame} / \${duration}</text>
  </svg>\`;
  return \`data:image/svg+xml;charset=UTF-8,\${encodeURIComponent(svg)}\`;
}

function createTrackClips(track) {
  return (track.clips || []).map((clip) => {
    let start = Math.max(0, Math.min(92, Number(clip.start || 0)));
    let span = Math.max(6, Math.min(96 - start, Number(clip.span || 12)));
    return \`
      <span
        class="demo-timeline-clip"
        style="--clip-start: \${start}%; --clip-span: \${span}%; --clip-color: \${escapeHtml(clip.color || 'var(--sn-node-selected)')};"
      >\${escapeHtml(clip.label || 'clip')}</span>
    \`;
  }).join('');
}

function chatMessageItems(stage) {
  return (stage.chat || []).map((turn, index) => ({
    id: \`demo-\${stage.id}-\${index}\`,
    role: turn.role === 'assistant' || turn.speaker === 'agent' ? 'agent' : 'user',
    text: turn.text,
  }));
}

function demoVoiceControls() {
  return {
    input: {
      visible: true,
      enabled: true,
      state: 'idle',
    },
    wakeListen: {
      visible: false,
      enabled: true,
      active: false,
      commandText: 'builder',
    },
    response: {
      visible: false,
      enabled: true,
      active: false,
      speaking: false,
    },
    command: {
      visible: false,
      enabled: true,
      active: false,
      text: 'Commands',
    },
    language: {
      visible: false,
      enabled: true,
      mode: 'auto',
      options: [
        { mode: 'auto', label: 'auto' },
        { mode: 'ru', label: 'RU' },
        { mode: 'en', label: 'EN' },
      ],
    },
  };
}

function buildWorkspaceState(stage) {
  let chatState = stage.chatState || {};
  let scenario = activeScenario();
  let scenarioState = scenario?.panelData?.chat?.workspaceState;
  if (scenarioState) return scenarioState;
  return {
    sidebar: 'hidden',
    chats: [{
      id: 'realtime-builder',
      title: scenario?.title || demo.name,
      subtitle: chatState.questionnaireStatus || stage.title,
    }],
    activeChatId: 'realtime-builder',
    messages: chatMessageItems(stage),
    messagesOptions: { scrollToBottom: true },
    composer: {
      placeholder: chatState.nextPatch || 'Describe the workspace to build...',
      value: '',
      attachedContext: [
        { id: 'stage', label: stage.title },
        { id: 'question', label: chatState.activeQuestionId || 'questionnaire' },
      ],
      footerControls: [
        { id: 'layout', kind: 'button', icon: 'view_quilt', label: 'Layout', value: stage.config.layout?.type || 'split' },
        { id: 'theme', kind: 'button', icon: 'palette', label: 'Theme', value: stage.config.theme?.params?.mode || 'default' },
      ],
    },
    voiceControls: demoVoiceControls(),
    liveStatus: {
      phase: 'running',
      title: 'Realtime builder',
      text: chatState.nextPatch || stage.title,
    },
    backgroundState: 'activity',
  };
}

function constructorTemplateGroups(data = {}) {
  let templates = data.templates || [
    { id: 'video-studio', name: 'Video Studio', icon: 'movie', sidebarIcon: 'movie' },
    { id: 'social-automation', name: 'Automation Studio', icon: 'hub', sidebarIcon: 'hub' },
    { id: 'agent-workspace', name: 'Agent Programming', icon: 'code', sidebarIcon: 'code' },
  ];
  return templates.map((template, index) => ({
    id: template.id,
    name: template.name || template.label || template.id,
    icon: template.icon || 'dashboard_customize',
    sidebarIcon: template.sidebarIcon || template.icon || 'dashboard_customize',
    color: template.color || 'var(--sn-tab-accent-' + (index % 6) + ')',
    closeable: template.closeable === true,
  }));
}

function constructorTabs(data = {}) {
  return (data.tabs || []).map((tab, index) => {
    if (typeof tab === 'string') {
      return {
        id: tab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        name: tab,
        icon: ['movie', 'hub', 'code'][index] || 'folder',
      };
    }
    return {
      id: tab.id,
      name: tab.name || tab.label || tab.id,
      icon: tab.icon || 'folder',
      closeable: tab.closeable === true,
    };
  });
}

function constructorPaletteCategories(data = {}) {
  let categories = data.categories || [{
    category: 'Workspace modules',
    color: 'var(--sn-node-selected)',
    items: data.modules || [
      { name: 'chat-workspace', icon: 'chat', type: 'chat-workspace', desc: 'Agent chat module' },
      { name: 'panel-layout', icon: 'view_quilt', type: 'panel-layout', desc: 'Manual split layout' },
      { name: 'cascade-theme-editor', icon: 'palette', type: 'cascade-theme-editor', desc: 'Cascade theme editor' },
      { name: 'sn-kanban-board', icon: 'view_kanban', type: 'sn-kanban-board', desc: 'Workflow kanban board' },
    ],
  }];
  return categories.map((category) => ({
    ...category,
    items: (category.items || []).map((item) => ({
      ...item,
      name: item.name || item.type,
      type: item.type || item.name,
      icon: item.icon || 'widgets',
      desc: item.desc || item.description || item.type || item.name,
      factory: () => ({ type: item.type || item.name }),
    })),
  }));
}

function setConstructorMenuItems(menu, actions = []) {
  if (!menu) return;
  menu.textContent = '';
  actions.forEach((action, index) => {
    let item = document.createElement('sn-menu-item');
    let label = typeof action === 'string' ? action : action.label || action.id;
    let defaultIcon = ['folder_open', 'splitscreen', 'add_box', 'ios_share'][index] || 'bolt';
    let icon = typeof action === 'string' ? defaultIcon : action.icon || 'bolt';
    item.textContent = label || 'Action';
    item.setAttribute('icon', icon);
    if (typeof action === 'object' && action.shortcut) item.setAttribute('shortcut', action.shortcut);
    menu.appendChild(item);
  });
}

function hydratePanelContent(root, panelType, stage) {
  let data = scenarioPanelData(panelType);
  let chatSelector = panelType === 'agent-chat' || panelType === 'chat';
  if (chatSelector) {
    let workspace = findPanelElement(root, 'chat-workspace');
    workspace?.classList?.add('chat-workspace-view', 'demo-chat-workspace');
    workspace?.setWorkspaceState?.(buildWorkspaceState(stage));
  }
  if (panelType === 'theme-editor') {
    let params = stage.config.theme?.params || CASCADE_THEME_DEFAULTS;
    let editor = findPanelElement(root, 'cascade-theme-editor');
    editor?.setThemeState?.(params);
  }
  if (panelType === 'layout-builder' || panelType === 'layout') {
    let layoutBuilder = findPanelElement(root, 'panel-layout');
    if (layoutBuilder) {
      let preview = buildLayoutPreview(stage);
      layoutBuilder.classList.add('demo-layout-builder-surface');
      layoutBuilder.setAttribute('responsive-mode', stage.config.rootBehavior?.responsiveMode || 'drawer');
      layoutBuilder.setAttribute('responsive-breakpoint', String(stage.config.rootBehavior?.responsiveBreakpoint || 860));
      layoutBuilder.setAttribute('swipe-control', stage.config.rootBehavior?.swipeControl || 'edge');
      layoutBuilder.$.panelTypes = preview.panelTypes;
      layoutBuilder.$.layoutTree = normalizeLayoutNode(preview.layout, 'layout-preview');
      setHydrationProof(layoutBuilder, panelType, preview);
    }
  }
  if (panelType === 'templates') {
    let shellMenu = findPanelElement(root, 'layout-shell-menu');
    if (shellMenu) {
      let groups = constructorTemplateGroups(data);
      shellMenu.setAttribute('title', data.title || 'Template Layouts');
      shellMenu.setAttribute('title-icon', 'dashboard_customize');
      shellMenu.setAttribute('path-label', data.pathLabel || 'templates / reusable layouts');
      if (shellMenu.$) {
        shellMenu.$.title = data.title || 'Template Layouts';
        shellMenu.$.titleIcon = 'dashboard_customize';
        shellMenu.$.pathLabel = data.pathLabel || 'templates / reusable layouts';
      }
      shellMenu.setGroups?.(groups, data.activeId || groups[0]?.id);
      setHydrationProof(shellMenu, panelType, data.note, groups);
    }
  }
  if (panelType === 'tabs') {
    let tabs = findPanelElement(root, 'project-tabs');
    if (tabs) {
      let items = constructorTabs(data);
      tabs.setTabs?.(items, data.activeId || items[0]?.id);
      setHydrationProof(tabs, panelType, items);
    }
  }
  if (panelType === 'palette') {
    let palette = findPanelElement(root, 'palette-browser');
    if (palette) {
      let categories = constructorPaletteCategories(data);
      if (palette.$) {
        palette.$.title = data.title || 'Module Palette';
        palette.$.searchPlaceholder = data.searchPlaceholder || 'Search modules';
      }
      palette.setCategories?.(categories);
      setHydrationProof(palette, panelType, data.note, categories);
    }
  }
  if (panelType === 'menu') {
    let menu = findPanelElement(root, 'sn-menu');
    if (menu) {
      setConstructorMenuItems(menu, data.actions);
      setHydrationProof(menu, panelType, data.actions);
    }
  }
  if (panelType === 'service-blueprint') {
    let blueprint = stage.chatState?.serviceBlueprint || {};
    setDescriptionList(findPanelElement(root, 'sn-description-list'), [
      ['Intent', stage.chatState?.activeIntent],
      ['Entities', blueprint.entities],
      ['Workflows', blueprint.workflows],
      ['Outputs', blueprint.outputs],
    ], panelType);
  }
  if (panelType === 'widget-registry') {
    let tree = findPanelElement(root, 'sn-tree-panel');
    if (tree) {
      tree.setAttribute('title', 'Widget Registry');
      tree.setAttribute('title-icon', 'widgets');
      tree.setItems?.(builderWidgetItems(stage));
      tree.showTree?.();
      setHydrationProof(tree, panelType, builderWidgetItems(stage));
    }
  }
  if (panelType === 'bindings-inspector') {
    let rows = (stage.config.data?.bindings || []).map((bindingItem) => ({
      id: bindingItem.id,
      panelType: bindingItem.panelType,
      direction: bindingItem.direction,
      path: bindingItem.path,
    }));
    setDataTable(
      findPanelElement(root, 'sn-data-table'),
      [
        { key: 'panelType', label: 'Panel', sortable: true },
        { key: 'direction', label: 'Direction', sortable: true },
        { key: 'path', label: 'State path' },
      ],
      rows,
      panelType,
      'No bindings'
    );
  }
  if (panelType === 'adaptive-rules') {
    let adaptive = stage.chatState?.adaptiveBehavior || {};
    let shell = findPanelElement(root, 'sn-list-detail-shell');
    if (shell) {
      shell.setAttribute('sidebar-title', 'Adaptive Rules');
      shell.setAttribute('sidebar-icon', 'collapse_content');
      shell.setAttribute('detail-title', adaptive.mode || 'Responsive policy');
      shell.setAttribute('detail-icon', 'responsive_layout');
      shell.setAttribute('detail-description', \`Breakpoint \${adaptive.breakpoint || 'pending'}\`);
      shell.hasDetail = true;
      shell.innerHTML = \`
        <sn-description-list slot="list">\${moduleField('Pinned', adaptive.pinned)}</sn-description-list>
        <sn-description-list slot="detail">
          \${moduleField('Mode', adaptive.mode)}
          \${moduleField('Breakpoint', adaptive.breakpoint)}
          \${moduleField('Collapse order', adaptive.collapseOrder)}
        </sn-description-list>
      \`;
      setHydrationProof(shell, panelType, adaptive);
    }
  }
  if (panelType === 'validation-checklist') {
    let feed = findPanelElement(root, 'sn-event-feed');
    if (feed) {
      feed.setAttribute('title', 'Validation Checklist');
      feed.setEvents?.(validationEvents(stage));
      setHydrationProof(feed, panelType, validationEvents(stage));
    }
  }
  let nodeCanvas = findPanelElement(root, 'node-canvas');
  if (nodeCanvas && data.editorModel) {
    nodeCanvas.setEditorModel?.(data.editorModel);
    nodeCanvas.setAllFlowing?.(true);
    nodeCanvas.setPathStyle?.('pcb');
    setHydrationProof(nodeCanvas, panelType, data.editorModel);
  }
  let canvasGraph = findPanelElement(root, 'canvas-graph');
  if (canvasGraph && data.graphModel) {
    canvasGraph.setGraphModel?.(data.graphModel);
    setHydrationProof(canvasGraph, panelType, data.graphModel);
  }
  let table = findPanelElement(root, 'sn-data-table');
  if (table && data.table) {
    table.setData?.(data.table);
    table.setAttribute('selection-mode', 'single');
    setHydrationProof(table, panelType, data.table);
  }
  let diff = findPanelElement(root, 'sn-source-diff');
  if (diff && data.diff) {
    diff.setDiffData?.(data.diff);
    setHydrationProof(diff, panelType, data.diff);
  }
  let sourceEditor = findPanelElement(root, 'source-editor');
  if (sourceEditor && data.document) {
    sourceEditor.setSourceDocument?.(data.document);
    setHydrationProof(sourceEditor, panelType, data.document);
  }
  let sourceViewer = findPanelElement(root, 'source-viewer');
  if (sourceViewer && data.file) {
    sourceViewer.showFile?.(data.file);
    setHydrationProof(sourceViewer, panelType, data.file);
  }
  let codeBlock = findPanelElement(root, 'code-block');
  if (codeBlock && data.content) {
    codeBlock.setContent?.(data.content, data.language || 'plain');
    setHydrationProof(codeBlock, panelType, data.language, data.content);
  }
  let tree = findPanelElement(root, 'sn-tree-panel');
  if (tree && data.items) {
    tree.setItems?.(data.items);
    tree.showTree?.();
    setHydrationProof(tree, panelType, data.items);
  }
  let eventFeed = findPanelElement(root, 'sn-event-feed');
  if (eventFeed && data.events) {
    eventFeed.setEvents?.(data.events);
    setHydrationProof(eventFeed, panelType, data.events);
  }
  let kanban = findPanelElement(root, 'sn-kanban-board');
  if (kanban && data.board) {
    kanban.setBoard?.(data.board);
    setHydrationProof(kanban, panelType, data.board);
  }
  let richText = findPanelElement(root, 'sn-rich-text-editor');
  if (richText && data.html) {
    richText.value = data.html;
    setHydrationProof(richText, panelType, data.html);
  }
  let videoPlayer = findPanelElement(root, 'sn-video-player');
  if (videoPlayer && data.media) {
    videoPlayer.setAttribute('muted', '');
    videoPlayer.setAttribute('loop', '');
    setHydrationProof(videoPlayer, panelType, data.media);
    let video = videoPlayer.ref?.video || videoPlayer.querySelector?.('video');
    if (video) {
      video.poster = createVideoPosterDataUrl(data.media);
      video.removeAttribute('src');
      video.style.aspectRatio = '16 / 9';
      video.style.minHeight = '100%';
      video.style.objectFit = 'cover';
    }
  }
  let timeline = findPanelElement(root, 'sn-timeline');
  if (timeline && data.tracks) {
    timeline.textContent = '';
    timeline.classList.add('demo-track-timeline');
    for (let track of data.tracks) {
      let row = document.createElement('sn-timeline-item');
      row.setAttribute('title', track.label || '');
      row.setAttribute('time', track.time || '');
      row.setAttribute('variant', track.variant || 'neutral');
      row.innerHTML = \`<div class="demo-timeline-track">\${createTrackClips(track)}</div>\`;
      timeline.appendChild(row);
    }
    setHydrationProof(timeline, panelType, data.tracks);
  } else if (timeline && data.items) {
    timeline.textContent = '';
    timeline.classList.remove('demo-track-timeline');
    for (let item of data.items) {
      let row = document.createElement('sn-timeline-item');
      row.setAttribute('title', item.title || '');
      row.setAttribute('time', item.time || '');
      row.setAttribute('variant', item.variant || 'neutral');
      timeline.appendChild(row);
    }
    setHydrationProof(timeline, panelType, data.items);
  }
  let inspector = findPanelElement(root, 'inspector-panel');
  if (inspector && data.node) {
    inspector.inspect?.({
      ...data.node,
      label: data.node.name || data.node.label || data.node.id,
      inputs: Object.fromEntries((data.node.inputs || []).map((input) => [input.name, { label: input.label, socket: { name: input.type } }])),
      outputs: Object.fromEntries((data.node.outputs || []).map((output) => [output.name, { label: output.label, socket: { name: output.type } }])),
      controls: {
        mode: { label: 'Mode', value: activeScenario()?.topology || 'workspace', type: 'text' },
      },
    });
    setHydrationProof(inspector, panelType, data.node);
  }
}

function defineDemoWorkspaceModules(config) {
  let panelTypes = config?.panelTypes || {};
  for (let tagName of Object.values(panelTypes).map((panel) => panel?.component).filter(Boolean)) {
    if (definedDemoModuleTags.has(tagName) && customElements.get(tagName)) continue;
    if (customElements.get(tagName)) continue;
    try {
      defineModule(tagName, { includeInternal: true, includeExperimental: true });
    } catch (error) {
      throw new Error(\`Required symbiote-ui module "\${tagName}" is not defined: \${error.message}\`);
    }
    if (!customElements.get(tagName)) {
      throw new Error(\`Required symbiote-ui module "\${tagName}" did not register a custom element.\`);
    }
    definedDemoModuleTags.add(tagName);
  }
}

function hydrateDemoModules(root, stage, config = stage.config) {
  let hydratedPanelTypes = new Set(
    config.construction?.plan?.assemblyProgress?.hydratedPanelTypes
      || Object.keys(config.panelTypes || {})
  );
  for (let [panelType, panel] of Object.entries(config.panelTypes || {})) {
    if (!panel.component) continue;
    if (!hydratedPanelTypes.has(panelType)) continue;
    for (let component of root.querySelectorAll(panel.component)) {
      component.demoContext = { panelType, stage };
      hydratePanelContent(component, panelType, stage);
    }
  }
}

function createSymbioteLayoutRuntime(stage) {
  return {
    mountWorkspace({ config, element }) {
      let currentStage = stage;
      defineDemoWorkspaceModules(config);
      let layout = document.createElement('panel-layout');
      layout.className = 'demo-symbiote-layout';
      layout.dataset.runtimeInstanceId = \`layout-\${++layoutInstanceSeq}\`;
      layout.dataset.atomicUpdateCount = '0';
      layout.setAttribute('responsive-mode', config.rootBehavior?.responsiveMode || 'drawer');
      layout.setAttribute('responsive-breakpoint', String(config.rootBehavior?.responsiveBreakpoint || 860));
      layout.setAttribute('swipe-control', config.rootBehavior?.swipeControl || 'edge');
      element.appendChild(layout);
      element.dataset.runtimeInstanceId = layout.dataset.runtimeInstanceId;
      element.dataset.atomicUpdateCount = '0';
      requestAnimationFrame(() => {
        layout.$.panelTypes = config.panelTypes || {};
        layout.$.layoutTree = normalizeLayoutNode(config.layout);
        requestAnimationFrame(() => {
          hydrateDemoModules(layout, currentStage, config);
          applyAdaptiveScenario(currentStage);
        });
      });
      return {
        updateConfig(nextConfig, options = {}) {
          if (nextConfig?.config && !options.stage) {
            options = nextConfig;
            nextConfig = nextConfig.config;
          }
          currentStage = options.stage || currentStage;
          defineDemoWorkspaceModules(nextConfig);
          let updateCount = Number(layout.dataset.atomicUpdateCount || '0') + 1;
          layout.dataset.atomicUpdateCount = String(updateCount);
          layout.dataset.lastUpdateReason = options.reason || 'updateConfig';
          layout.dataset.lastStage = currentStage.id || '';
          element.dataset.runtimeInstanceId = layout.dataset.runtimeInstanceId;
          element.dataset.atomicUpdateCount = String(updateCount);
          element.dataset.lastUpdatedStage = currentStage.id || '';
          layout.setAttribute('responsive-mode', nextConfig.rootBehavior?.responsiveMode || 'drawer');
          layout.setAttribute('responsive-breakpoint', String(nextConfig.rootBehavior?.responsiveBreakpoint || 860));
          layout.setAttribute('swipe-control', nextConfig.rootBehavior?.swipeControl || 'edge');
          layout.$.panelTypes = nextConfig.panelTypes || {};
          layout.$.layoutTree = normalizeLayoutNode(nextConfig.layout);
          requestAnimationFrame(() => {
            hydrateDemoModules(layout, currentStage, nextConfig);
            applyAdaptiveScenario(currentStage);
          });
        },
        destroy() {
          layout.remove();
        },
      };
    },
  };
}

let styles = new CSSStyleSheet();
styles.replaceSync(\`
  :root {
    color-scheme: dark;
    --demo-border: var(--sn-layout-border, var(--sn-outline-color));
    --demo-muted: var(--sn-text-dim);
    --demo-soft: var(--sn-panel-bg);
    --demo-accent: var(--sn-node-selected);
    --demo-pass: hsl(var(--sn-hue-success) var(--sn-theme-chroma) 46%);
    --demo-warn: hsl(var(--sn-hue-warning) var(--sn-theme-chroma) 52%);
  }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--sn-bg);
    color: var(--sn-text);
    font-family: var(--sn-font, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  }
  button {
    font: inherit;
  }
  .demo-shell {
    display: block;
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    --sn-app-topbar-height: 40px;
    --sn-tabs-height: 34px;
    --sn-tabs-bg: transparent;
    --sn-tabs-item-height: 30px;
    --sn-tabs-item-font-size: 12px;
    --sn-layout-header-block-size: 30px;
    --sn-layout-header-button-radius: 4px;
  }
  .demo-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.375rem;
    min-width: 0;
    max-width: min(52vw, 42rem);
  }
  .demo-current-evidence {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }
  .demo-evidence-chip {
    max-width: 7.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-action,
  .demo-operation-chip,
  .demo-viewport-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }
  .demo-action {
    flex: 0 0 auto;
    gap: 0.25rem;
    min-height: 1.625rem;
    min-width: 4.25rem;
    --sn-button-padding: 4px 8px;
    --sn-button-font-size: 11px;
  }
  .demo-action-label {
    max-width: 3.4rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-icon {
    font-family: "Material Symbols Outlined";
    font-size: 1.2rem;
    line-height: 1;
    font-weight: normal;
  }
  .demo-stage-rail {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    flex: 0 1 min(42vw, 38rem);
    min-width: 0;
    padding: 0 0.5rem 0 0.25rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .demo-stage-rail::-webkit-scrollbar {
    display: none;
  }
  .demo-stage-label {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex: 0 0 auto;
    max-width: 12rem;
    min-height: 1.75rem;
    padding: 0 0.5rem;
    border-inline-end: 1px solid color-mix(in srgb, var(--sn-text) 12%, transparent);
    color: var(--demo-muted);
    font-size: 11px;
    line-height: 1;
  }
  .demo-stage-clock {
    color: var(--demo-accent);
    font: 700 10px/1 var(--sn-font);
    white-space: nowrap;
  }
  .demo-stage-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-operation-chip {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--sn-text) 14%, transparent);
    background: color-mix(in srgb, var(--sn-panel-bg) 86%, transparent);
    color: var(--demo-muted);
    cursor: pointer;
    flex: 0 0 auto;
    gap: 0.3125rem;
    max-width: 10.5rem;
    min-height: 1.75rem;
    padding: 0 0.5rem;
    border-radius: var(--sn-layout-header-button-radius, 4px);
    font-size: 11px;
    line-height: 1;
    transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
  }
  .demo-operation-chip span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-operation-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--sn-text) 28%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--sn-text) 12%, transparent);
  }
  .demo-operation-chip[data-operation-status="done"] {
    color: var(--sn-text);
    background: color-mix(in srgb, var(--sn-success-color, var(--sn-node-selected)) 10%, transparent);
  }
  .demo-operation-chip[data-operation-status="done"] .demo-operation-dot {
    background: var(--sn-success-color, var(--sn-node-selected));
  }
  .demo-operation-chip[data-operation-status="active"] {
    border-color: var(--demo-accent);
    color: var(--demo-accent);
    background: color-mix(in srgb, var(--demo-accent) 12%, transparent);
  }
  .demo-operation-chip[data-operation-status="active"] .demo-operation-dot {
    background: var(--demo-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--demo-accent) 18%, transparent);
  }
  .demo-theme-widget {
    flex: 0 0 auto;
  }
  .demo-theme-widget .ctw-trigger {
    min-height: 1.625rem;
    padding-inline: 0.45rem;
  }
  .demo-theme-widget .ctw-trigger-label {
    display: none;
  }
  .demo-shell project-tabs project-tab-item {
    scroll-margin-inline: 2rem;
  }
  .demo-shell project-tabs project-tab-item[aria-current="page"] {
    outline: 1px solid color-mix(in srgb, var(--demo-accent) 48%, transparent);
    outline-offset: -2px;
  }
  .demo-layout-sidebar {
    min-height: 0;
  }
  .demo-viewport-controls {
    flex: 0 0 auto;
    --sn-segmented-padding: 2px 8px;
    --sn-segmented-item-min-height: 1.5rem;
    --sn-segmented-font-size: 11px;
  }
  .demo-viewport-button {
    min-height: 1.5rem;
    font-size: 0.78rem;
  }
  .demo-viewport-button[aria-pressed="true"] {
    background: var(--demo-accent);
    color: white;
  }
  .demo-build-progress {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex: 0 1 8rem;
    min-width: 6.25rem;
    min-height: 1.625rem;
    padding: 0 0.45rem;
    border: 1px solid color-mix(in srgb, var(--sn-text) 12%, transparent);
    border-radius: var(--sn-layout-header-button-radius, 4px);
    background: color-mix(in srgb, var(--sn-panel-bg) 88%, transparent);
  }
  .demo-build-progress span {
    color: var(--demo-muted);
    font-size: 0.72rem;
    line-height: 1.2;
    white-space: nowrap;
  }
  .demo-build-progress i {
    display: block;
    flex: 1 1 auto;
    min-width: 2rem;
    height: 0.4rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, CanvasText 12%, transparent);
  }
  .demo-build-progress i::before {
    content: "";
    display: block;
    width: var(--demo-progress, 0%);
    height: 100%;
    border-radius: inherit;
    background: var(--demo-accent);
    transition: width 240ms ease;
  }
  .demo-workspace {
    display: block;
    width: 100%;
    height: calc(100vh - var(--sn-app-topbar-height) - var(--sn-tabs-height));
    max-height: calc(100vh - var(--sn-app-topbar-height) - var(--sn-tabs-height));
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .symbiote-workspace__panel {
    transition: border-color 180ms ease, transform 180ms ease;
  }
  .symbiote-workspace__panel[data-adaptive-state="collapsed"] {
    display: none;
  }
  .symbiote-workspace__panel[data-adaptive-state="docked"] {
    border-color: var(--demo-accent);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--demo-accent) 42%, transparent);
  }
  .demo-workspace > .symbiote-workspace {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .demo-symbiote-layout {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    --sn-layout-border: color-mix(in srgb, var(--sn-text, CanvasText) 14%, transparent);
    --sn-layout-gap-bg: color-mix(in srgb, var(--sn-bg) 86%, var(--sn-node-selected) 14%);
    --sn-layout-header-block-size: 32px;
  }
  .demo-symbiote-layout .layout-root {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .demo-symbiote-layout .split-view,
  .demo-symbiote-layout .split-first,
  .demo-symbiote-layout .split-second,
  .demo-symbiote-layout .panel-view,
  .demo-symbiote-layout .panel-content {
    min-width: 0;
    min-height: 0;
  }
  .demo-symbiote-layout .panel-view {
    height: 100%;
    overflow: hidden;
  }
  .demo-symbiote-layout .panel-content {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .demo-symbiote-layout layout-node[data-adaptive-state="collapsed"] {
    display: none;
  }
  .demo-symbiote-layout layout-node[data-adaptive-state="docked"] {
    outline: 2px solid var(--sn-node-selected, var(--demo-accent));
    outline-offset: -2px;
  }
  .sn-demo-module {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0.75rem;
    height: 100%;
    min-height: 0;
    padding: 0.75rem;
    box-sizing: border-box;
    background: var(--sn-panel-bg, color-mix(in srgb, Canvas 94%, CanvasText 6%));
    color: var(--sn-text, CanvasText);
    font: 12px/1.35 var(--sn-font, inherit);
    overflow: hidden;
  }
  .sn-demo-module > .demo-chat-workspace,
  .sn-demo-module > .demo-theme-editor {
    min-height: 0;
    height: 100%;
  }
  chat-workspace.chat-workspace-view {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  chat-workspace.demo-chat-workspace {
    --sn-composer-radius: calc(var(--sn-panel-radius, var(--sn-node-radius, 6px)) + 12px);
    --sn-composer-body-padding: 8px 10px;
    --sn-composer-padding: 10px;
    --sn-composer-control-gap: 6px;
    --sn-chat-agent-message-bg: color-mix(in srgb, var(--sn-node-bg) 88%, var(--sn-text) 12%);
  }
  panel-layout.demo-layout-builder-surface {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .demo-library-card,
  .demo-panel-facts,
  .demo-validation-row {
    min-width: 0;
  }
  .demo-validation-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .demo-validation-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .demo-card-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    margin-bottom: 0.625rem;
  }
  .demo-card-title strong {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sn-demo-module header {
    display: flex;
    gap: 0.625rem;
    align-items: center;
    min-width: 0;
  }
  .sn-demo-module header > span {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--sn-radius-md, 8px);
    background: color-mix(in srgb, var(--sn-node-selected, var(--demo-accent)) 16%, transparent);
    color: var(--sn-node-selected, var(--demo-accent));
  }
  .sn-demo-module strong,
  .sn-demo-module span,
  .sn-demo-module p {
    min-width: 0;
  }
  .sn-demo-module-list,
  .sn-demo-module-grid,
  .sn-demo-widget-registry,
  .sn-demo-layout-map {
    min-height: 0;
    overflow: auto;
  }
  .sn-demo-module-list {
    display: grid;
    align-content: start;
    gap: 0.5rem;
  }
  .sn-demo-module-list p {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--sn-node-border, color-mix(in srgb, currentColor 12%, transparent));
    border-radius: var(--sn-radius-md, 8px);
    background: var(--sn-node-bg, color-mix(in srgb, Canvas 96%, CanvasText 4%));
  }
  .sn-demo-module-grid,
  .sn-demo-module-strip {
    display: grid;
    gap: 0.5rem;
  }
  .sn-demo-module-grid span,
  .sn-demo-module-strip span {
    display: grid;
    gap: 0.125rem;
    padding: 0.5rem;
    border-radius: var(--sn-radius-md, 8px);
    background: var(--sn-node-bg, color-mix(in srgb, Canvas 96%, CanvasText 4%));
  }
  .sn-demo-layout-map,
  .sn-demo-widget-registry {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    align-content: start;
    gap: 0.5rem;
  }
  .sn-demo-layout-map sn-card,
  .sn-demo-widget-registry sn-card {
    display: grid;
    gap: 0.25rem;
  }
  .sn-demo-theme-editor {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: start;
    min-height: 0;
  }
  .sn-demo-theme-editor > span {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: hsl(var(--swatch-hue) 70% 52%);
    box-shadow: inset 0 0 0 6px color-mix(in srgb, Canvas 44%, transparent);
  }
  sn-video-player[data-demo-hydrated="preview"],
  sn-video-player[data-demo-hydrated="preview"] .sn-video-container,
  sn-video-player[data-demo-hydrated="preview"] .sn-video-element {
    height: 100%;
  }
  sn-video-player[data-demo-hydrated="preview"] .sn-video-container {
    border-radius: 0;
  }
  sn-video-player[data-demo-hydrated="preview"] .sn-video-controls {
    opacity: 1;
  }
  sn-timeline.demo-track-timeline {
    height: 100%;
    padding: 8px 10px;
    overflow: auto;
    --sn-timeline-item-gap: 10px;
    --sn-timeline-item-padding: 10px;
  }
  sn-timeline.demo-track-timeline sn-timeline-item {
    min-height: 44px;
  }
  .demo-timeline-track {
    position: relative;
    height: 26px;
    min-width: 28rem;
    border-radius: 4px;
    background:
      repeating-linear-gradient(
        to right,
        color-mix(in srgb, var(--sn-text) 9%, transparent) 0 1px,
        transparent 1px 8.33%
      ),
      color-mix(in srgb, var(--sn-bg) 86%, var(--sn-node-selected) 14%);
  }
  .demo-timeline-clip {
    position: absolute;
    left: var(--clip-start);
    width: var(--clip-span);
    top: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    min-width: 3rem;
    overflow: hidden;
    padding: 0 0.5rem;
    border-radius: 3px;
    background: color-mix(in srgb, var(--clip-color) 76%, var(--sn-bg) 24%);
    color: var(--sn-text);
    font-size: 10px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 680px) {
    .demo-actions {
      gap: 0.375rem;
    }
    .demo-action {
      flex: 0 0 auto;
    }
    .demo-stage-rail {
      flex-basis: 10rem;
    }
    .demo-viewport-controls {
      display: none;
    }
    .demo-build-progress {
      min-width: 5rem;
    }
  }
\`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];

let shell = document.createElement('layout-shell-menu');
shell.className = 'demo-shell';
shell.setAttribute('title', demo.name);
shell.setAttribute('title-icon', 'hub');
shell.setAttribute('path-label', 'workspaces / realtime-builder');
shell.innerHTML = \`
  <div class="demo-actions" slot="actions">
    <sn-button class="demo-action" data-action="play" variant="primary" title="Run construction">
      <span class="demo-icon" aria-hidden="true">play_arrow</span>
      <span class="demo-action-label">Play</span>
    </sn-button>
    <div class="demo-build-progress" aria-label="Build progress">
      <span></span>
      <i aria-hidden="true"></i>
    </div>
    <div class="demo-current-evidence" aria-label="Runtime contract evidence">
      <sn-badge class="demo-evidence-chip" data-current-evidence="host-services">Host services</sn-badge>
      <sn-badge class="demo-evidence-chip" data-current-evidence="package-readiness">Package readiness</sn-badge>
      <sn-badge class="demo-evidence-chip" data-current-evidence="runtime-imports">Runtime imports</sn-badge>
    </div>
    <sn-segmented-control class="demo-viewport-controls" role="group" aria-label="Adaptive preview"></sn-segmented-control>
    <cascade-theme-widget class="demo-theme-widget"></cascade-theme-widget>
  </div>
  <div class="demo-stage-rail" slot="tab-actions" role="tablist" aria-label="Demo stages"></div>
  <layout-sidebar class="demo-layout-sidebar" slot="sidebar" collapsed></layout-sidebar>
  <div class="demo-workspace" aria-label="Generated workspace"></div>
\`;
document.body.appendChild(shell);

let playButton = shell.querySelector('[data-action="play"]');
let buildProgress = shell.querySelector('.demo-build-progress');
let viewportControls = shell.querySelector('.demo-viewport-controls');
let stageRail = shell.querySelector('.demo-stage-rail');
let layoutSidebar = shell.querySelector('.demo-layout-sidebar');
let workspace = shell.querySelector('.demo-workspace');
let playbackActive = false;
let sidebarActiveByScenario = {};

requestAnimationFrame(() => {
  layoutSidebar?.setAttribute('collapsed', '');
  if (layoutSidebar?.$) layoutSidebar.$.collapsed = true;
});

function scenarioIcon(scenarioId) {
  return {
    'video-editing': 'movie',
    'automation-editing': 'hub',
    'agent-programming': 'code',
    'constructor-control': 'dashboard_customize',
  }[scenarioId] || 'dashboard';
}

function scenarioAccent(scenarioId) {
  return {
    'video-editing': 'var(--sn-node-selected)',
    'automation-editing': 'var(--sn-info-color, #2e90fa)',
    'agent-programming': 'var(--sn-success-color, #4caf50)',
    'constructor-control': 'var(--sn-warning-color, #ff9800)',
  }[scenarioId] || 'var(--sn-node-selected)';
}

function scenarioPanelOrder(scenario = activeScenario()) {
  return Object.keys(scenario?.config?.panelTypes || {});
}

function scenarioSidebarSections(scenario = activeScenario()) {
  let panelTypes = scenario?.config?.panelTypes || {};
  let visiblePanelTypes = new Set(visibleScenarioPanelTypes(scenario));
  return Object.entries(panelTypes).map(([panelType, panelConfig]) => ({
    id: \`\${scenario.id}:\${panelType}\`,
    icon: panelConfig.icon || 'web_asset',
    label: panelConfig.title || panelType,
    disabled: !visiblePanelTypes.has(panelType),
    buildStatus: visiblePanelTypes.has(panelType) ? 'mounted' : 'pending',
  }));
}

function defaultSidebarSectionId(scenario = activeScenario()) {
  return scenarioSidebarSections(scenario).find((section) => !section.disabled)?.id || '';
}

function syncScenarioSidebar() {
  let scenario = activeScenario();
  if (!scenario || !layoutSidebar) return;
  let sections = scenarioSidebarSections(scenario);
  let activeSection = sidebarActiveByScenario[scenario.id] || defaultSidebarSectionId(scenario);
  if (!sections.some((section) => section.id === activeSection && !section.disabled)) {
    activeSection = defaultSidebarSectionId(scenario);
  }
  layoutSidebar.routerSync = false;
  layoutSidebar.setSections?.(sections);
  layoutSidebar.setActiveSection?.(activeSection);
  layoutSidebar.dataset.contextScenarioId = scenario.id;
  layoutSidebar.dataset.sectionIds = sections.map((section) => section.id).join(',');
  layoutSidebar.dataset.mountedSectionIds = sections
    .filter((section) => !section.disabled)
    .map((section) => section.id)
    .join(',');
  layoutSidebar.dataset.pendingSectionIds = sections
    .filter((section) => section.disabled)
    .map((section) => section.id)
    .join(',');
  shell.dataset.activeSidebarSection = activeSection;
}

function professionalLayoutGroups() {
  return [
    {
      id: 'home',
      name: 'Overview',
      icon: 'home',
      tabsVisible: false,
      sidebarVisible: false,
    },
    ...(demo.professionalScenarios || []).map((scenario) => ({
      id: scenario.id,
      name: scenario.title.replace(' Workspace', ''),
      icon: scenarioIcon(scenario.id),
      color: scenarioAccent(scenario.id),
      tabsVisible: true,
      sidebarVisible: false,
    })),
  ];
}

function updateShellHeader(title, pathLabel) {
  shell.setAttribute('title', title);
  shell.setAttribute('path-label', pathLabel);
  if (shell.$) {
    shell.$.title = title;
    shell.$.pathLabel = pathLabel;
  }
}

function decorateScenarioTabs() {
  for (let tab of shell.querySelectorAll('project-tab-item')) {
    let id = tab.$?.id || '';
    if (!id) continue;
    tab.dataset.scenarioTabId = id;
    tab.setAttribute('aria-current', id === activeScenarioId ? 'page' : 'false');
  }
}

shell.addEventListener('layout-group-change', (event) => {
  let scenarioId = event.detail?.id;
  if (!demo.professionalScenarios?.some((scenario) => scenario.id === scenarioId)) return;
  if (scenarioId === activeScenarioId) return;
  stopPlayback();
  activeScenarioId = scenarioId;
  sidebarActiveByScenario[activeScenarioId] = defaultSidebarSectionId(activeScenario());
  operationIndex = Math.min(operationIndex, buildOperations(demo.stages[stageIndex]).length - 1);
  renderStage(stageIndex);
});

layoutSidebar.addEventListener('sidebar-section-select', (event) => {
  let id = event.detail?.id || event.detail?.sectionId || '';
  if (!id.startsWith(\`\${activeScenarioId}:\`)) return;
  event.preventDefault?.();
  sidebarActiveByScenario[activeScenarioId] = id;
  layoutSidebar.setActiveSection?.(id);
  shell.dataset.activeSidebarSection = id;
  let panelType = id.slice(activeScenarioId.length + 1);
  if (!visibleScenarioPanelTypes(activeScenario()).includes(panelType)) return;
  workspace.querySelector('panel-layout')?.openPanel?.(panelType, {
    uiInvoked: true,
    source: 'layout-sidebar',
  });
});

shell.addEventListener('cascade-theme-open-full', (event) => {
  event.preventDefault?.();
  let layout = workspace.querySelector('panel-layout');
  shell.dataset.themeEditorOpenRequest = 'theme-editor';
  shell.dataset.themeEditorOpenSource = 'cascade-theme-widget';
  layout?.openPanel?.('theme-editor', {
    uiInvoked: true,
    source: 'cascade-theme-widget',
  });
});

function buildProgressPercent(index) {
  let total = demo.stages.reduce((sum, stage) => sum + buildOperations(stage).length, 0);
  let previous = demo.stages
    .slice(0, index)
    .reduce((sum, stage) => sum + buildOperations(stage).length, 0);
  return Math.round(((previous + operationIndex + 1) / total) * 100);
}

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function currentBuildStep(stage = demo.stages[stageIndex]) {
  let stagePosition = Math.max(0, demo.stages.findIndex((item) => item.id === stage?.id));
  let previous = demo.stages
    .slice(0, stagePosition)
    .reduce((sum, item) => sum + buildOperations(item).length, 0);
  return previous + operationIndex + 1;
}

function totalBuildSteps() {
  return demo.stages.reduce((sum, stage) => sum + buildOperations(stage).length, 0);
}

function buildPhaseState(stage = demo.stages[stageIndex]) {
  let step = currentBuildStep(stage);
  let total = totalBuildSteps();
  let layoutEnd = Math.max(1, Math.round(total * 0.33));
  let modulesEnd = Math.max(layoutEnd + 1, Math.round(total * 0.67));
  let dataEnd = Math.max(modulesEnd + 1, Math.round(total * 0.78));
  if (step <= layoutEnd) {
    return {
      phase: 'layout',
      step,
      totalSteps: total,
      phaseProgress: step / layoutEnd,
    };
  }
  if (step <= modulesEnd) {
    return {
      phase: 'modules',
      step,
      totalSteps: total,
      phaseProgress: (step - layoutEnd) / (modulesEnd - layoutEnd),
    };
  }
  if (step <= dataEnd) {
    return {
      phase: 'data',
      step,
      totalSteps: total,
      phaseProgress: (step - modulesEnd) / (dataEnd - modulesEnd),
    };
  }
  return {
    phase: 'theme',
    step,
    totalSteps: total,
    phaseProgress: (step - dataEnd) / (total - dataEnd),
  };
}

function progressivePanelSubset(panelOrder, progress, options = {}) {
  if (panelOrder.length === 0) return [];
  let minimum = options.minimum ?? 1;
  let count = Math.max(minimum, Math.ceil(progress * panelOrder.length));
  return panelOrder.slice(0, Math.min(panelOrder.length, count));
}

function visibleScenarioPanelTypes(scenario = activeScenario(), stage = demo.stages[stageIndex]) {
  let panelOrder = scenarioPanelOrder(scenario);
  if (panelOrder.length === 0) return [];
  return panelOrder;
}

function mountedScenarioPanelTypes(scenario = activeScenario(), stage = demo.stages[stageIndex]) {
  let panelOrder = scenarioPanelOrder(scenario);
  if (panelOrder.length === 0) return [];
  let phase = buildPhaseState(stage);
  if (phase.phase === 'layout') return [];
  if (phase.phase === 'modules') {
    return progressivePanelSubset(panelOrder, phase.phaseProgress);
  }
  return panelOrder;
}

function hydratedScenarioPanelTypes(scenario = activeScenario(), stage = demo.stages[stageIndex]) {
  let panelOrder = scenarioPanelOrder(scenario);
  if (panelOrder.length === 0) return [];
  let phase = buildPhaseState(stage);
  if (phase.phase === 'data') {
    return progressivePanelSubset(panelOrder, phase.phaseProgress);
  }
  if (phase.phase === 'theme') return panelOrder;
  return [];
}

function pruneLayoutNode(node, visiblePanelTypes) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'panel') {
    return visiblePanelTypes.has(node.panelType) ? cloneConfig(node) : null;
  }
  if (node.type === 'split') {
    let first = pruneLayoutNode(node.first, visiblePanelTypes);
    let second = pruneLayoutNode(node.second, visiblePanelTypes);
    if (first && second) {
      return {
        ...cloneConfig(node),
        first,
        second,
      };
    }
    return first || second;
  }
  return cloneConfig(node);
}

function filterPanelMap(panelTypes, visiblePanelTypes) {
  return Object.fromEntries(
    Object.entries(panelTypes || {}).filter(([panelType]) => visiblePanelTypes.has(panelType))
  );
}

function filterScenarioModules(modules, visiblePanelTypes) {
  return (modules || []).filter((item) => visiblePanelTypes.has(
    item?.placement?.panelType || item?.panelType
  ));
}

function filterRegions(regions, visiblePanelTypes) {
  return Object.fromEntries(
    Object.entries(regions || {})
      .map(([region, panels]) => [
        region,
        (panels || []).filter((panelType) => visiblePanelTypes.has(panelType)),
      ])
      .filter(([, panels]) => panels.length > 0)
  );
}

function filterPanelLinks(items, visiblePanelTypes) {
  return (items || []).filter((item) => (
    (!item.panelType || visiblePanelTypes.has(item.panelType)) &&
    (!item.sourcePanel || visiblePanelTypes.has(item.sourcePanel)) &&
    (!item.targetPanel || visiblePanelTypes.has(item.targetPanel))
  ));
}

function progressiveScenarioConfig(scenario = activeScenario(), stage = demo.stages[stageIndex]) {
  let config = cloneConfig(scenario?.config || stage.config);
  let visiblePanelList = visibleScenarioPanelTypes(scenario, stage);
  let visiblePanelTypes = new Set(visiblePanelList);
  let mountedPanelList = mountedScenarioPanelTypes(scenario, stage);
  let mountedPanelTypes = new Set(mountedPanelList);
  let hydratedPanelList = hydratedScenarioPanelTypes(scenario, stage);
  let phase = buildPhaseState(stage);
  let plannedPanelTypes = scenarioPanelOrder(scenario);
  config.panelTypes = filterPanelMap(config.panelTypes, visiblePanelTypes);
  for (let [panelType, panelConfig] of Object.entries(config.panelTypes)) {
    if (mountedPanelTypes.has(panelType)) continue;
    config.panelTypes[panelType] = {
      ...panelConfig,
      component: 'sn-empty-state',
      properties: {
        ...(panelConfig.properties || {}),
        textContent: \`\${panelConfig.title || panelType} layout slot\`,
      },
    };
  }
  if (Array.isArray(config.modules)) {
    config.modules = filterScenarioModules(config.modules, mountedPanelTypes);
  }
  let componentModules = filterScenarioModules(config.components?.modules, mountedPanelTypes);
  let componentCatalog = componentModules.map((item) => item.tagName).filter(Boolean);
  if (mountedPanelList.length < visiblePanelList.length) {
    componentCatalog.push('sn-empty-state');
  }
  config.components = {
    ...(config.components || {}),
    catalog: [...new Set(componentCatalog)],
    modules: componentModules,
  };
  config.data = {
    ...(config.data || {}),
    bindings: filterPanelLinks(config.data?.bindings, mountedPanelTypes),
  };
  config.events = filterPanelLinks(config.events, mountedPanelTypes);
  if (phase.phase !== 'theme') {
    config.theme = {
      ...(config.theme || {}),
      params: { ...CASCADE_THEME_DEFAULTS },
    };
  }
  config.layout = pruneLayoutNode(config.layout, visiblePanelTypes) || {
    type: 'panel',
    panelType: visiblePanelList[0],
  };
  config.construction = {
    ...(config.construction || {}),
    plan: {
      ...(config.construction?.plan || {}),
      modules: filterScenarioModules(config.construction?.plan?.modules, mountedPanelTypes),
      bindings: filterPanelLinks(config.construction?.plan?.bindings, mountedPanelTypes),
      layout: {
        ...(config.construction?.plan?.layout || {}),
        regions: filterRegions(config.construction?.plan?.layout?.regions, visiblePanelTypes),
      },
      assemblyProgress: {
        phase: phase.phase,
        stageId: stage.id,
        operationIndex,
        step: phase.step,
        totalSteps: phase.totalSteps,
        phaseProgress: phase.phaseProgress,
        visiblePanelTypes: visiblePanelList,
        mountedPanelTypes: mountedPanelList,
        hydratedPanelTypes: hydratedPanelList,
        plannedPanelTypes,
      },
    },
  };
  return config;
}

function buildOperations(stage) {
  let chatState = stage.chatState || {};
  let required = chatState.requiredElements || [];
  let roles = Object.keys(chatState.layoutRoles || {});
  let adaptive = chatState.adaptiveBehavior?.collapseOrder || [];
  let latestDecision = chatState.decisionTrace?.at(-1);
  return [
    {
      label: 'Read chat state',
      value: chatState.questionnaireStatus || stage.activeQuestionId,
      status: 'done',
    },
    {
      label: 'Apply workspace patch',
      value: latestDecision
        ? \`\${latestDecision.questionId}: \${latestDecision.operations.join(' -> ')}\`
        : chatState.nextPatch || 'Waiting for next questionnaire answer.',
      status: 'active',
    },
    {
      label: 'Resolve required UI',
      value: required.length ? required.join(', ') : 'Intent panels only',
      status: required.length >= 4 ? 'done' : 'active',
    },
    {
      label: 'Rank layout behavior',
      value: roles.length
        ? \`\${roles.length} roles, collapse: \${adaptive.join(' -> ') || 'pending'}\`
        : 'Waiting for layout roles',
      status: adaptive.length >= 3 ? 'done' : 'active',
    },
  ];
}

function adaptiveScenario(stage) {
  let scenarios = stage.chatState?.adaptiveScenarios || [];
  return scenarios.find((item) => item.mode === viewportMode) || scenarios[0] || null;
}

function renderViewportControls(stage) {
  let scenarios = stage.chatState?.adaptiveScenarios || [];
  viewportControls.textContent = '';
  viewportControls.value = viewportMode;
  for (let scenario of scenarios) {
    let button = document.createElement('sn-button');
    button.className = 'demo-viewport-button';
    button.setAttribute('value', scenario.mode);
    button.dataset.viewportMode = scenario.mode;
    button.textContent = scenario.mode;
    button.setAttribute('aria-pressed', String(scenario.mode === viewportMode));
    button.addEventListener('click', () => {
      viewportMode = scenario.mode;
      renderStage(stageIndex);
    });
    viewportControls.appendChild(button);
  }
}

function renderScenarioRail() {
  shell.setGroups?.(professionalLayoutGroups(), activeScenarioId);
  shell.dataset.scenarioNavigation = 'layout-shell-menu';
  decorateScenarioTabs();
  syncScenarioSidebar();
  requestAnimationFrame(decorateScenarioTabs);
  requestAnimationFrame(syncScenarioSidebar);
}

function renderStageRail() {
  stageRail.textContent = '';
  let stage = demo.stages[stageIndex];
  let operations = buildOperations(stage);
  let label = document.createElement('span');
  label.className = 'demo-stage-label';
  label.setAttribute('role', 'status');
  label.innerHTML = \`
    <span class="demo-stage-clock">\${escapeHtml(stage.clock)}</span>
    <span class="demo-stage-title">\${escapeHtml(stage.title)}</span>
  \`;
  stageRail.appendChild(label);
  operations.forEach((operation, index) => {
    let status = index < operationIndex
      ? 'done'
      : index === operationIndex
        ? operation.status || 'active'
        : 'pending';
    let button = document.createElement('button');
    button.className = 'demo-operation-chip';
    button.type = 'button';
    button.dataset.operationStatus = status;
    button.dataset.operationLabel = operation.label;
    button.title = operation.value || operation.label;
    button.setAttribute('aria-current', index === operationIndex ? 'step' : 'false');
    button.innerHTML = \`
      <span class="demo-operation-dot" aria-hidden="true"></span>
      <span>\${escapeHtml(operation.label)}</span>
    \`;
    button.addEventListener('click', () => {
      stopPlayback();
      operationIndex = index;
      renderStage(stageIndex);
    });
    stageRail.appendChild(button);
  });
}

function renderWorkspace(stage) {
  let scenario = activeScenario();
  let config = scenario ? progressiveScenarioConfig(scenario, stage) : stage.config;
  let panelTypes = Object.keys(config.panelTypes || {});
  let assembly = config.construction?.plan?.assemblyProgress || {};
  workspace.dataset.buildPanelTypes = panelTypes.join(',');
  workspace.dataset.visiblePanelCount = String(panelTypes.length);
  workspace.dataset.plannedPanelTypes = scenarioPanelOrder(scenario).join(',');
  workspace.dataset.plannedPanelCount = String(scenarioPanelOrder(scenario).length);
  workspace.dataset.assemblyPhase = assembly.phase || '';
  workspace.dataset.mountedPanelTypes = (assembly.mountedPanelTypes || []).join(',');
  workspace.dataset.mountedPanelCount = String((assembly.mountedPanelTypes || []).length);
  workspace.dataset.hydratedPanelTypes = (assembly.hydratedPanelTypes || []).join(',');
  workspace.dataset.hydratedPanelCount = String((assembly.hydratedPanelTypes || []).length);
  if (mounted) {
    mounted.updateConfig(config, {
      stage,
      reason: scenario ? \`professional-scenario:\${scenario.id}:progressive\` : 'realtime-stage',
    });
    applyAdaptiveScenario(stage);
    return;
  }
  mounted = mountWorkspace(config, workspace, {
    runtimeController: createSymbioteLayoutRuntime(stage),
    themeAdapter: { applyCascadeTheme, applyCascadeGeometryRegister },
    strictComponents: false,
  });
  applyAdaptiveScenario(stage);
}

function recordThemeTransitionEvidence(stage) {
  if (
    !playbackActive ||
    !['theme-mode', 'theme-hue'].includes(stage.id) ||
    shell.dataset.themeTransitionChanged === 'true'
  ) {
    return;
  }
  let readComputedHue = () => (
    getComputedStyle(mounted?.element || workspace)
      .getPropertyValue('--sn-hue-accent')
      .trim()
  );
  let before = { ...(mounted?.config?.theme?.params || {}) };
  let beforeComputedHue = readComputedHue();
  let beforeHue = Number(before.hue || 220);
  let nextHue = beforeHue === 180 ? 96 : 180;
  mounted?.element?.dispatchEvent?.(new CustomEvent('cascade-theme-change', {
    bubbles: true,
    detail: {
      state: {
        mode: before.mode || 'dark',
        hue: nextHue,
      },
      targetSelector: null,
    },
  }));
  let after = mounted?.config?.theme?.params || {};
  let afterComputedHue = readComputedHue();
  let layout = workspace.querySelector('panel-layout');
  let updateCount = layout?.dataset.atomicUpdateCount
    || mounted?.element?.dataset.atomicUpdateCount
    || '0';
  shell.dataset.themeTransitionStage = stage.id;
  shell.dataset.themeTransitionSource = 'cascade-theme-change';
  shell.dataset.themeTransitionFromMode = String(before.mode || '');
  shell.dataset.themeTransitionToMode = String(after.mode || '');
  shell.dataset.themeTransitionFromHue = String(before.hue || '');
  shell.dataset.themeTransitionToHue = String(after.hue || '');
  shell.dataset.themeTransitionChanged = String(
    before.mode !== after.mode || Number(before.hue) !== Number(after.hue)
  );
  shell.dataset.themeTransitionFromComputedHue = beforeComputedHue;
  shell.dataset.themeTransitionToComputedHue = afterComputedHue;
  shell.dataset.themeTransitionComputedChanged = String(
    Boolean(beforeComputedHue && afterComputedHue && beforeComputedHue !== afterComputedHue)
  );
  shell.dataset.themeTransitionUpdateCount = String(updateCount);
}

function applyAdaptiveScenario(stage) {
  let scenario = adaptiveScenario(stage);
  if (!scenario) return;
  let collapsed = new Set(scenario.collapsedPanels);
  let docked = new Set(scenario.dockedPanels);
  let visible = new Set();
  for (let panel of workspace.querySelectorAll('[data-panel-type], layout-node[node-type="panel"]')) {
    let panelType = panel.dataset.panelType;
    if (!panelType && panel.$?.panelType) panelType = panel.$.panelType;
    let state = collapsed.has(panelType) ? 'collapsed' : docked.has(panelType) ? 'docked' : 'visible';
    panel.dataset.adaptiveState = state;
    if (state !== 'collapsed' && panelType) visible.add(panelType);
  }
  workspace.dataset.visiblePanels = [...visible].join(',');
  workspace.dataset.collapsedPanels = scenario.collapsedPanels.join(',');
  workspace.dataset.dockedPanels = scenario.dockedPanels.join(',');
}

function renderStage(index) {
  stageIndex = index;
  let stage = demo.stages[stageIndex];
  let responsiveScenario = adaptiveScenario(stage);
  let professionalScenario = activeScenario();
  let adaptive = stage.chatState?.adaptiveBehavior || {};
  let theme = stage.chatState?.themeCascade || {};
  let current = stage.chatState?.currentFunctionality || {};
  let currentExecution = current.executionEvidence || {};
  let currentPackage = current.packageEvidence?.readiness || current.packageReadiness || {};
  let currentRuntimeImports = current.runtimeImportContract || {};
  let currentHostServices = currentExecution.requiredHostServices || current.hostServices || [];
  let packageStatus = currentPackage.strictExport && currentPackage.strictImport ? 'pass' : 'fail';
  let progress = buildProgressPercent(stageIndex);
  let activeOperation = buildOperations(stage)[operationIndex];
  let phase = buildPhaseState(stage);
  let visibleScenarioPanels = professionalScenario
    ? visibleScenarioPanelTypes(professionalScenario, stage)
    : [];
  let mountedScenarioPanels = professionalScenario
    ? mountedScenarioPanelTypes(professionalScenario, stage)
    : [];
  let hydratedScenarioPanels = professionalScenario
    ? hydratedScenarioPanelTypes(professionalScenario, stage)
    : [];
  let plannedScenarioPanels = scenarioPanelOrder(professionalScenario);
  shell.dataset.stage = stage.id;
  shell.dataset.buildKind = activeOperation?.label.toLowerCase().replaceAll(' ', '-') || 'stage';
  shell.dataset.assemblyPhase = phase.phase;
  shell.dataset.assemblyPhaseProgress = String(Math.round(phase.phaseProgress * 100));
  shell.dataset.executionModel = currentExecution.model || current.executionModel || '';
  shell.dataset.hostServices = currentHostServices.join(',');
  shell.dataset.packageReadiness = packageStatus;
  shell.dataset.adaptiveMode = adaptive.mode || '';
  shell.dataset.adaptiveBreakpoint = String(adaptive.breakpoint || stage.config.rootBehavior?.responsiveBreakpoint || '');
  shell.dataset.themeMode = theme.mode || stage.config.theme?.params?.mode || '';
  shell.dataset.themeEditorState = theme.status || '';
  shell.dataset.scenarioId = professionalScenario?.id || '';
  shell.dataset.scenarioTemplate = professionalScenario?.sourceTemplate || '';
  shell.dataset.visibleScenarioPanels = visibleScenarioPanels.join(',');
  shell.dataset.visibleScenarioPanelCount = String(visibleScenarioPanels.length);
  shell.dataset.mountedScenarioPanels = mountedScenarioPanels.join(',');
  shell.dataset.mountedScenarioPanelCount = String(mountedScenarioPanels.length);
  shell.dataset.hydratedScenarioPanels = hydratedScenarioPanels.join(',');
  shell.dataset.hydratedScenarioPanelCount = String(hydratedScenarioPanels.length);
  shell.dataset.plannedScenarioPanels = plannedScenarioPanels.join(',');
  shell.dataset.plannedScenarioPanelCount = String(plannedScenarioPanels.length);
  shell.dataset.uiAssemblyStep = String(currentBuildStep(stage));
  shell.dataset.uiAssemblyTotal = String(totalBuildSteps());
  shell.dataset.viewportMode = responsiveScenario?.mode || viewportMode;
  shell.dataset.collapsedPanels = responsiveScenario?.collapsedPanels.join(',') || '';
  shell.dataset.dockedPanels = responsiveScenario?.dockedPanels.join(',') || '';
  workspace.dataset.viewportMode = responsiveScenario?.mode || viewportMode;
  workspace.dataset.professionalScenario = professionalScenario?.id || '';
  updateShellHeader(
    professionalScenario?.title || demo.name,
    professionalScenario
      ? \`workspaces / \${professionalScenario.sourceTemplate} / \${stage.title}\`
      : \`workspaces / realtime-builder / \${stage.title}\`
  );
  buildProgress.querySelector('span').textContent = \`Build \${progress}%\`;
  buildProgress.style.setProperty('--demo-progress', \`\${progress}%\`);
  shell.querySelector('[data-current-evidence="host-services"]').textContent =
    \`Host services \${currentHostServices.length}\`;
  let packageEvidence = shell.querySelector('[data-current-evidence="package-readiness"]');
  packageEvidence.textContent = \`Package readiness \${packageStatus}\`;
  packageEvidence.dataset.packageReadiness = packageStatus;
  shell.querySelector('[data-current-evidence="runtime-imports"]').textContent =
    \`Runtime imports \${(currentRuntimeImports.importMapKeys || []).length}\`;
  renderScenarioRail();
  renderViewportControls(stage);
  renderStageRail();
  renderWorkspace(stage);
  recordThemeTransitionEvidence(stage);
}

function stopPlayback() {
  if (!playTimer) return;
  clearInterval(playTimer);
  playTimer = null;
  playbackActive = false;
  playButton.querySelector('.demo-icon').textContent = 'play_arrow';
  playButton.querySelector('.demo-action-label').textContent = 'Play';
}

function startPlayback() {
  stopPlayback();
  playButton.querySelector('.demo-icon').textContent = 'pause';
  playButton.querySelector('.demo-action-label').textContent = 'Playing';
  operationIndex = 0;
  playbackActive = true;
  renderStage(0);
  playTimer = setInterval(() => {
    let operations = buildOperations(demo.stages[stageIndex]);
    if (operationIndex < operations.length - 1) {
      operationIndex += 1;
      renderStage(stageIndex);
      return;
    }
    if (stageIndex >= demo.stages.length - 1) {
      stopPlayback();
      return;
    }
    operationIndex = 0;
    renderStage(stageIndex + 1);
  }, 620);
}

playButton.addEventListener('click', () => {
  if (playTimer) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

operationIndex = 0;
renderStage(0);
`;
}

export async function writeRealtimeChatStateDemo(options = {}) {
  let outputDir = resolve(options.outputDir || join(process.cwd(), 'tmp', 'realtime-builder-demo'));
  let port = Number(options.port || 4567);
  let imports = {
    'symbiote-workspace/browser': '/__workspace__/browser.js',
    [BROWSER_THEME_IMPORT]: '/__symbiote_ui__/ui/index.js',
    'symbiote-ui/board': '/__symbiote_ui__/board/index.js',
    'symbiote-ui/': '/__symbiote_ui__/',
    [BROWSER_ENGINE_IMPORT]: '/__symbiote_engine__/index.js',
    [BROWSER_ENGINE_CONTRACTS_IMPORT]: '/__symbiote_engine__/contracts/index.js',
    'symbiote-engine/': '/__symbiote_engine__/',
    '@symbiotejs/symbiote': '/__symbiote__/core/index.js',
    '@symbiotejs/symbiote/': '/__symbiote__/',
  };
  let demo = buildRealtimeChatStateDemo();
  let finalStage = demo.stages.at(-1);
  let finalExport = exportConfig(finalStage.config, { strict: true });

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'index.html'), generateIndexHtml(demo.name, imports));
  await writeFile(join(outputDir, 'app.js'), generateAppJs(demo));
  await writeFile(join(outputDir, 'mock-states.json'), JSON.stringify(demo, null, 2));
  await writeFile(join(outputDir, 'workspace.config.json'), finalExport.json);
  await writeFile(join(outputDir, 'demo.contract.json'), JSON.stringify({
    schemaVersion: demo.schemaVersion,
	    name: demo.name,
	    acceptanceMatrix: demo.acceptanceMatrix,
	    defaultScenarioId: demo.defaultScenarioId,
	    professionalComponentContract: demo.professionalComponentContract,
	    professionalScenarios: demo.professionalScenarios.map((scenario) => ({
	      id: scenario.id,
	      title: scenario.title,
	      sourceTemplate: scenario.sourceTemplate,
	      topology: scenario.topology,
	      components: Object.values(scenario.config.panelTypes || {}).map((panel) => panel.component),
	      panelTypes: Object.keys(scenario.config.panelTypes || {}),
	      acceptance: scenario.acceptance,
	    })),
	    playStages: demo.stages.map((stage) => stage.id),
    requiredWidgets: demo.requiredWidgets,
    constructionTrace: demo.constructionTrace,
    currentFunctionality: demo.constructionTrace.currentFunctionality,
    executionEvidence: demo.constructionTrace.executionEvidence,
    packageEvidence: demo.constructionTrace.packageEvidence,
    buildStreamTimeline: demo.stages.map((stage, index) => ({
      stage: stage.id,
      progress: progressPercent(index, demo.stages.length),
      operations: buildStreamOperations(stage),
    })),
    chatStateTimeline: demo.stages.map((stage) => ({
      stage: stage.id,
      activeQuestionId: stage.chatState.activeQuestionId,
      questionnaireStatus: stage.chatState.questionnaireStatus,
      requiredElements: stage.chatState.requiredElements,
      adaptiveScenarios: stage.chatState.adaptiveScenarios,
      decisionTrace: stage.chatState.decisionTrace,
      currentFunctionality: stage.chatState.currentFunctionality,
      nextPatch: stage.chatState.nextPatch,
    })),
    imports,
  }, null, 2));

  return {
    status: 'ok',
    url: `http://localhost:${port}/`,
    outputDir,
    stages: demo.stages.length,
    requiredWidgets: demo.requiredWidgets.length,
  };
}
