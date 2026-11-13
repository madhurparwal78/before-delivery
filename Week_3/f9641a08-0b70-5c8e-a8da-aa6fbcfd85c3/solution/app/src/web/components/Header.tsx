import { useRef, useState } from "react";
import { Link, usePath } from "../lib/router";
import { useApp } from "../lib/store";
import { Dialog } from "./Dialog";
import { SearchBox } from "./SearchBox";

function itemsName(label: string, count: number): string {
  return `${label}, ${count} ${count === 1 ? "item" : "items"}`;
}

interface HeaderProps {
  bagOpen: boolean;
  onBag: () => void;
  bagRef: React.RefObject<HTMLButtonElement | null>;
}

export function Header({ onBag, bagRef }: HeaderProps) {
  const { me, cart, wishlistCount, compareSet } = useApp();
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const path = usePath();
  const home = path === "/";
  const compareHref = compareSet ? `/compare?compare=${compareSet}` : "/compare";
  const bagCount = cart?.count ?? 0;

  return (
    <header className={`site-header ${home ? "on-mosaic" : ""}`}>
      <Link href="/" className="wordmark" aria-label="Roam House home">
        Roam House
      </Link>
      <nav className="tab" aria-label="Main">
        <Link href="/collections/all">Collections</Link>
        <Link href={compareHref}>Compare</Link>
        <Link href="/care">Care</Link>
      </nav>
      <button ref={menuButton} type="button" className="menu-button" onClick={() => setMenu(true)}>
        Menu
      </button>
      <div className="header-right">
        <SearchBox />
        <Link href="/wishlist" className="text-link" aria-label={itemsName("Wishlist", wishlistCount)}>
          Wishlist <span className="count">{wishlistCount}</span>
        </Link>
        {me ? (
          <Link href="/account" className="text-link">
            Account
          </Link>
        ) : (
          <Link href="/sign-in" className="text-link">
            Sign in
          </Link>
        )}
        <button ref={bagRef} type="button" className="text-link bag-button" aria-label={itemsName("Bag", bagCount)} onClick={onBag}>
          Bag <span className="count">{bagCount}</span>
        </button>
      </div>
      <Dialog title="Menu" kind="menu" open={menu} onClose={() => setMenu(false)} openerRef={menuButton}>
        <nav aria-label="Menu links" className="menu-links">
          <Link href="/collections/all" onClick={() => setMenu(false)}>
            Collections
          </Link>
          <Link href={compareHref} onClick={() => setMenu(false)}>
            Compare
          </Link>
          <Link href="/care" onClick={() => setMenu(false)}>
            Care
          </Link>
          <Link href="/wishlist" onClick={() => setMenu(false)} aria-label={itemsName("Wishlist", wishlistCount)}>
            Wishlist <span className="count">{wishlistCount}</span>
          </Link>
          <Link href={me ? "/account" : "/sign-in"} onClick={() => setMenu(false)}>
            {me ? "Account" : "Sign in"}
          </Link>
        </nav>
      </Dialog>
    </header>
  );
}
