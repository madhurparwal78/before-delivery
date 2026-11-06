import { Building2, Inbox, ListOrdered, LogOut, Map as MapIcon, Settings, Upload } from "lucide-react";
import type { ReactNode } from "react";
import type { Me } from "../../shared/api.js";
import { api } from "../api.js";
import { MessageSlot, ProgressBar, useFeedback } from "../feedback.js";
import { Link, navigate } from "../router.js";
import { SearchBox } from "./SearchBox.js";

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/features", label: "Features", icon: ListOrdered },
  { href: "/roadmap", label: "Roadmap", icon: MapIcon },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ me, path, children }: { me: Me; path: string; children: ReactNode }) {
  const feedback = useFeedback();
  const signOut = async (): Promise<void> => {
    try {
      await api.delete("/api/session");
      navigate("/signin");
    } catch (error) {
      feedback.fail(error);
    }
  };
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="workspace-name">{me.workspace.name}</span>
          <span className="product-name">Evidence Desk</span>
        </div>
        <SearchBox />
        <nav aria-label="Main" className="main-nav">
          {NAV.filter((item) => item.href !== "/settings" || me.user.role === "head_of_product").map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
              <Icon aria-hidden="true" size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <button type="button" className="button-quiet sign-out" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" size={16} />
          Sign out
        </button>
        <ProgressBar />
      </header>
      <MessageSlot />
      <main className="page">{children}</main>
    </div>
  );
}
