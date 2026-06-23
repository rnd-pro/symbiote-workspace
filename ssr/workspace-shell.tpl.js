/**
 * Build-time SSR template for the workspace shell chrome.
 *
 * This is host-neutral shell chrome only: a workspace topbar (title plus an empty
 * `cascade-theme-widget` mount) and an EMPTY stage host. The panel-layout and
 * workspace content are NOT server-rendered — they are mounted client-side into
 * `[data-workspace-host]` to avoid double-rendering. The `cascade-theme-widget` is
 * left as an empty mount because it is data-driven and renders on the client.
 */
export default /* html */ `
<header class="workspace-topbar">
  <div class="workspace-topbar-left">
    <span class="workspace-title">Symbiote Workspace</span>
  </div>
  <div class="workspace-topbar-right">
    <cascade-theme-widget></cascade-theme-widget>
  </div>
</header>
<div id="workspace-stage" class="workspace-stage" data-workspace-host></div>
`;
