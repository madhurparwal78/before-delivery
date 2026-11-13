// Tonight: start a session and list sessions (DP-06, offline).
import { app, navigate, persist, queueChangeLocal } from "../app.js";
import { renderApp } from "./router.js";
import { el } from "../dom.js";
import { apiGet } from "../api.js";
import { renderConnection, shell } from "./shell.js";
import { tonightSentences } from "../../shared/sentences.js";
import { canonicalUtc, eveningDateFor, localHHMM, utcOffset } from "../../shared/time.js";
import type { OpticsPayload } from "../../shared/api.js";
import { deriveOptics } from "../../shared/optics.js";

export async function renderTonight(root: HTMLElement): Promise<void> {
  const parts = shell("Tonight", []);
  const column = parts.column;
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null);
  const store = accountId ? app.state.stores[accountId] : null;

  const sites = store?.sites ?? [];
  const kit = store?.kit ?? null;

  const sitePicker = el("select", { class: "input", "aria-label": "Site" }) as HTMLSelectElement;
  for (const site of sites) {
    sitePicker.append(el("option", { value: site.id, text: site.name }));
  }

  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Tonight status" });

  const startButton = el("button", {
    class: "button primary",
    text: "Start session",
    onclick: async () => {
      if (!kit || kit.telescopes.length === 0 || kit.eyepieces.length === 0) {
        statusRegion.textContent = tonightSentences.needsKit;
        return;
      }
      if (sites.length === 0) {
        statusRegion.textContent = tonightSentences.needsSite;
        return;
      }
      // Default optics (Business rules): first telescope, longest eyepiece,
      // no Barlow, straight through.
      const telescope = kit.telescopes[0]!;
      const eyepiece = kit.eyepieces[0]!;
      const accountId = app.state.signedInAccountId!;
      const sessionId = crypto.randomUUID();
      const optics: OpticsPayload = { telescope_id: telescope.id, eyepiece_id: eyepiece.id, barlow_id: null, train: "straight" };
      queueChangeLocal(accountId, {
        client_op_id: crypto.randomUUID(),
        kind: "session.create",
        session_id: sessionId,
        site_id: sitePicker.value,
        started_at: canonicalUtc(Date.now()),
        optics,
      }, "session.create");
      // The session opens at once, online or offline: the device holds its
      // copy with the default optics derived locally (DP-06, DP-19).
      const chosenSite = sites.find((site) => site.id === sitePicker.value) ?? sites[0];
      const derived = deriveOptics(telescope, eyepiece, 1, "straight");
      const startedAt = canonicalUtc(Date.now());
      const sessionStore = app.state.stores[accountId] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      sessionStore.sessions[sessionId] = {
        id: sessionId,
        site: { id: chosenSite?.id ?? "", name: chosenSite?.name ?? "", time_zone: chosenSite?.time_zone ?? "UTC" },
        started_at: startedAt,
        evening_date: eveningDateFor(Date.parse(startedAt), chosenSite?.time_zone ?? "UTC"),
        local_start: localHHMM(Date.parse(startedAt), chosenSite?.time_zone ?? "UTC"),
        local_start_offset: utcOffset(Date.parse(startedAt), chosenSite?.time_zone ?? "UTC"),
        optics,
        derived,
        observation_count: 0,
        observations: [],
      };
      app.state.activeSessionId[accountId] = sessionId;
      app.state.activeObservationId[accountId] = null;
      persist();
      navigate(`/sessions/${sessionId}`);
    },
  });

  const form = el("div", { class: "field-row" },
    el("label", { class: "field-label", text: "Site" }),
    sitePicker,
    startButton,
  );

  const list = el("ul", { class: "rows", role: "list", "aria-label": "Sessions" });
  const renderList = (): void => {
    list.textContent = "";
    const currentStore = app.state.signedInAccountId ? app.state.stores[app.state.signedInAccountId] : null;
    const sessions = Object.entries(currentStore?.sessions ?? {}).sort((a, b) => (a[1].started_at < b[1].started_at ? 1 : -1));
    for (const [, session] of sessions) {
      list.append(sessionRow(session.id, session.evening_date, session.site.name, session.observation_count));
    }
  };
  renderList();

  column.append(form, statusRegion, el("h2", { class: "subheading", text: "Your sessions" }), list);
  root.append(column);
  if (app.account && navigator.onLine) await refreshTonight(parts, list, renderList, sitePicker);
}

function sessionRow(id: string, eveningDate: string, siteName: string, count: number): HTMLElement {
  return el("li", { class: "row" },
    el("a", {
      class: "row-main",
      href: `/sessions/${id}`,
      onclick: (event: MouseEvent) => {
        event.preventDefault();
        navigate(`/sessions/${id}`);
      },
    },
      el("span", { class: "row-ink", text: `${eveningDate} · ${siteName}` }),
      el("span", { class: "row-muted", text: `${count} observations` }),
    ),
  );
}

async function refreshTonight(parts: ReturnType<typeof shell>, list: HTMLElement, renderList: () => void, sitePicker: HTMLSelectElement): Promise<void> {
  try {
    const [sites, sessions, kit] = await Promise.all([apiGet.sites(), apiGet.sessions(), apiGet.kit()]);
    const accountId = app.state.signedInAccountId!;
    const store = app.state.stores[accountId] ??= {
      kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
      histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
    };
    store.sites = sites.sites;
    store.kit = kit;
    store.sessionOrder = sessions.sessions.map((s) => s.id);
    for (const session of sessions.sessions) {
      store.sessions[session.id] ??= { ...session, observations: [] };
    }
    persist();
    renderConnection(parts.connection);
    renderList();
    sitePicker.textContent = "";
    for (const site of store.sites) {
      sitePicker.append(el("option", { value: site.id, text: site.name }));
    }
  } catch {
    // Offline: the device copy already rendered.
  }
}

