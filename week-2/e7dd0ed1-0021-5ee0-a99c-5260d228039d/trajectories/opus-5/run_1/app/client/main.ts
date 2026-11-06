import { mountSignIn } from './signin';
import { mountConsole } from './console';
import { mountAccount } from './account';
import { mountOperator } from './ops';
import { mountInvite } from './invite';

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  const kind = document.body.className;
  if (kind === 'signin') await mountSignIn(root);
  else if (kind === 'console') await mountConsole(root);
  else if (kind === 'account') await mountAccount(root);
  else if (kind === 'ops') await mountOperator(root);
  else if (kind === 'invite') await mountInvite(root);
}

void start();
