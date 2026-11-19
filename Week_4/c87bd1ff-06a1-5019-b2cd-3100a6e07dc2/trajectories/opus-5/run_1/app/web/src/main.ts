import type { App, Screen } from "./app.js";
import { Live } from "./live.js";
import { Announcer } from "./updates.js";
import type { Boot, Frame } from "./types.js";
import { adminScreen } from "./pages/admin.js";
import { bidderScreen } from "./pages/bidder.js";
import { cashierScreen } from "./pages/cashier.js";
import { catalogueScreen } from "./pages/catalogue.js";
import { consignLotScreen, consignNewScreen, consignScreen } from "./pages/consign.js";
import { invoiceScreen, statementScreen } from "./pages/documents.js";
import { homeScreen } from "./pages/home.js";
import { lotScreen } from "./pages/lot.js";
import { registerScreen } from "./pages/register.js";
import { staticScreen } from "./pages/simple.js";
import { specialistScreen } from "./pages/specialist.js";

const screens: Record<string, Screen> = {
  home: homeScreen,
  catalogue: catalogueScreen,
  lot: lotScreen,
  register: registerScreen,
  bidder: bidderScreen,
  bidder_invoice: invoiceScreen,
  consign: consignScreen,
  consign_new: consignNewScreen,
  consign_lot: consignLotScreen,
  consign_statement: statementScreen,
  desk_specialist: specialistScreen,
  desk_cashier: cashierScreen,
  desk_admin: adminScreen,
  not_found: staticScreen,
  not_your_desk: staticScreen,
  signin_error: staticScreen,
  signin_outage: staticScreen,
};

const readBoot = (): Boot => {
  const holder = document.getElementById("bootstrap");
  const fallback: Boot = {
    route: "not_found",
    id: "",
    data: {},
    viewer: {
      signed_in: false,
      name: "",
      roles: [],
      registration: "",
      status: "",
      paddle: null,
      spending_limit: null,
    },
    durations: {},
  };
  if (!holder?.textContent) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(holder.textContent) as Boot) };
  } catch {
    return fallback;
  }
};

const start = (): void => {
  const boot = readBoot();
  const root = document.getElementById("app");
  const region = document.getElementById("updates");
  if (!root || !region) return;
  const say = new Announcer(region);
  const seq = Number(boot.data?.seq ?? 0);
  let follow: ((frame: Frame) => void) | void;
  const live = new Live(Number.isFinite(seq) ? seq : 0, (frame) => {
    if (follow) follow(frame);
    else if (frame.type === "notice") say.notice(frame.notice.id, frame.notice.kind, frame.notice.text);
  });
  const app: App = { boot, live, say, root };
  const screen = screens[boot.route] ?? staticScreen;
  follow = screen(app);
  live.start();
};

start();
