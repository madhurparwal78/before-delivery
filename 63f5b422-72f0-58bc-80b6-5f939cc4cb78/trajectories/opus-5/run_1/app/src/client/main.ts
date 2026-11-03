import { mountSignin, mountSignup, mountWorkspaces } from './accounts.js';
import { mountEditor } from './editor/index.js';
import type { Role } from '../shared/types.js';

interface BootData {
  route: 'signup' | 'signin' | 'workspaces' | 'editor';
  user?: { id: string; name: string; email: string };
  workspaceId?: string;
  workspaceName?: string;
  role?: Role;
}

const boot = (window as unknown as { __BOOT__?: BootData }).__BOOT__;
const root = document.getElementById('app');

if (boot !== undefined && root !== null) {
  if (boot.route === 'signup') mountSignup(root);
  else if (boot.route === 'signin') mountSignin(root);
  else if (boot.route === 'workspaces') void mountWorkspaces(root);
  else if (boot.route === 'editor') {
    void mountEditor(root, {
      workspaceId: boot.workspaceId ?? '',
      workspaceName: boot.workspaceName ?? '',
      user: { id: boot.user?.id ?? '', name: boot.user?.name ?? '' },
      role: boot.role ?? 'viewer',
    });
  }
}
