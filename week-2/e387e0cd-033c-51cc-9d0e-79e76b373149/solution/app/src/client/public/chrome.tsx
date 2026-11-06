// The public pages' chrome: the header with its two keyboard menus, the procedural network band and the stats band.
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { EASE, reducedMotion, STATE_MS } from "../hooks";
import { Link, navigate } from "../router";
import { Icon } from "../ui/Icon";
import type { Jurisdiction } from "../types";

export const REGION_LABELS: Record<string, string> = {
  europe: "Europe",
  asia_pacific: "Asia Pacific",
  middle_east: "Middle East",
  americas: "Americas",
  africa: "Africa",
};

export const STATUS_LABELS: Record<Jurisdiction["status"], string> = {
  in_force: "In force",
  announced: "Announced",
  no_rule: "No rule",
};

/** Scrolls to a section of the home page and moves focus to its heading; from another page it opens the home page. */
function goToSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) {
    navigate(`/#${id}`);
    return;
  }
  target.scrollIntoView({ behavior: "instant", block: "start" });
  target.focus({ preventScroll: true });
}

interface MenuItem {
  label: string;
  run: () => void;
}

/** A header menu button: Enter, Space or ArrowDown opens it below the button and focuses the first item. */
function HeaderMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const buttonId = useId();

  const entries = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    entries()[0]?.focus();
    if (!reducedMotion()) {
      menu.current.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: STATE_MS, easing: EASE });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const list = entries();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div class="menu" ref={wrap}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        class="button button-quiet menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (open) entries()[0]?.focus();
            else setOpen(true);
          }
        }}
      >
        <span>{label}</span>
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <ul ref={menu} role="menu" aria-labelledby={buttonId} class="menu-list" onKeyDown={onMenuKey}>
          {items.map((item) => (
            <li role="none" key={item.label}>
              <button type="button" role="menuitem" tabIndex={-1} class="menu-item" onClick={() => {
                close(false);
                item.run();
              }}>{item.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PublicHeader() {
  return (
    <header class="public-header">
      <Link href="/" class="public-wordmark" aria-label="Lanternline home">
        <svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <path d="M12 3.5v-2M12 22.5v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span class="public-wordmark-text">Lanternline</span>
      </Link>
      <nav class="public-menus" aria-label="Site">
        <HeaderMenu label="Directory" items={[
          { label: "Jurisdictions", run: () => goToSection("jurisdictions") },
          { label: "Listed exchanges", run: () => goToSection("listed-exchanges") },
        ]} />
        <HeaderMenu label="Desk" items={[
          { label: "How it works", run: () => goToSection("how-it-works") },
          { label: "Sign in", run: () => navigate("/sign-in") },
        ]} />
      </nav>
    </header>
  );
}

/** Deterministic pseudo-random numbers, so the band is the same drawing on every visit. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface NetworkNode {
  x: number;
  y: number;
  r: number;
  label: string;
  hub: boolean;
}

const BAND_W = 1200;
const BAND_H = 260;
const NODE_LABELS = ["LT", "EE", "IE", "DE", "MT", "CH", "GB", "SG", "HK", "AE", "TH", "PA", "SC"];

function drawNetwork() {
  const random = seeded(20271104);
  const nodes: NetworkNode[] = NODE_LABELS.map((label, i) => {
    const column = i % 7;
    const row = Math.floor(i / 7);
    return {
      x: 90 + column * 170 + (row ? 85 : 0) + (random() - 0.5) * 70,
      y: 70 + row * 120 + (random() - 0.5) * 50,
      r: 7 + random() * 5,
      label,
      hub: false,
    };
  });
  nodes.push({ x: 640, y: 135, r: 18, label: "", hub: true });
  const edges = new Map<string, [number, number]>();
  nodes.forEach((node, i) => {
    const nearest = nodes
      .map((other, j) => ({ j, d: (other.x - node.x) ** 2 + (other.y - node.y) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of nearest) edges.set([Math.min(i, j), Math.max(i, j)].join("-"), [Math.min(i, j), Math.max(i, j)]);
  });
  [2, 5, 7, 9, 11].forEach((i) => edges.set(`${i}-13`, [i, 13]));
  const connectors = [...edges.values()];
  const packets = connectors
    .filter((_, i) => i % 2 === 0)
    .map(([a, b], i) => {
      const [from, to] = i % 3 === 0 ? [nodes[b], nodes[a]] : [nodes[a], nodes[b]];
      return { from, to, delay: Math.round(random() * 640) };
    });
  return { nodes, connectors, packets };
}

const NETWORK = drawNetwork();

/** The full-width band: exchanges as nodes joined by connectors, packets travelling one 640 ms pass per loop. */
export function NetworkBand({ children, compact = false }: { children?: ComponentChildren; compact?: boolean }) {
  return (
    <section id="how-it-works" tabIndex={-1} class={`band${compact ? " band-compact" : ""}`} aria-label="How it works">
      <svg class="band-art" role="img" aria-label="Lanternline network" viewBox={`0 0 ${BAND_W} ${BAND_H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="band-hub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#a8c6ff" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#a8c6ff" stop-opacity="0" />
          </radialGradient>
        </defs>
        <g class="band-connectors">
          {NETWORK.connectors.map(([a, b]) => (
            <line key={`${a}-${b}`} x1={NETWORK.nodes[a].x} y1={NETWORK.nodes[a].y} x2={NETWORK.nodes[b].x} y2={NETWORK.nodes[b].y}
              class={NETWORK.nodes[b].hub ? "connector connector-hub" : "connector"} />
          ))}
        </g>
        <g class="band-packets">
          {NETWORK.packets.map((p, i) => (
            <circle key={i} class="packet" r="3" cx="0" cy="0" style={{
              "--x1": `${p.from.x.toFixed(1)}px`, "--y1": `${p.from.y.toFixed(1)}px`,
              "--x2": `${p.to.x.toFixed(1)}px`, "--y2": `${p.to.y.toFixed(1)}px`, animationDelay: `-${p.delay}ms`,
            }} />
          ))}
        </g>
        <g class="band-nodes">
          {NETWORK.nodes.map((n) => n.hub ? (
            <g key="hub">
              <circle cx={n.x} cy={n.y} r={n.r * 3} fill="url(#band-hub)" />
              <circle cx={n.x} cy={n.y} r={n.r} class="node node-hub" />
              <circle cx={n.x} cy={n.y} r={n.r - 9} class="node-core" />
            </g>
          ) : (
            <g key={n.label}>
              <circle cx={n.x} cy={n.y} r={n.r} class="node" />
              <circle cx={n.x} cy={n.y} r={2.2} class="node-core" />
              <text x={n.x} y={n.y + n.r + 15} class="node-label" text-anchor="middle">{n.label}</text>
            </g>
          ))}
        </g>
      </svg>
      {children && <div class="band-copy">{children}</div>}
    </section>
  );
}

/** One figure: its digits roll once into the final value; assistive technology always reads the final value. */
function Figure({ value, label }: { value: number; label: string }) {
  const digits = String(value).split("");
  return (
    <p class="figure">
      <span class="figure-value fig" aria-hidden="true">
        {digits.map((d, i) => (
          <span class="digit" key={i}>
            <span class="digit-strip" style={{ "--d": d }}>
              {"0123456789".split("").map((n) => <span key={n}>{n}</span>)}
            </span>
          </span>
        ))}
      </span>
      <span class="figure-label" aria-hidden="true">{label}</span>
      <span class="sr-only">{`${value} ${label}`}</span>
    </p>
  );
}

export interface Stats {
  jurisdictions: number;
  rulesInForce: number;
  listedExchanges: number;
}

export function StatsBand({ stats }: { stats: Stats | null }) {
  return (
    <section class="stats" aria-label="Network figures">
      {stats && (
        <>
          <Figure value={stats.jurisdictions} label="jurisdictions tracked" />
          <Figure value={stats.rulesInForce} label="rules in force" />
          <Figure value={stats.listedExchanges} label="listed exchanges" />
        </>
      )}
    </section>
  );
}

function PublicFooter() {
  return (
    <footer class="public-footer">
      <p>Lanternline Handshake Desk. Every rule, exchange and address shown here is illustrative.</p>
    </footer>
  );
}

/** Header, then the page; the band is part of the pages that show it. */
export function PublicPage({ children }: { children: ComponentChildren }) {
  return (
    <div class="public">
      <PublicHeader />
      <main id="main" class="public-main">{children}</main>
      <PublicFooter />
    </div>
  );
}
