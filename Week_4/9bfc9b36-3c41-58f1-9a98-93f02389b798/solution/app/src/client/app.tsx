import { useEffect, type ReactNode } from "react";
import { Live, LiveRegions, useLive } from "./live.js";
import { Router, useRouter } from "./router.js";
import { SessionProvider, useSession } from "./session.js";
import { matchScreen, type ScreenName } from "../shared/routes.js";
import type { Role } from "../shared/types.js";
import { Nav } from "./pages/chrome.js";
import { Landing, NotFound, SignIn } from "./pages/public.js";
import { LoftPage } from "./pages/loft.js";
import { BoatPage } from "./pages/boat.js";
import { DrawingPage } from "./pages/drawing.js";
import { FloorDrawingPage, FloorPage } from "./pages/floor.js";
import { StockPage } from "./pages/stock.js";
import { LedgerPage } from "./pages/ledger.js";
import { ConsolePage } from "./pages/console.js";
import { AccountsPage, RuleSetsPage } from "./pages/admin.js";
import { OwnerPage, SheetViewer } from "./pages/owner.js";

const ALLOWED: Record<string, Role[]> = {
  loft: ["sailmaker"], boat: ["sailmaker"], drawing: ["sailmaker"], measure: ["sailmaker"], draw: ["sailmaker"], nest: ["sailmaker"], confirm: ["sailmaker"],
  stock: ["sailmaker"], ledger: ["sailmaker"], console: ["sailmaker"], rulesets: ["sailmaker"], accounts: ["sailmaker"],
  floor: ["loft-hand"], "floor-drawing": ["loft-hand"], owner: ["yacht-owner"], sheet: ["yacht-owner"],
};

const WAITING_HEADINGS: Partial<Record<ScreenName, string>> = {
  loft: "The loft", stock: "Stock shelf", ledger: "Cloth ledger", console: "Console", rulesets: "Rule sets", accounts: "Accounts",
  floor: "Cutting floor", owner: "My boats",
};

function Protected({ screen, params }: { screen: ScreenName; params: Record<string, string> }): ReactNode {
  const { account, checking } = useSession();
  const { location, navigate } = useRouter();
  const { refuse } = useLive();
  const keepAlert = (location.state as { alert?: boolean } | null)?.alert === true;
  useEffect(() => {
    if (!keepAlert) refuse(null);
  }, [location.path, keepAlert, refuse]);
  useEffect(() => {
    if (!checking && !account) navigate(`/signin?resume=${encodeURIComponent(location.path + location.search)}`, { replace: true });
  }, [checking, account, navigate, location.path, location.search]);
  if (checking || !account) {
    const heading = WAITING_HEADINGS[screen];
    return <main className="page-blank">{heading ? <h1 className="waiting-heading">{heading}</h1> : null}</main>;
  }
  if (!ALLOWED[screen]?.includes(account.role)) return <NotFound />;
  const code = params.code ?? "";
  switch (screen) {
    case "loft": return <LoftPage />;
    case "boat": return <BoatPage code={code} />;
    case "drawing": case "measure": case "draw": case "nest": case "confirm": return <DrawingPage code={code} screen={screen} />;
    case "floor": return <FloorPage />;
    case "floor-drawing": return <FloorDrawingPage code={code} />;
    case "stock": return <StockPage />;
    case "ledger": return <LedgerPage />;
    case "console": return <ConsolePage />;
    case "rulesets": return <RuleSetsPage />;
    case "accounts": return <AccountsPage />;
    case "owner": return <OwnerPage />;
    case "sheet": return <SheetViewer id={params.id ?? ""} />;
    default: return <NotFound />;
  }
}

function Screens() {
  const { location } = useRouter();
  const match = matchScreen(location.path);
  if (!match) return <NotFound />;
  if (match.screen === "landing") return <Landing />;
  if (match.screen === "signin") return <SignIn />;
  return <Protected screen={match.screen} params={match.params} />;
}

export function App() {
  return (
    <Router>
      <Live>
        <SessionProvider>
          <Frame />
        </SessionProvider>
      </Live>
    </Router>
  );
}

function Frame() {
  const { location } = useRouter();
  const { account } = useSession();
  const match = matchScreen(location.path);
  const showNav = account !== null && match !== null && match.screen !== "landing" && match.screen !== "signin";
  return (
    <>
      {showNav ? <Nav /> : null}
      <LiveRegions reserved={showNav} />
      <Screens />
    </>
  );
}
