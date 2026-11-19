import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useModal } from "../lib/dialog.js";
import { useClientLayoutEffect } from "../lib/layoutEffect.js";
import { Chevron, Cross, Menu as MenuGlyph } from "./Icons.jsx";
import Logo from "./Logo.jsx";

const MENUS = [
  { name: "Product", links: [
    { to: "/connectors", label: "Connector catalog", note: "Every source and destination" },
    { to: "/connector-builder", label: "Connector Builder", note: "Custom HTTP sources in minutes" },
    { to: "/data-replication", label: "Data replication", note: "Incremental syncs you can trust" },
    { to: "/mcp", label: "MCP Server", note: "Let agents query your pipelines" },
  ] },
  { name: "Solutions", links: [
    { to: "/hybrid", label: "Hybrid deployment", note: "Run the data plane yourself" },
    { to: "/context-layer", label: "Context layer", note: "One context for every agent" },
    { to: "/why-open-source", label: "Why open source", note: "Own your context" },
  ] },
  { name: "Resources", links: [
    { to: "/data-engineering-resources", label: "Engineering resources", note: "Guides and field notes" },
    { to: "/compare", label: "Tool comparisons", note: "How the movers differ" },
    { to: "/pricing", label: "Plans and pricing", note: "Usage you can forecast" },
  ] },
];
const HEADER_LINKS = [
  { to: "/connectors", label: "Connectors" },
  { to: "/data-engineering-resources", label: "Docs" },
  { to: "/pricing", label: "Pricing" },
];

function MenuButton({ menu, open, onOpen, onClose }) {
  const wrapper = useRef(null);
  const trigger = useRef(null);
  const focusFirst = useRef(false);
  const focusLink = (index) => {
    const links = [...(wrapper.current?.querySelectorAll(".menu-panel a") ?? [])];
    links[(index + links.length) % links.length]?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!wrapper.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onClose]);

  useClientLayoutEffect(() => {
    if (open && focusFirst.current) {
      focusFirst.current = false;
      focusLink(0);
    }
  }, [open]);

  const openWithFocus = () => {
    focusFirst.current = true;
    if (open) focusLink(0);
    else onOpen();
  };
  const onTriggerKey = (event) => {
    if (["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      openWithFocus();
    }
  };
  const onPanelKey = (event) => {
    const links = [...wrapper.current.querySelectorAll(".menu-panel a")];
    const at = links.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusLink(at + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      trigger.current.focus();
    } else if (event.key === "Tab") {
      // Tab or Shift+Tab moves focus out of the panel (to the trigger or past the last link), which closes it.
      onClose();
    }
  };
  const onBlur = (event) => {
    if (!wrapper.current.contains(event.relatedTarget)) onClose();
  };

  return (
    <div className="menu" ref={wrapper} onBlur={open ? onBlur : undefined}>
      <button
        ref={trigger}
        type="button"
        className="menu-trigger"
        aria-expanded={open}
        aria-controls={`menu-${menu.name}`}
        onClick={(event) => {
          if (event.detail === 0) return;
          if (open) onClose();
          else onOpen();
        }}
        onKeyDown={onTriggerKey}
      >
        {menu.name}
        <Chevron />
      </button>
      {open && (
        <div className="menu-panel" id={`menu-${menu.name}`} onKeyDown={onPanelKey}>
          <ul>
            {menu.links.map((link) => (
              <li key={link.to}>
                <Link to={link.to} onClick={onClose}>{link.label}<span>{link.note}</span></Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Overlay({ onClose }) {
  const close = useRef(null);
  const ref = useModal(true, onClose, close);
  return (
    <dialog ref={ref} className="overlay" aria-label="Menu">
      <div className="overlay-top">
        <Logo />
        <button ref={close} type="button" className="btn btn-outline btn-icon" aria-label="Close menu" onClick={onClose}>
          <Cross width="18" height="18" />
        </button>
      </div>
      <nav className="overlay-groups" aria-label="Site">
        {MENUS.map((menu) => (
          <div key={menu.name}>
            <h2 className="label">{menu.name}</h2>
            <ul>{menu.links.map((link) => <li key={link.to}><Link to={link.to} onClick={onClose}>{link.label}</Link></li>)}</ul>
          </div>
        ))}
        <ul>{HEADER_LINKS.map((link) => <li key={link.label}><Link to={link.to} onClick={onClose}>{link.label}</Link></li>)}</ul>
      </nav>
      <div className="overlay-actions">
        <Link to="/signin" className="btn btn-quiet" onClick={onClose}>Sign in</Link>
        <Link to="/pricing" className="btn btn-outline" onClick={onClose}>Talk to sales</Link>
        <Link to="/login" className="btn btn-primary" onClick={onClose}>Try it free</Link>
      </div>
    </dialog>
  );
}

export default function Header() {
  const [openMenu, setOpenMenu] = useState(null);
  const [overlay, setOverlay] = useState(false);
  const closeOverlay = () => setOverlay(false);
  // From 992 CSS pixels the header links are inline, so an open overlay closes and leaves nothing inert.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 992px)");
    const change = () => {
      if (media.matches) setOverlay(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return (
    <header className="site-header">
      <div className="header-card">
        <Logo />
        <nav className="header-nav" aria-label="Main">
          {MENUS.map((menu) => (
            <MenuButton key={menu.name} menu={menu} open={openMenu === menu.name}
              onOpen={() => setOpenMenu(menu.name)} onClose={() => setOpenMenu((m) => (m === menu.name ? null : m))} />
          ))}
          {HEADER_LINKS.map((link) => <Link key={link.label} to={link.to} className="nav-link">{link.label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link to="/signin" className="nav-link">Sign in</Link>
          <Link to="/pricing" className="btn btn-outline">Talk to sales</Link>
          <Link to="/login" className="btn btn-primary">Try it free</Link>
        </div>
        <button type="button" className="btn btn-outline menu-button" onClick={() => setOverlay(true)}>
          <MenuGlyph width="18" height="18" /> Menu
        </button>
      </div>
      {overlay && <Overlay onClose={closeOverlay} />}
    </header>
  );
}
