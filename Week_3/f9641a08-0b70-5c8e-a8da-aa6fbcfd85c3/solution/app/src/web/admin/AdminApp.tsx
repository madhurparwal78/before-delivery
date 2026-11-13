import { useEffect } from "react";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { Panel } from "../components/Panel";
import { Link, navigate, usePath } from "../lib/router";
import { useApp } from "../lib/store";
import { NotFound } from "../pages/NotFound";
import { CasePage, CaseQueue, type CaseSegment } from "./Cases";
import { InventoryList, MovementsPage } from "./Inventory";
import { OrderPage, OrdersList } from "./Orders";
import { ProductPage, ProductsList } from "./Products";
import { Promotions } from "./Promotions";
import { AuditLog, Dashboard, GiftCards, Reports } from "./Reporting";
import { useStaffStatus } from "./ui";
import "../styles/admin.css";

type Area = "dashboard" | "products" | "inventory" | "orders" | "returns" | "trials" | "warranty" | "promotions" | "gift-cards" | "audit" | "reports";

const NAV: { area: Area; label: string; roles: ("operations" | "support")[] }[] = [
  { area: "dashboard", label: "Dashboard", roles: ["operations"] },
  { area: "products", label: "Products", roles: ["operations"] },
  { area: "inventory", label: "Inventory", roles: ["operations"] },
  { area: "orders", label: "Orders", roles: ["operations", "support"] },
  { area: "returns", label: "Returns", roles: ["support"] },
  { area: "trials", label: "Trials", roles: ["support"] },
  { area: "warranty", label: "Warranty", roles: ["support"] },
  { area: "promotions", label: "Promotions", roles: ["operations"] },
  { area: "gift-cards", label: "Gift cards", roles: ["operations"] },
  { area: "audit", label: "Audit log", roles: ["operations", "support"] },
  { area: "reports", label: "Reports", roles: ["operations"] },
];

function hrefOf(area: Area): string {
  return area === "dashboard" ? "/admin" : `/admin/${area}`;
}

function Page({ area, detail }: { area: Area; detail: string | undefined }) {
  switch (area) {
    case "dashboard":
      return <Dashboard />;
    case "products":
      return detail ? <ProductPage key={detail} slug={detail} /> : <ProductsList />;
    case "inventory":
      return detail ? <MovementsPage key={detail} sku={detail} /> : <InventoryList />;
    case "orders":
      return detail ? <OrderPage key={detail} number={detail} /> : <OrdersList />;
    case "returns":
    case "trials":
    case "warranty": {
      const segment: CaseSegment = area;
      return detail ? <CasePage key={detail} segment={segment} number={detail} /> : <CaseQueue segment={segment} />;
    }
    case "promotions":
      return <Promotions />;
    case "gift-cards":
      return <GiftCards />;
    case "audit":
      return <AuditLog />;
    case "reports":
      return <Reports />;
  }
}

/** The staff frame: navigation in the left zone, working pages right of the axis. */
export function AdminApp() {
  const path = usePath();
  const { me } = useApp();
  const staffStatus = useStaffStatus();
  const [, first, detail] = path.split("/").filter(Boolean) as [string, string | undefined, string | undefined];
  const role = me?.role;
  const links = NAV.filter((item) => role && item.roles.some((r) => r === role));
  const area: Area | null = first === undefined ? "dashboard" : (NAV.find((item) => item.area === first)?.area ?? null);
  const landing = role === "support" && first === undefined;

  useEffect(() => {
    if (landing) navigate("/admin/returns", { replace: true });
  }, [landing]);

  if (role !== "operations" && role !== "support") {
    return (
      <div className="page">
        <Panel tone="red" heading>
          This area is for Roam House staff.
        </Panel>
        <ConnectionStatus />
      </div>
    );
  }

  if (landing) return null;
  const allowed = area !== null && links.some((item) => item.area === area);
  return (
    <div className="staff">
      <div className="axis">
        <div className="zone staff-zone">
          <Link href="/" className="staff-home">
            Roam House staff
          </Link>
          <nav aria-label="Staff">
            <ul>
              {links.map((item) => (
                <li key={item.area}>
                  <Link href={hrefOf(item.area)} aria-current={area === item.area ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <main className="main staff-main" id="main" tabIndex={-1}>
          <div role="status" aria-label="Staff updates" aria-live="polite" className={staffStatus ? "staff-status" : "sr-only"}>
            {staffStatus}
          </div>
          {area === null ? <NotFound /> : allowed ? <Page area={area} detail={detail} /> : <Panel tone="red">You don't have permission to do that.</Panel>}
        </main>
      </div>
      <ConnectionStatus />
    </div>
  );
}
