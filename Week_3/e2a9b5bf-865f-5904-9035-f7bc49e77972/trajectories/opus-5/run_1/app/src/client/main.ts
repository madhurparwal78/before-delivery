import { packetPageCss } from '../shared/packet-page.js';
import type { Account } from '../shared/types.js';
import { api } from './api.js';
import { notFoundScreen, paintConnection } from './chrome.js';
import { get, STORE_META } from './idb.js';
import { journalCountFor, onBroadcast, reloadJournal } from './journal.js';
import { prefetchAccount } from './prefetch.js';
import {
  adoptAccountChange,
  configureRouter,
  renderRoute,
  setDeviceSignedOut,
} from './router.js';
import { renderLanding } from './screens/landing.js';
import { renderSignIn, renderSignUp } from './screens/auth.js';
import { renderTonight } from './screens/tonight.js';
import { renderSession } from './screens/session.js';
import { renderObjectHistory } from './screens/history.js';
import { renderPrograms } from './screens/programs.js';
import { renderProgram } from './screens/program.js';
import { renderPacket } from './screens/packet.js';
import { renderKit } from './screens/kit.js';
import {
  appState,
  loadCopy,
  loadDeviceName,
  readRememberedAccount,
  rememberAccount,
  setAccount,
  setOffline,
  setSignedOutWithWork,
  subscribe,
} from './state.js';
import { adoptBroadcastSentences, flushJournal, reloadFromDevice, startSync } from './sync.js';

async function boot(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) return;

  // Packet pages share one stylesheet with the PDF, so paper and preview match.
  document.head.append(
    Object.assign(document.createElement('style'), { textContent: packetPageCss() }),
  );

  await loadDeviceName();
  const remembered = await readRememberedAccount();
  const signedOut = (await get<boolean>(STORE_META, 'signed_out').catch(() => false)) ?? false;
  setDeviceSignedOut(signedOut);

  if (remembered && !signedOut) {
    setAccount(remembered);
    await loadCopy(remembered.id);
    await reloadJournal();
  }

  configureRouter({
    mount,
    notFound: notFoundScreen,
    routes: [
      { pattern: /^\/$/, names: [], guarded: false, render: renderLanding },
      { pattern: /^\/signup$/, names: [], guarded: false, render: renderSignUp },
      { pattern: /^\/signin$/, names: [], guarded: false, render: renderSignIn },
      { pattern: /^\/tonight$/, names: [], guarded: true, render: renderTonight },
      { pattern: /^\/sessions\/([^/]+)$/, names: ['id'], guarded: true, render: renderSession },
      {
        pattern: /^\/objects\/([^/]+)$/,
        names: ['id'],
        guarded: true,
        render: renderObjectHistory,
      },
      { pattern: /^\/programs$/, names: [], guarded: true, render: renderPrograms },
      { pattern: /^\/programs\/([^/]+)$/, names: ['id'], guarded: true, render: renderProgram },
      { pattern: /^\/packets\/([^/]+)$/, names: ['id'], guarded: true, render: renderPacket },
      { pattern: /^\/kit$/, names: [], guarded: true, render: renderKit },
    ],
  });

  window.addEventListener('popstate', () => void renderRoute());
  subscribe(paintConnection);

  onBroadcast((message) => {
    if (message.type === 'account') {
      void adoptAccountChange(message.account_id);
      return;
    }
    const account = appState().account;
    if (!account) return;
    if (message.type === 'journal' || message.type === 'copy') {
      void reloadFromDevice().then(() => paintConnection());
      return;
    }
    if (message.type === 'sentences' && message.account_id === account.id) {
      void adoptBroadcastSentences(message.sentences);
    }
  });

  // The first paint waits for the session check, so no screen flashes the wrong state.
  const me = await api.get<{ account: Account }>('/api/auth/me');
  if (me.offline) {
    setOffline(true);
  } else if (me.status === 200 && me.body) {
    const account = me.body.account;
    setOffline(false);
    setAccount(account);
    await rememberAccount(account);
    setDeviceSignedOut(false);
    setSignedOutWithWork(false);
    if (!remembered || remembered.id !== account.id) {
      await loadCopy(account.id);
      await reloadJournal();
    }
  } else if (me.status === 401) {
    setOffline(false);
    const waiting = remembered ? await journalCountFor(remembered.id) : 0;
    if (waiting > 0 && remembered && !signedOut) {
      setSignedOutWithWork(true);
    } else {
      setAccount(null);
      await rememberAccount(null);
      await reloadJournal();
    }
  }

  await renderRoute();
  if (appState().account && !me.offline) void prefetchAccount();

  startSync();

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
  void flushJournal();
}

void boot();
