// The public and staff top bars, the Categories menu, the Menu sheets and the live region.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu as MenuIcon, X } from "lucide-react";
import type { SessionBody } from "../../shared/api";
import { CATEGORIES } from "../../shared/catalog";
import { request } from "../api";
import { useDialog, useMedia, useOverlayPhase } from "../hooks";
import { announce, navigate, rememberPlace, useAddress, useAnnouncement } from "../state";
import { Dialog } from "./Dialog";
import { Garment } from "./Garment";
import { Button, Link } from "./kit";

export function Announcements() {
  const { text, signIn } = useAnnouncement();
  return (
    <div className="announcements" role="status" aria-label="Announcements">
      {text}
      {signIn && (
        <>
          {" "}
          <a
            href="/sign-in"
            onClick={(event) => {
              event.preventDefault();
              rememberPlace();
              navigate("/sign-in");
            }}
          >
            Sign in again
          </a>
        </>
      )}
    </div>
  );
}

function CategoriesMenu() {
  const [open, setOpen] = useState(false);
  const { mounted, closing, onAnimationEnd } = useOverlayPhase(open);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (returnFocus: boolean): void => {
      setOpen(false);
      if (returnFocus) button.current?.focus();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="categories">
      <button ref={button} type="button" className="bar-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Categories
        <ChevronDown aria-hidden="true" size={18} />
      </button>
      {mounted && (
        <nav
          ref={panel}
          className={`mega${closing ? " closing" : ""}`}
          aria-label="Categories"
          inert={closing}
          onAnimationEnd={(event) => {
            if (event.target === panel.current && closing) onAnimationEnd();
          }}
        >
          <ul>
            {CATEGORIES.map((category) => (
              <li key={category.value}>
                <Link to={`/?category=${category.value}`} className="mega-tile" onClick={() => setOpen(false)}>
                  <Garment category={category.value} />
                  <span>{category.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function PublicMenu() {
  const menu = useDialog("Menu");
  return (
    <>
      <button
        ref={(element) => {
          menu.opener.current = element;
        }}
        type="button"
        className="bar-button"
        onClick={menu.open}
      >
        <MenuIcon aria-hidden="true" size={20} /> Menu
      </button>
      <Dialog control={menu} variant="sheet-bottom">
        <div className="sheet-body">
          <ul className="menu-links">
            {CATEGORIES.map((category) => (
              <li key={category.value}>
                <Link to={`/?category=${category.value}`} onClick={() => menu.close({ returnFocus: false })}>
                  {category.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/appointments" onClick={() => menu.close({ returnFocus: false })}>
                Book an intake slot
              </Link>
            </li>
          </ul>
        </div>
        <div className="dialog-foot">
          <Button onClick={() => menu.close()}>
            <X aria-hidden="true" size={18} /> Close menu
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function PublicBar({ plain = false }: { plain?: boolean }) {
  const narrow = useMedia("(max-width: 767px)");
  return (
    <header className="top-bar">
      <Link to="/" className="wordmark">
        Atelier Ourlet
      </Link>
      {!plain && (narrow ? <PublicMenu /> : (
        <>
          <CategoriesMenu />
          <Link to="/appointments" className="bar-link">
            Book an intake slot
          </Link>
        </>
      ))}
    </header>
  );
}

type Member = SessionBody["member"];

const STAFF_LINKS: { to: string; label: string; roles: readonly Member["role"][] }[] = [
  { to: "/staff/pieces", label: "Pieces", roles: ["owner", "assistant"] },
  { to: "/staff/till", label: "Till", roles: ["owner", "assistant"] },
  { to: "/staff/holds", label: "Holds", roles: ["owner", "assistant"] },
  { to: "/staff/appointments", label: "Appointments", roles: ["owner", "assistant"] },
  { to: "/staff/consignors", label: "Consignors", roles: ["owner", "assistant"] },
  { to: "/staff/ladder", label: "Ladder", roles: ["owner"] },
  { to: "/staff/payouts", label: "Payouts", roles: ["owner", "bookkeeper"] },
  { to: "/staff/import", label: "Old spreadsheet", roles: ["owner"] },
  { to: "/staff/sales-book", label: "Sales book", roles: ["owner", "bookkeeper"] },
  { to: "/staff/members", label: "Members", roles: ["owner"] },
];

function StaffLinks({ member, onFollow }: { member: Member; onFollow?: () => void }) {
  const { pathname } = useAddress();
  return (
    <nav className="staff-links" aria-label="Staff">
      {STAFF_LINKS.filter((link) => link.roles.includes(member.role)).map((link) => (
        <Link key={link.to} to={link.to} aria-current={pathname.startsWith(link.to) ? "page" : undefined} {...(onFollow ? { onClick: onFollow } : {})}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function SignOut() {
  const signOut = async (): Promise<void> => {
    await request("/api/session", { method: "DELETE", quiet: true }).catch(() => undefined);
    announce("");
    navigate("/sign-in");
  };
  return (
    <button type="button" className="bar-button" onClick={() => void signOut()}>
      <LogOut aria-hidden="true" size={18} /> Sign out
    </button>
  );
}

function StaffMenu({ member }: { member: Member }) {
  const menu = useDialog("Menu");
  return (
    <>
      <button
        ref={(element) => {
          menu.opener.current = element;
        }}
        type="button"
        className="bar-button"
        onClick={menu.open}
      >
        <MenuIcon aria-hidden="true" size={20} /> Menu
      </button>
      <Dialog control={menu} variant="sheet-bottom">
        <div className="sheet-body">
          <StaffLinks member={member} onFollow={() => menu.close({ returnFocus: false })} />
          <SignOut />
        </div>
        <div className="dialog-foot">
          <Button onClick={() => menu.close()}>
            <X aria-hidden="true" size={18} /> Close menu
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function StaffBar({ member }: { member: Member }) {
  const narrow = useMedia("(max-width: 767px)");
  return (
    <header className="top-bar staff">
      <Link to="/" className="wordmark">
        Atelier Ourlet
      </Link>
      {narrow ? (
        <StaffMenu member={member} />
      ) : (
        <>
          <StaffLinks member={member} />
          <SignOut />
        </>
      )}
    </header>
  );
}

/** A screen's main action: in its place on wide screens, in a bar fixed to the bottom edge at 375 pixels. */
export function MainAction({ children }: { children: ReactNode }) {
  return <div className="main-action">{children}</div>;
}
