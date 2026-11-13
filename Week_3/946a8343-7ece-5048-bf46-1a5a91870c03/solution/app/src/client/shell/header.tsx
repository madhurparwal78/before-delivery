// `banner`: the sticky group switcher header.
//   desk/tablet  wordmark link `Spurline home`, `button "Switch group"` (opens `dialog "Groups"`, the chevron turns over in
//                180 ms), `searchbox "Search"`, `button "Account"` (popover: username, Profile time zone, Sign out)
//   phone        wordmark centred, `button "Menu"` at right; the menu dialog holds the same actions
//   signed out   wordmark only
// data-mode: "ground" (solid, every page except the project home), "hero" (see-through over the project hero) and "light"
// (the light band with dark ink, once the hero has scrolled away). The hero is the element marked `data-hero`; the header
// listens to scroll and layout changes (no timers) and the colour change itself is a 320 ms CSS transition.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Dialog } from "../a11y/dialog.tsx";
import { PHONE_QUERY, useMediaQuery } from "../hooks.ts";
import { A, useRoute } from "../router.ts";
import { useUser } from "../session.ts";
import { Button } from "../ui/button.tsx";
import { Icon, StaircaseGlyph } from "../ui/icons.tsx";
import { AccountPanel } from "./account.tsx";
import { GroupsDialog } from "./groups-dialog.tsx";
import { SearchForm } from "./search-form.tsx";

function useHeroGone(active: boolean, header: { current: HTMLElement | null }): boolean {
  const [gone, setGone] = useState(false);
  useLayoutEffect(() => {
    if (!active) {
      setGone(false);
      return;
    }
    const measure = () => {
      const hero = document.querySelector("[data-hero]");
      const height = header.current?.offsetHeight ?? 64;
      setGone(hero !== null && hero.getBoundingClientRect().bottom <= height);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new MutationObserver(measure);
    observer.observe(document.getElementById("app") ?? document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [active]);
  return gone;
}

function Wordmark() {
  return (
    <A href="/" class="sp-wordmark" aria-label="Spurline home">
      <StaircaseGlyph size={22} />
      <span class="sp-wordmark__text">Spurline</span>
    </A>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLElement>("select, button")?.focus();
    const away = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !popover.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    const focusMoved = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && !popover.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focusMoved);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focusMoved);
    };
  }, [open]);
  return (
    <div class="sp-account">
      <button ref={button} type="button" class="sp-header__button" aria-haspopup="true" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}>
        <Icon name="user" size={20} />
        <span>Account</span>
      </button>
      {open ? (
        <div ref={popover} role="group" aria-label="Account menu" class="sp-popover">
          <AccountPanel onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function PhoneMenu({ open, onClose, opener, onSwitchGroup }: { open: boolean; onClose: () => void; opener: { current: HTMLElement | null }; onSwitchGroup: () => void }) {
  const [account, setAccount] = useState(false);
  return (
    <Dialog name="Menu" open={open} onClose={onClose} opener={opener} class="sp-menu">
      <div class="sp-dialog__bar">
        <h2 class="sp-dialog__title">Menu</h2>
        <Button variant="ghost" class="sp-dialog__close" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </Button>
      </div>
      <SearchForm onSubmitted={onClose} />
      <button type="button" class="sp-menu__item" onClick={onSwitchGroup}>
        <span>Switch group</span>
        <Icon name="chevron-right" size={20} />
      </button>
      <button type="button" class="sp-menu__item" aria-expanded={account ? "true" : "false"} onClick={() => setAccount(!account)}>
        <span>Account</span>
        <Icon name="chevron-down" size={20} class={`sp-chevron${account ? " sp-chevron--open" : ""}`} />
      </button>
      {account ? <AccountPanel onDone={onClose} /> : null}
    </Dialog>
  );
}

export function Header({ signedOut }: { signedOut: boolean }) {
  const user = useUser();
  const route = useRoute();
  const phone = useMediaQuery(PHONE_QUERY);
  const header = useRef<HTMLElement>(null);
  const switchButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [groups, setGroups] = useState(false);
  const [menu, setMenu] = useState(false);
  const onHome = route.pattern === "/projects/:id";
  const gone = useHeroGone(onHome, header);
  const mode = onHome ? (gone ? "light" : "hero") : "ground";
  const bare = signedOut || !user;
  return (
    <header ref={header} class={`sp-header${mode === "light" ? " sp-light" : ""}`} data-mode={mode}>
      <div class={`sp-header__inner sp-container${bare ? " sp-header__inner--bare" : ""}`}>
        {bare ? (
          <Wordmark />
        ) : phone ? (
          <>
            <span class="sp-header__spacer" />
            <Wordmark />
            <button ref={menuButton} type="button" class="sp-header__button sp-header__menu" aria-haspopup="dialog" onClick={() => setMenu(true)}>
              <Icon name="menu" size={20} />
              <span>Menu</span>
            </button>
            <PhoneMenu
              open={menu}
              opener={menuButton}
              onClose={() => setMenu(false)}
              onSwitchGroup={() => {
                setMenu(false);
                setGroups(true);
              }}
            />
          </>
        ) : (
          <>
            <Wordmark />
            <button ref={switchButton} type="button" class="sp-header__button sp-header__switch" aria-haspopup="dialog" onClick={() => setGroups(true)}>
              <span>Switch group</span>
              <Icon name="chevron-down" size={18} class={`sp-chevron${groups ? " sp-chevron--open" : ""}`} />
            </button>
            <SearchForm />
            <AccountMenu />
          </>
        )}
        <GroupsDialog open={groups} onClose={() => setGroups(false)} opener={phone ? menuButton : switchButton} />
      </div>
    </header>
  );
}
