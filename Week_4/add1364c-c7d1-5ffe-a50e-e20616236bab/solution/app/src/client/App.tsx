import { useEffect } from "react";
import { useRouter } from "./lib/router";
import { useStore } from "./lib/store";
import type { Role } from "./lib/types";
import { Audit } from "./pages/Audit";
import { Billing } from "./pages/Billing";
import { Drawer } from "./pages/Drawer";
import { Health } from "./pages/Health";
import { Import } from "./pages/Import";
import { People } from "./pages/People";
import { Reviews } from "./pages/Reviews";
import { Rotations } from "./pages/Rotations";
import { DeskShell } from "./pages/Shell";
import { Landing, NotFound, SessionEnded, SignIn } from "./pages/Simple";
import { Travel } from "./pages/Travel";

const OFFICE: Role[] = ["office_manager", "managing_partner"];
const ALL: Role[] = ["office_manager", "managing_partner", "staff_accountant", "outside_bookkeeper"];

const DESK_ROUTES: Record<string, Role[]> = {
  "/desk": ALL,
  "/rotations": OFFICE,
  "/reviews": OFFICE,
  "/people": OFFICE,
  "/travel": ["staff_accountant", "outside_bookkeeper"],
  "/billing": OFFICE,
  "/health": OFFICE,
  "/import": ["office_manager"],
  "/audit": OFFICE,
};

const VAULT_ROUTE = /^\/desk\/vaults\/([^/]+)$/;

function isDeskPath(path: string): boolean {
  return path in DESK_ROUTES || VAULT_ROUTE.test(path);
}

export function App() {
  const { location, navigate } = useRouter();
  const { me, meLoaded, sessionEnded } = useStore();
  const path = location.path;
  const desk = isDeskPath(path);

  useEffect(() => {
    if (desk && meLoaded && !me && !sessionEnded) {
      navigate(`/sign-in?next=${encodeURIComponent(path + location.search)}`, true);
    }
  }, [desk, meLoaded, me, sessionEnded, path, location.search, navigate]);

  if (sessionEnded) return <SessionEnded />;
  if (path === "/") return <Landing />;
  if (path === "/sign-in") return <SignIn />;
  if (!desk) return <NotFound />;
  if (!meLoaded || !me) return <DeskShellEmpty />;

  const vault = VAULT_ROUTE.exec(path);
  const allowed = vault ? DESK_ROUTES["/desk"] : DESK_ROUTES[path];
  if (!allowed || !allowed.includes(me.role)) return <DeskShell><NotFound inShell /></DeskShell>;

  let page;
  if (vault) page = <Drawer key="drawer" vaultId={decodeURIComponent(vault[1] ?? "")} />;
  else if (path === "/desk") page = <Drawer key="drawer" vaultId={null} />;
  else if (path === "/rotations") page = <Rotations />;
  else if (path === "/reviews") page = <Reviews />;
  else if (path === "/people") page = <People />;
  else if (path === "/travel") page = <Travel />;
  else if (path === "/billing") page = <Billing />;
  else if (path === "/health") page = <Health />;
  else if (path === "/import") page = <Import />;
  else page = <Audit />;
  return <DeskShell>{page}</DeskShell>;
}

function DeskShellEmpty() {
  return (
    <div className="public">
      <main id="main"><p className="loading-text pad">Opening the drawer</p></main>
    </div>
  );
}
