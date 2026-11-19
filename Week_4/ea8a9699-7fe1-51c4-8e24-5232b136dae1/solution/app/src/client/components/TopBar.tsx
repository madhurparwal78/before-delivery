// The slim top bar on every screen (brief: Screens and layout; Interactions > Collapsed navigation).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu as MenuIcon, LogOut } from "lucide-react";
import { api } from "../lib/api.js";
import { panel } from "../lib/motion.js";
import { linkClick, navigate, useLocation } from "../lib/router.js";
import { useSession } from "../lib/session.js";
import { useMedia } from "./Masonry.js";

/** The workspace the current address is in, else the account's first. */
function useCurrentSlug(): string | null {
  const { path } = useLocation();
  const { account } = useSession();
  const inPath = /^\/w\/([a-z0-9-]+)/.exec(path)?.[1];
  if (inPath && account?.workspaces.some((w) => w.slug === inPath)) return inPath;
  return account?.workspaces[0]?.slug ?? null;
}

export function TopBar() {
  const { account, setAccount } = useSession();
  const { path } = useLocation();
  const narrow = useMedia("(max-width: 719.98px)");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const nav = useRef<HTMLElement | null>(null);
  const slug = useCurrentSlug();
  const collapsed = narrow && !open;

  useLayoutEffect(() => {
    if (open && nav.current) panel(nav.current, true, -8);
  }, [open]);

  const close = (): void => {
    const el = nav.current;
    const animation = el ? panel(el, false, -8) : null;
    menuButton.current?.focus();
    setOpen(false);
    if (animation) {
      setClosing(true);
      animation.onfinish = () => setClosing(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!narrow) setOpen(false);
  }, [narrow]);

  const go = (event: React.MouseEvent<HTMLAnchorElement>, to: string): void => {
    linkClick(event, to);
    if (narrow && open) close();
  };

  const signOut = async (): Promise<void> => {
    await api("POST", "/api/auth/signout");
    setAccount(null);
    navigate("/signin");
  };

  // The review page offers no way into the workspace (brief: Screens > Review).
  const member = account && account.role !== "follower" && !path.startsWith("/review/");
  const links: Array<{ to: string; label: string; current: boolean }> = [{ to: "/explore", label: "Explore", current: path === "/explore" }];
  if (member && slug) links.push({ to: `/w/${slug}`, label: "Wall", current: path === `/w/${slug}` });
  if (member && account.role === "ops_lead" && slug) links.push({ to: `/w/${slug}/admin`, label: "Admin", current: path.endsWith("/admin") });
  if (account === null) links.push({ to: `/signin`, label: "Sign in", current: path === "/signin" });

  const workspace = account?.workspaces.find((w) => w.slug === slug);
  const switchTo = (next: string): void => {
    const tail = path.endsWith("/admin") ? "/admin" : "";
    navigate(`/w/${next}${tail}`);
  };

  return (
    <header className="topbar">
      <a className="wordmark" href="/" onClick={(e) => linkClick(e, "/")}>
        Rushes
      </a>
      {narrow && (
        <button ref={menuButton} type="button" className="btn btn--quiet topbar__menu" aria-expanded={open} aria-controls="main-nav" onClick={() => {
            if (open) close();
            else {
              setClosing(false);
              setOpen(true);
            }
          }}>
          <MenuIcon size={18} aria-hidden="true" />
          Menu
        </button>
      )}
      <nav id="main-nav" ref={nav} aria-label="Main" className={narrow ? "nav nav--sheet" : "nav"} hidden={collapsed && !closing} inert={collapsed && closing}>
        <ul>
          {links.map((link) => (
            <li key={link.to}>
              <a href={link.to} aria-current={link.current ? "page" : undefined} onClick={(e) => go(e, link.to)}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="topbar__end">
        {member && account.role === "ops_lead" && slug ? (
          <select className="switcher" aria-label="Brand workspace" value={slug} onChange={(e) => switchTo(e.target.value)}>
            {account.workspaces.map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </select>
        ) : (
          member && workspace && <span className="topbar__brand">{workspace.name}</span>
        )}
        {account && (
          <>
            <span className="topbar__who">{account.displayName}</span>
            <button type="button" className="btn btn--quiet" onClick={() => void signOut()}>
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
