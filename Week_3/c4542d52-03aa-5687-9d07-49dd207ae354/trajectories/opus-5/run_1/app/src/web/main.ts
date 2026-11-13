import "./styles.css";
import { person, registerRoute, startApp, type Page, type PageContext } from "./app.js";
import { signInPage } from "./pages/signin.js";
import { portalPage } from "./pages/portal.js";
import { grantPage, vestingRedirectPage } from "./pages/grant.js";
import { exerciseChapterPage, orderPage } from "./pages/exercise.js";
import { documentsPage } from "./pages/documents.js";
import { capTablePage } from "./pages/captable.js";
import { tenderPage } from "./pages/tenders.js";
import { boardGrantPage, boardQueuePage } from "./pages/board.js";
import { adminGrantsPage, grantFormPage } from "./pages/adminGrants.js";
import { valuationsPage } from "./pages/valuations.js";
import { scenarioPage } from "./pages/scenario.js";
import { adminTendersPage, ledgerPage, peoplePage } from "./pages/adminMisc.js";

function homePage(context: PageContext): Page {
  return person() === null ? signInPage(context) : portalPage(context);
}

registerRoute("/", "all", homePage);
registerRoute("/grants/:id", ["option_holder", "leaver", "founder_admin"], grantPage);
registerRoute("/vesting", ["option_holder", "leaver"], vestingRedirectPage);
registerRoute("/exercise", ["option_holder", "leaver"], exerciseChapterPage);
registerRoute("/exercises/:id", ["option_holder", "leaver", "founder_admin"], orderPage);
registerRoute("/documents", ["option_holder", "leaver", "investor", "founder_admin"], documentsPage);
registerRoute("/documents/:id", ["option_holder", "leaver", "investor", "founder_admin"], documentsPage);
registerRoute("/cap-table", "all", capTablePage);
registerRoute("/tenders", ["investor", "founder_admin"], tenderPage);
registerRoute("/tenders/:id", ["investor", "founder_admin"], tenderPage);
registerRoute("/board", ["board_member"], boardQueuePage);
registerRoute("/board/:id", ["board_member"], boardGrantPage);
registerRoute("/admin/grants", ["founder_admin"], adminGrantsPage);
registerRoute("/admin/grants/:id", ["founder_admin"], grantFormPage);
registerRoute("/admin/valuations", ["founder_admin"], valuationsPage);
registerRoute("/admin/ledger", ["founder_admin"], ledgerPage);
registerRoute("/admin/tenders", ["founder_admin"], adminTendersPage);
registerRoute("/admin/scenario", ["founder_admin"], scenarioPage);
registerRoute("/admin/people", ["founder_admin"], peoplePage);

startApp();
