import { pageTemplate, url } from './layout.js';

const content = `
<section class="hero" aria-labelledby="hero-title">
  <h1 id="hero-title" class="hero-title">Turn chat intent into a workspace that can travel.</h1>
  <p class="hero-lead">symbiote-workspace turns chat intent into portable, executable workspaces. A guided construction protocol makes the layout, capabilities, actions, and theme explicit before a host mounts the result.</p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="${url('/docs/')}">Get started</a>
    <a class="btn btn-secondary" href="${url('/docs/reference/')}">View reference</a>
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

export default pageTemplate({ title: 'Home', content, currentPath: '/' });
