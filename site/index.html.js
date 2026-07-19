import { renderPage } from 'library-pages/shell';
import { buildSearchIndex } from 'library-pages/search';
import { composeSiteConfig, docsRoutes, resolvePath } from './site.config.js';

const landingStyles = /*css*/ `
.hero {
  min-height: 550px;
  padding: clamp(4.5rem, 11vw, 7.7rem) 0 clamp(5.5rem, 11vw, 8rem);
}
.hero-title {
  max-width: 620px;
  margin: 0 0 1.55rem;
  color: var(--ink);
  font-size: clamp(3rem, 6.6vw, 5rem);
  line-height: 1.03;
  letter-spacing: -0.055em;
  font-weight: 700;
}
.hero-lead {
  max-width: 640px;
  margin: 0 0 2.35rem;
  color: var(--muted);
  font-size: clamp(1.1rem, 2vw, 1.38rem);
  line-height: 1.55;
}
.hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0 1.25rem;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}
.btn-primary { border: 1px solid var(--brand); background: var(--brand); color: var(--page); }
.btn-primary:hover { border-color: var(--brand-strong); background: var(--brand-strong); color: var(--page); }
.btn-secondary { border: 1px solid var(--line); background: transparent; color: var(--ink); }
.btn-secondary:hover { border-color: var(--line-strong); background: var(--surface-soft); }

.narrative-section { padding: 0 0 5rem; }
.narrative-intro { max-width: 720px; margin: 0 auto 4.5rem; text-align: center; }
.narrative-eyebrow {
  display: inline-flex;
  margin: 0 auto 1.8rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid var(--brand);
  border-radius: 999px;
  color: var(--brand);
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.narrative-title {
  margin: 0 0 1rem;
  color: var(--ink);
  font-size: clamp(2.1rem, 4.2vw, 3.15rem);
  line-height: 1.08;
  letter-spacing: -0.04em;
}
.narrative-lead { max-width: 640px; margin: 0 auto; color: var(--muted); font-size: 1.04rem; }
.narrative-illustration { display: none; }
.chapter-row {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(2rem, 6vw, 4.5rem);
  margin: 0 0 6.5rem;
}
.chapter-row:nth-of-type(even) { grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr); }
.chapter-row:nth-of-type(even) .chapter-text { order: 2; }
.chapter-num, .ill-header { display: block; color: var(--brand); font-size: 0.75rem; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; }
.chapter-num { margin-bottom: 0.7rem; }
.chapter-title { margin: 0 0 0.75rem; color: var(--ink); font-size: clamp(1.55rem, 3vw, 2rem); line-height: 1.15; letter-spacing: -0.035em; }
.chapter-desc { max-width: 32rem; margin: 0; color: var(--muted); font-size: 1rem; }
.chapter-visual { min-width: 0; }
.motion-surface {
  position: relative;
  min-height: 240px;
  overflow: hidden;
  background: transparent;
  color: var(--brand);
}
.motion-surface svg { display: block; width: 100%; height: 100%; min-height: 240px; }
.motion-surface .line { stroke: currentColor; stroke-width: 1.5; fill: none; opacity: 0.65; }
.motion-surface .soft { fill: var(--brand-soft); stroke: currentColor; stroke-width: 1.2; }
.motion-surface .dot { fill: currentColor; }
.motion-surface .muted { stroke: var(--line-strong); stroke-width: 1.2; fill: none; }
.motion-surface .motion-dash { stroke-dasharray: 5 7; }
.motion-surface .motion-pulse { transform-box: fill-box; transform-origin: center; }
.motion-surface .motion-delay-1 { animation-delay: 700ms; }
.motion-surface .motion-delay-2 { animation-delay: 1.4s; }
@keyframes dash-flow { to { stroke-dashoffset: -48; } }
@keyframes pulse { 0%, 100% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1); } }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }

@media (prefers-reduced-motion: no-preference) {
  .motion-ready .motion-surface .motion-dash { animation: dash-flow 4.8s linear infinite; }
  .motion-ready .motion-surface .motion-pulse { animation: pulse 3.6s ease-in-out infinite; }
  .motion-ready .motion-surface .motion-float { animation: float 5s ease-in-out infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .motion-surface *, .motion-surface *::before, .motion-surface *::after { animation-duration: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; }
}
@media (max-width: 780px) {
  .chapter-row, .chapter-row:nth-of-type(even) { grid-template-columns: 1fr; gap: 1.8rem; margin-bottom: 4.5rem; }
  .chapter-row:nth-of-type(even) .chapter-text { order: initial; }
  .motion-surface, .motion-surface svg { min-height: 190px; }
}
`;

const contentHtml = /*html*/ `
<section class="hero" aria-labelledby="hero-title">
  <h1 id="hero-title" class="hero-title">Turn chat intent into a workspace that can travel.</h1>
  <p class="hero-lead">symbiote-workspace turns chat intent into portable, executable workspaces. A guided construction protocol makes the layout, capabilities, actions, and theme explicit before a host mounts the result.</p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="${resolvePath('/docs/')}">Get started</a>
    <a class="btn btn-secondary" href="${resolvePath('/docs/reference/')}">View reference</a>
  </div>
</section>

<section class="narrative-section" aria-labelledby="narrative-title">
  <div class="narrative-intro">
    <span class="narrative-eyebrow">How it works</span>
    <h2 id="narrative-title" class="narrative-title">A workspace is a small, portable protocol.</h2>
    <p class="narrative-lead">The constructor turns a conversation into a host-neutral configuration, then lets any compatible host bring it to life.</p>
  </div>

  <ol class="narrative-illustration" data-pipeline aria-label="Workspace construction stages">
    <li class="ill-stage"><span class="ill-header">Register</span></li>
    <li class="ill-stage"><span class="ill-header">Compose</span></li>
    <li class="ill-stage"><span class="ill-header">Validate</span></li>
    <li class="ill-stage"><span class="ill-header">Export</span></li>
  </ol>

  <article class="chapter-row">
    <div class="chapter-text">
      <span class="chapter-num">01 · Register</span>
      <h3 class="chapter-title">Start with intent, not a blank canvas.</h3>
      <p class="chapter-desc">A guided questionnaire turns a vague request into a typed brief: the workspace kind, topology, host capabilities, and the guardrails that matter.</p>
    </div>
    <div class="chapter-visual motion-surface" aria-label="Intent becomes a structured brief">
      <svg viewBox="0 0 560 240" role="img" aria-labelledby="register-title">
        <title id="register-title">A chat prompt resolves into structured workspace choices.</title>
        <path class="line motion-dash" d="M70 121h115m45 0h115" />
        <rect class="soft" x="42" y="86" width="124" height="70" rx="12" />
        <path class="line" d="M63 111h74M63 128h49" />
        <circle class="dot motion-pulse" cx="207" cy="121" r="13" />
        <rect class="soft motion-float motion-delay-1" x="345" y="72" width="155" height="36" rx="10" />
        <rect class="soft motion-float motion-delay-2" x="345" y="120" width="130" height="36" rx="10" />
        <path class="line" d="M363 90h92M363 138h67" />
      </svg>
    </div>
  </article>

  <article class="chapter-row">
    <div class="chapter-text">
      <span class="chapter-num">02 · Compose</span>
      <h3 class="chapter-title">Describe the workspace as config.</h3>
      <p class="chapter-desc">The planner places regions, modules, actions, and wires in a deterministic tree. Plugins supply capabilities; the core stays neutral.</p>
    </div>
    <div class="chapter-visual motion-surface" aria-label="A workspace configuration tree">
      <svg viewBox="0 0 560 240" role="img" aria-labelledby="compose-title">
        <title id="compose-title">A workspace tree branches into regions and modules.</title>
        <path class="muted" d="M280 80v34M158 147h244M158 147v28M280 147v28M402 147v28" />
        <rect class="soft motion-float" x="221" y="42" width="118" height="38" rx="10" />
        <rect class="soft motion-float motion-delay-1" x="103" y="175" width="110" height="32" rx="9" />
        <rect class="soft motion-float motion-delay-2" x="225" y="175" width="110" height="32" rx="9" />
        <rect class="soft motion-float motion-delay-1" x="347" y="175" width="110" height="32" rx="9" />
        <circle class="dot motion-pulse" cx="280" cy="114" r="6" />
        <path class="line" d="M245 61h70M123 192h70M245 192h70M367 192h70" />
      </svg>
    </div>
  </article>

  <article class="chapter-row">
    <div class="chapter-text">
      <span class="chapter-num">03 · Validate</span>
      <h3 class="chapter-title">Check portability before a host sees it.</h3>
      <p class="chapter-desc">Schema checks, capability manifests, and host contracts catch missing pieces early. Validation keeps secrets and host-only identity out of the portable package.</p>
    </div>
    <div class="chapter-visual motion-surface" aria-label="Portable workspace validation">
      <svg viewBox="0 0 560 240" role="img" aria-labelledby="validate-title">
        <title id="validate-title">A workspace passes three quiet validation checks.</title>
        <path class="line motion-dash" d="M92 121h318" />
        <g class="motion-pulse"><circle class="soft" cx="125" cy="121" r="31" /><path class="line" d="m111 121 10 10 19-23" /></g>
        <g class="motion-pulse motion-delay-1"><circle class="soft" cx="280" cy="121" r="31" /><path class="line" d="m266 121 10 10 19-23" /></g>
        <g class="motion-pulse motion-delay-2"><circle class="soft" cx="435" cy="121" r="31" /><path class="line" d="m421 121 10 10 19-23" /></g>
      </svg>
    </div>
  </article>

  <article class="chapter-row">
    <div class="chapter-text">
      <span class="chapter-num">04 · Export</span>
      <h3 class="chapter-title">Save one package. Relaunch anywhere.</h3>
      <p class="chapter-desc">The result is a host-agnostic JSON package that can be shared, reopened, and mounted in a browser, CLI, MCP server, or another compatible host.</p>
    </div>
    <div class="chapter-visual motion-surface" aria-label="A portable workspace package moves between hosts">
      <svg viewBox="0 0 560 240" role="img" aria-labelledby="export-title">
        <title id="export-title">A workspace package moves from one host to several clients.</title>
        <path class="line motion-dash" d="M160 121h240M280 62v118" />
        <rect class="soft motion-float" x="222" y="91" width="116" height="60" rx="12" />
        <rect class="soft motion-float motion-delay-1" x="82" y="44" width="92" height="36" rx="9" />
        <rect class="soft motion-float motion-delay-2" x="386" y="44" width="92" height="36" rx="9" />
        <rect class="soft motion-float motion-delay-1" x="82" y="162" width="92" height="36" rx="9" />
        <rect class="soft motion-float motion-delay-2" x="386" y="162" width="92" height="36" rx="9" />
        <path class="line" d="M245 112h70M245 129h50" />
      </svg>
    </div>
  </article>
</section>
`;

export default renderPage({
  siteConfig: composeSiteConfig({ pageStyles: landingStyles }),
  pageTitle: 'Portable workspace construction',
  contentHtml,
  currentPath: '/',
  searchIndex: buildSearchIndex(docsRoutes),
});
