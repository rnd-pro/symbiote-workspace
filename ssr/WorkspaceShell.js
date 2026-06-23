import { Symbiote } from '@symbiotejs/symbiote';
import shellTemplate from './workspace-shell.tpl.js';

export class WorkspaceShell extends Symbiote {
  constructor() {
    super();
    // Hydrate the build-time SSR markup instead of re-rendering the shell.
    this.isoMode = true;
  }
}

WorkspaceShell.template = shellTemplate;
WorkspaceShell.reg('workspace-shell');
