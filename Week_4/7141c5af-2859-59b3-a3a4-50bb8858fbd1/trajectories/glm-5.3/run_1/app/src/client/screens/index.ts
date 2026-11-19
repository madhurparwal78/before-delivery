import { api, announce, el, qs, qsa, motion, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { withBusy } from "../app.js";
import { autoRefresh, mintTile } from "./pieces.js";
import { installHide } from "./hide.js";
import { installCondition } from "./condition.js";
import { installPhotographs } from "./photographs.js";
import { installEstimate } from "./estimate.js";
import { installCollection } from "./collection.js";
import { installDossier } from "./dossier.js";
import { installBench } from "./bench.js";
import { installWorkbook } from "./workbook.js";
import { installRates } from "./rates.js";

export const screens: Record<string, (root: HTMLElement) => Promise<void>> = {
  pieces: (root) => import("./pieces.js").then((m) => m.piecesScreen(root)),
  piece: (root) => import("./pieces.js").then((m) => m.pieceScreen(root)),
  clients: (root) => import("./clients.js").then((m) => m.clientsScreen(root)),
  client: (root) => import("./clients.js").then((m) => m.clientScreen(root)),
  library: (root) => import("./library.js").then((m) => m.libraryScreen(root)),
  condition: (root) => installCondition(root),
  photographs: (root) => installPhotographs(root),
  hide: (root) => installHide(root),
  estimate: (root) => installEstimate(root),
  collection: (root) => installCollection(root),
  dossier: (root) => installDossier(root),
  bench: (root) => installBench(root),
  workbook: (root) => installWorkbook(root),
  rates: (root) => installRates(root),
};

void api;
void announce;
void el;
void qs;
void qsa;
void motion;
void ApiFail;
void dialogs;
void withBusy;
void autoRefresh;
void mintTile;
