// The entry point: it reads the address, loads the account and draws the
// screen that address asks for.

import { api } from "./api";
import { closeAllDialogs } from "./dialogs";
import { clear } from "./dom";
import { connect } from "./live";
import { onRoute, readAddress } from "./router";
import {
  calendarMounted,
  handleAddressChange,
  redrawCalendar,
  renderCalendar,
  teardownCalendar,
} from "./screen-calendar";
import { renderEventPage } from "./screen-event";
import {
  renderFindATime,
  renderLanding,
  renderNotFound,
  renderPrints,
  renderSearch,
  renderSettings,
  renderSharedEvent,
  renderSharing,
  renderSignIn,
  renderTrash,
  renderZoneRules,
} from "./screens";
import { loadAccount, state } from "./state";
import { serverClock } from "./time";

const root = document.getElementById("app")!;
let signedIn = false;

async function ensureAccount(): Promise<boolean> {
  if (signedIn && state.me) return true;
  try {
    await loadAccount();
    signedIn = true;
    connect();
    return true;
  } catch {
    return false;
  }
}

async function route(): Promise<void> {
  const address = readAddress();
  if (address.path === "/calendar" && calendarMounted() && state.me) {
    await handleAddressChange(root);
    return;
  }
  closeAllDialogs();
  teardownCalendar();
  await serverClock.refresh();

  if (address.path === "/") {
    clear(root);
    renderLanding(root);
    return;
  }
  if (address.path === "/signin") {
    clear(root);
    renderSignIn(root);
    return;
  }
  if (address.path.startsWith("/share/")) {
    await renderSharedEvent(root, address.token);
    return;
  }
  if (!(await ensureAccount())) {
    window.history.replaceState({}, "", "/signin");
    clear(root);
    renderSignIn(root);
    return;
  }
  clear(root);
  if (address.path === "/calendar") {
    await renderCalendar(root);
    return;
  }
  if (address.path.startsWith("/events/")) {
    await renderEventPage(root, address.path.slice("/events/".length));
    return;
  }
  if (address.path === "/find") return renderFindATime(root);
  if (address.path === "/search") return renderSearch(root);
  if (address.path === "/trash") return renderTrash(root);
  if (address.path === "/sharing") return renderSharing(root);
  if (address.path === "/zone-rules") return renderZoneRules(root);
  if (address.path === "/prints") return renderPrints(root);
  if (address.path === "/settings") return renderSettings(root);
  renderNotFound(root);
}

onRoute(() => void route());
void route();

// The now line, today and every default date read the server clock: on load,
// on each live open, whenever the tab returns to view and every 30 seconds.
window.setInterval(() => void serverClock.refresh(), 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void serverClock.refresh();
});
window.addEventListener("resize", () => {
  if (readAddress().path !== "/calendar") return;
  if (calendarMounted()) redrawCalendar(root);
  else void route();
});

void api.time();
