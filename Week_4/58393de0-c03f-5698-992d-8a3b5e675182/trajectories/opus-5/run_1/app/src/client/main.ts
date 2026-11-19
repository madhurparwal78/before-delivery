import { api } from './api.js';
import { startLiveStream } from './live.js';
import { buildShell } from './shell.js';
import { startRouter } from './router.js';
import { setAccount, setPendingJoin, setTimers, account } from './runtime.js';

const boot = async (): Promise<void> => {
  const [session, config] = await Promise.all([api.session(), api.config()]);
  if (session.ok) {
    setAccount(session.value.account);
    setPendingJoin(session.value.pendingJoin);
  }
  if (config.ok) setTimers(config.value);
  const shell = buildShell();
  startRouter(shell.main, shell.refreshHeader);
  if (account()) startLiveStream();
};

void boot();
