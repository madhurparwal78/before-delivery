import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon, Logo } from "../components/Icon";
import { useFocusTrap, useViewportWidth } from "../lib/hooks";

interface MenuDefinition {
  label: string;
  links: { label: string; to: string }[];
}

const MENUS: MenuDefinition[] = [
  {
    label: "Product",
    links: [
      { label: "Data replication", to: "/data-replication" },
      { label: "Connector Builder", to: "/connector-builder" },
      { label: "Context layer", to: "/context-layer" },
      { label: "MCP server", to: "/mcp" },
    ],
  },
  {
    label: "Solutions",
    links: [
      { label: "Hybrid deployment", to: "/hybrid" },
      { label: "Compare the tools", to: "/compare" },
      { label: "Why open source", to: "/why-open-source" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Data engineering resources", to: "/data-engineering-resources" },
      { label: "Connector catalog", to: "/connectors" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
];

const HEADER_LINKS = [
  { label: "Connectors", to: "/connectors" },
  { label: "Docs", to: "/data-engineering-resources" },
  { label: "Pricing", to: "/pricing" },
];

function Menu({
  menu,
  open,
  setOpen,
}: {
  menu: MenuDefinition;
  open: boolean;
  setOpen: (open: boolean) => void;
}): JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!shell.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, setOpen]);

  const links = () => Array.from(shell.current?.querySelectorAll<HTMLAnchorElement>(".menu-panel a") ?? []);

  const focusLink = (index: number) => {
    const all = links();
    if (all.length === 0) return;
    const target = all[(index + all.length) % all.length];
    target.focus();
  };

  return (
    <div className="menu-shell" ref={shell}>
      <button
        type="button"
        className="header-link"
        ref={trigger}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
            window.setTimeout(() => focusLink(0), 0);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {menu.label}
        <Icon name="chevron" />
      </button>
      {open ? (
        <div
          className="menu-panel"
          onKeyDown={(event) => {
            const all = links();
            const index = all.indexOf(document.activeElement as HTMLAnchorElement);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusLink(index + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              focusLink(index - 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {menu.links.map((link) => (
            <Link key={link.to} to={link.to} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Overlay({ onClose }: { onClose: () => void }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useFocusTrap(true, panel);
  useEffect(() => {
    close.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Menu" ref={panel}>
      <button type="button" className="button outline" ref={close} onClick={onClose}>
        <Icon name="cross" />
        Close menu
      </button>
      {MENUS.flatMap((menu) => menu.links).map((link) => (
        <Link key={link.to} to={link.to} className="header-link" onClick={onClose}>
          {link.label}
        </Link>
      ))}
      {HEADER_LINKS.map((link) => (
        <Link key={link.label} to={link.to} className="header-link" onClick={onClose}>
          {link.label}
        </Link>
      ))}
      <Link to="/login" className="header-link" onClick={onClose}>
        Sign in
      </Link>
      <Link to="/compare" className="button outline" onClick={onClose}>
        Talk to sales
      </Link>
      <Link to="/login" className="button" onClick={onClose}>
        Try it free
      </Link>
    </div>
  );
}

export function Header(): JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const width = useViewportWidth();
  const narrow = width < 992;

  const closeOverlay = () => {
    setOverlayOpen(false);
    window.setTimeout(() => menuButton.current?.focus(), 0);
  };

  useEffect(() => {
    if (!narrow) setOverlayOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (overlayOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [overlayOpen]);

  return (
    <>
      <header className="site-header">
        <Link to="/" className="logo">
          <Logo />
        </Link>
        {narrow ? (
          <div className="header-actions" style={{ marginLeft: "auto" }}>
            <button
              type="button"
              className="button outline"
              ref={menuButton}
              onClick={() => setOverlayOpen(true)}
            >
              <Icon name="lines" />
              Menu
            </button>
          </div>
        ) : (
          <>
            <div className="header-center">
              {MENUS.map((menu) => (
                <Menu
                  key={menu.label}
                  menu={menu}
                  open={openMenu === menu.label}
                  setOpen={(open) => setOpenMenu(open ? menu.label : null)}
                />
              ))}
              {HEADER_LINKS.map((link) => (
                <Link key={link.label} to={link.to} className="header-link">
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="header-actions">
              <Link to="/login" className="header-link">
                Sign in
              </Link>
              <Link to="/compare" className="button outline">
                Talk to sales
              </Link>
              <Link to="/login" className="button">
                Try it free
              </Link>
            </div>
          </>
        )}
      </header>
      {overlayOpen ? <Overlay onClose={closeOverlay} /> : null}
    </>
  );
}
