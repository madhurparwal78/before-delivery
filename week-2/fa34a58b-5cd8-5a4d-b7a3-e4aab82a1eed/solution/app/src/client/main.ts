// Browser entry: read the hub's status, draw the shared frame, then the page this route names.

import { live } from "./live.ts";
import { buildShell } from "./shell.ts";
import { planPage } from "./plan.ts";
import { schedulesPage } from "./schedules.ts";
import { scenesPage } from "./scenes.ts";
import { guestsPage } from "./guests.ts";
import { logPage } from "./log.ts";
import { noticesPage } from "./notices.ts";

const PAGES = {
  plan: planPage,
  schedules: schedulesPage,
  scenes: scenesPage,
  guests: guestsPage,
  log: logPage,
  notices: noticesPage,
} as const;

// The plan's full address (day, time and offset) is written before anything else, so it is in the
// address bar as soon as the page has loaded.
const address = document.body.dataset.address;
if (address) history.replaceState(null, "", address);

async function boot(): Promise<void> {
  const page = (document.body.dataset.page ?? "plan") as keyof typeof PAGES;
  await live.start();
  const shell = buildShell(page);
  await PAGES[page](shell);
  document.body.classList.add("is-ready");
}

void boot();
