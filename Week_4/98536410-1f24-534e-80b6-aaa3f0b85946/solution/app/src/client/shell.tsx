// The frame every screen shares: header, header menu, storage notice band and the small corner wordmark.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { landingFor } from "../shared/routes";
import { api } from "./lib/api";
import { Overlay } from "./lib/overlay";
import { PHONE, useMedia } from "./lib/media";
import { Link, navigate, useLocation } from "./lib/router";
import { signOut, useSession } from "./session";
import { STORAGE_NOTICE, StorageProvider, useStorageDown } from "./storage";
import type { Me, ShopList } from "./types";

export function landingPath(me: Me): string {
  return landingFor(me.user.role, me.store_ids);
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="6" fill="currentColor" />
      <path d="M6 8h20v5h-7.5v13h-5V13H6z" fill="var(--ground)" />
    </svg>
  );
}

function HomeLink({ to }: { to: string }) {
  return (
    <Link to={to} className="mark" aria-label="Tramela Estate">
      <Mark />
    </Link>
  );
}

function ShopSwitcher({ me, id }: { me: Me; id?: string }) {
  const { pathname } = useLocation();
  const [shops, setShops] = useState<ShopList["stores"]>([]);
  useEffect(() => {
    api<ShopList>("GET", "/api/stores").then((answer) => setShops(answer.stores.filter((shop) => me.store_ids.includes(shop.id))), () => undefined);
  }, [me.store_ids]);
  const current = pathname.startsWith("/shop/") ? pathname.slice("/shop/".length) : "";
  return (
    <select id={id} aria-label="Shop" className="field switcher" value={current} onChange={(event) => navigate(`/shop/${event.target.value}`)}>
      {shops.map((shop) => (
        <option key={shop.id} value={shop.id}>{shop.name}</option>
      ))}
    </select>
  );
}

function StorageBand() {
  const down = useStorageDown();
  return (
    <Overlay open={down} role="status" label="Storage notice" passive modal={false} onClose={() => undefined} className="storage-band" restored={false}>
      <p>{STORAGE_NOTICE}</p>
    </Overlay>
  );
}

function MenuSheet({ me, open, onClose, opener }: { me: Me; open: boolean; onClose: () => void; opener: React.RefObject<HTMLButtonElement | null> }) {
  const { setMe } = useSession();
  return (
    <Overlay open={open} role="dialog" label="Menu" modal={false} onClose={onClose} opener={opener} className="menu-sheet">
      <p className="operator">{me.operator.name}</p>
      {me.user.role === "manager" ? <ShopSwitcher me={me} /> : null}
      <button type="button" className="btn" onClick={() => void signOut(setMe)}>Sign out</button>
      <button type="button" className="btn" onClick={onClose}>Close menu</button>
    </Overlay>
  );
}

function Header({ me }: { me: Me | null }) {
  const { setMe } = useSession();
  const phone = useMedia(PHONE);
  const [menu, setMenu] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const { pathname } = useLocation();
  useEffect(() => setMenu(false), [pathname, phone]);
  if (!me) {
    return (
      <header className="app-header">
        <HomeLink to="/" />
      </header>
    );
  }
  return (
    <>
      <header className="app-header">
        <HomeLink to={landingPath(me)} />
        {phone ? (
          <button ref={opener} type="button" className="btn menu-button" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>Menu</button>
        ) : (
          <>
            <p className="operator">{me.operator.name}</p>
            {me.user.role === "manager" ? <ShopSwitcher me={me} /> : null}
            <button type="button" className="btn" onClick={() => void signOut(setMe)}>Sign out</button>
          </>
        )}
      </header>
      {phone ? <MenuSheet me={me} open={menu} onClose={() => setMenu(false)} opener={opener} /> : null}
    </>
  );
}

/** The small fixed wordmark of every working screen: decorative, ignores the pointer, hidden from assistive technology. */
function CornerWords() {
  return (
    <>
      <span className="corner corner-tl" aria-hidden="true">Tramela</span>
      <span className="corner corner-br" aria-hidden="true">Estate</span>
    </>
  );
}

function StateDefs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--accent)" />
          <rect width="2" height="6" fill="var(--ground)" />
        </pattern>
      </defs>
    </svg>
  );
}

export function Frame({ me, children, className }: { me: Me | null; children: ReactNode; className?: string }) {
  const body = (
    <>
      <StateDefs />
      <CornerWords />
      <Header me={me} />
      {me ? <StorageBand /> : null}
      <div className={className ? `page ${className}` : "page"}>{children}</div>
    </>
  );
  return me ? <StorageProvider>{body}</StorageProvider> : body;
}
