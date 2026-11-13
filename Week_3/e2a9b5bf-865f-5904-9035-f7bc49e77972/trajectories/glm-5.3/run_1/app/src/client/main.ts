// Browser entry: boot the app, the sync sender and the account refresh.
import { app, listenForBroadcasts, navigate, persist } from "./app.js";
import { startSyncSender, flushJournal } from "./sync.js";
import { renderApp as render } from "./pages/router.js";

async function resumeThenFlush(): Promise<void> {
  // The connection returned: resume the sign-in, repaint, and send the
  // journal in its original order (DP-67).
  try {
    const { apiGet } = await import("./api.js");
    const me = await apiGet.me();
    app.account = me.account;
    app.state.signedInAccountId = me.account.id;
    app.state.accountEmail = me.account.email;
    app.state.lastSignedInEmail = me.account.email;
  } catch {
    // The session may have ended; the signed-out line governs what shows.
  }
  await render();
  const { flushJournal } = await import("./sync.js");
  await flushJournal();
}

async function boot(): Promise<void> {
  window.addEventListener("popstate", () => {
    app.route = window.location.pathname + window.location.search;
    render();
  });
  document.addEventListener("click", (event) => {
    // Inter-document links that stay inside the app navigate without a load.
    const target = (event.target as HTMLElement | null)?.closest("a");
    if (!target) return;
    if (target.hasAttribute("download") || target.hasAttribute("target")) return;
    const href = target.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    // The PDF download streams from the API and must not be intercepted.
    if (href.startsWith("/api/")) return;
    event.preventDefault();
    navigate(href);
  });
  listenForBroadcasts();
  startSyncSender();
  // The app shell serves from the device after one online visit (DP-18).
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline-first still works through the device copy on a live page.
    });
  }
  // Resume the session when the device still holds one. The server answers
  // 503 while it is still starting; retry until it answers (DP-48, DP-53).
  // While offline the device copy shows at once (DP-67, DP-88), and the
  // probe keeps retrying in the background.
  const { apiGet } = await import("./api.js");
  let resumed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const me = await apiGet.me();
      app.account = me.account;
      app.state.signedInAccountId = me.account.id;
      app.state.accountEmail = me.account.email;
      app.state.lastSignedInEmail = me.account.email;
      resumed = true;
      break;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        app.account = null;
        app.state.signedInAccountId = null;
        break;
      }
      if (!navigator.onLine) {
        // The device copy shows while there is no network; the probe runs
        // again when the connection returns. The stored sign-in stays so the
        // journal keeps its owner and can flush when signal returns (DP-67).
        window.addEventListener("online", () => { void resumeThenFlush(); }, { once: true });
        break;
      }
      if (status === 0) {
        // A request that could not leave the device while the browser still
        // reports a connection: retry a few times, then show the device copy.
        if (attempt >= 2) {
          window.addEventListener("online", () => { void resumeThenFlush(); }, { once: true });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (status === 503 && attempt <= 15) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      app.account = null;
      app.state.signedInAccountId = null;
      break;
    }
  }
  void resumed;
  await render();
  if (app.account && navigator.onLine) {
    // The whole account lands on the device within 10 seconds of the first
    // online visit (DP-88).
    void refreshWholeAccount();
    void flushJournal();
  }
}

async function refreshWholeAccount(): Promise<void> {
  const accountId = app.state.signedInAccountId;
  if (!accountId) return;
  try {
    const { apiGet } = await import("./api.js");
    const [kit, sites, programs, sessions, objects, packets] = await Promise.all([
      apiGet.kit(), apiGet.sites(), apiGet.programs(), apiGet.sessions(), apiGet.objects(), apiGet.packets(),
    ]);
    const store = app.state.stores[accountId] ??= {
      kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
      histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
    };
    store.kit = kit;
    store.sites = sites.sites;
    store.programs = programs.programs;
    store.sessionOrder = sessions.sessions.map((session) => session.id);
    store.lastRefreshAt = Date.now();
    for (const session of sessions.sessions) {
      try {
        const full = await apiGet.session(session.id);
        store.sessions[session.id] = full;
        for (const observation of full.observations) {
          if (observation.sketch && !store.strokes[observation.id]) {
            const read = await apiGet.strokes(observation.id);
            if (read.ok) store.strokes[observation.id] = read.text;
          }
        }
      } catch {
        // One session failing must not stop the rest of the refresh.
      }
    }
    for (const object of objects.objects) {
      try {
        const history = await apiGet.history(object.id);
        store.histories[object.id] = history;
      } catch {
        // One object failing must not stop the rest of the refresh.
      }
    }
    for (const program of programs.programs) {
      try {
        store.programDetails[program.id] = await apiGet.program(program.id);
      } catch {
        // Continue without this program's detail.
      }
    }
    for (const packet of packets.packets) {
      store.packets[packet.id] = packet;
    }
      persist();
  } catch {
    // Offline: the device keeps what it has.
  }
}

void boot().catch(() => {
  // The app still renders its shell offline.
});
