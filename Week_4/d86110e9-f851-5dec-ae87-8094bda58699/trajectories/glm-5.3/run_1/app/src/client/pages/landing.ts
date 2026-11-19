// Signed-out landing: release bar, pill nav (in the shell), letter-built
// headline, preview frame with three example tabs, step-kind cards, story
// cards and the footer (in the shell).

import { h } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { navigate } from "../runtime";
import type { Me } from "../runtime";

const HEADLINE_LINE1 = "Draft in peace.";
const HEADLINE_LINE2 = "Publish with eyes open.";

export function Landing(p: { me: Me | null }): VNode {
  const [letters, setLetters] = useState<{ char: string; done: boolean }[]>([]);
  const [tab, setTab] = useState(0);
  const [headlineDone, setHeadlineDone] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const all = (HEADLINE_LINE1 + "\n" + HEADLINE_LINE2).split("");
    if (mq.matches) {
      setLetters(all.map((char) => ({ char, done: true })));
      setHeadlineDone(true);
      return;
    }
    // letters rise in four snapped steps, ~30ms apart, driven by
    // animationend events (no timers)
    let i = 0;
    setLetters([]);
    const step = () => {
      if (i >= all.length) {
        setTimeout(() => setHeadlineDone(true), 600);
        return;
      }
      const next = all[i];
      i++;
      setLetters((prev) => [...prev, { char: next, done: false }]);
      window.setTimeout(step, 30);
    };
    step();
  }, []);

  const onLetterEnd = (i: number) => {
    setLetters((prev) => prev.map((l, idx) => idx === i ? { ...l, done: true } : l));
  };

  const text = HEADLINE_LINE1 + " " + HEADLINE_LINE2;

  return h("div", { class: "landing" },
    h("section", { class: "release-bar", role: "region", "aria-label": "Release notice" },
      h("p", {}, "Runs stay on the version they started on. "),
      h("a", { class: "link-action", href: "#preview", onClick: (e: Event) => { e.preventDefault(); document.getElementById("preview")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); } }, "Learn more")),
    h("section", { class: "hero" },
      h("h1", { class: "hero-headline", "aria-label": text, "data-built": headlineDone ? "true" : "false" },
        reduced
          ? h("span", { class: "hero-line-static" }, HEADLINE_LINE1 + " " + HEADLINE_LINE2)
          : letters.map((l, i) => h("span", {
              key: i,
              class: l.done ? "hero-letter done" : "hero-letter",
              onAnimationEnd: () => onLetterEnd(i),
              "data-char": l.char === " " ? "space" : l.char,
            }, l.char === "\n" ? "" : l.char)),
        h("span", { class: "visually-hidden" }, text)),
      h("p", { class: "hero-sub" }, "Wire forms, schedules, webhooks and tables into automations. Test them, publish numbered versions, and replay any failed run."),
      h("div", { class: "hero-actions" },
        p.me
          ? h("a", { class: "pill-btn pill-primary", href: "#", onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${p.me!.workspaces[0]?.id ?? ""}`); } }, "Open workspace")
          : h("a", { class: "pill-btn pill-primary", href: "/sign-up", onClick: (e: Event) => { e.preventDefault(); navigate("/sign-up"); } }, "Create a workspace"),
        h("a", { class: "pill-btn pill-secondary", href: "/sign-in", onClick: (e: Event) => { e.preventDefault(); navigate("/sign-in"); } }, "Sign in"))),
    h("section", { id: "preview", class: "preview-frame", "aria-label": "Example automations" },
      headlineDone
        ? h("div", { class: "preview-diagram" }, h(ExampleDiagram, { tab }))
        : h("div", { class: "preview-skeleton", "aria-hidden": "true" }),
      h("div", { role: "tablist", class: "preview-tabs", "aria-label": "Example automations" },
        ["Form to table row", "Schedule to email", "Webhook to loop"].map((label, i) => h("button", {
          key: label,
          role: "tab",
          class: "preview-tab" + (i === tab ? " active" : ""),
          "aria-selected": i === tab ? "true" : "false",
          tabIndex: headlineDone ? (i === tab ? 0 : -1) : -1,
          disabled: !headlineDone,
          onClick: () => setTab(i),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") { e.preventDefault(); setTab((t) => (t + 1) % 3); }
            if (e.key === "ArrowLeft") { e.preventDefault(); setTab((t) => (t + 2) % 3); }
          },
        }, label)),
        [0, 1, 2].map((i) => h("div", {
          key: "tp" + i, role: "tabpanel", class: "preview-panel" + (i === tab ? " shown" : ""),
          "aria-label": ["Form to table row", "Schedule to email", "Webhook to loop"][i],
        }, i === tab ? h(ExampleDiagram, { tab: i }) : null)))),
    h("section", { class: "kind-cards", role: "region", "aria-label": "Step kinds" },
      [
        { t: "Triggers", b: "Forms, schedules, webhooks, table rows and manual starts." },
        { t: "Logic and waiting", b: "Filters, branches and loops, plus waits on the server clock." },
        { t: "Tables", b: "Add and update rows in built-in tables with typed columns." },
        { t: "Mail and webhooks", b: "Send email through the mail server and call your own hooks." },
      ].map((c) => h("article", { class: "kind-card" },
        h("div", { class: "kind-icon", "aria-hidden": "true" }, h("span", { class: "kpx kpx-1" }), h("span", { class: "kpx kpx-2" }), h("span", { class: "kpx kpx-3" }), h("span", { class: "kpx kpx-4" })),
        h("h3", {}, c.t),
        h("p", {}, c.b)))),
    h("section", { class: "story-cards", role: "region", "aria-label": "Automation stories" },
      [
        { company: "Cobalt Studio", headline: "Order intakes without the 2am check", quote: "We publish a version, and every in-flight run finishes on the one it started on.", name: "Mara Voss", role: "Operations lead" },
        { company: "Harbor Bakery", headline: "Schedules that survive daylight saving", quote: "The server clock decides. Our board shows the times in our own zone.", name: "Jonah Pike", role: "Finance manager" },
        { company: "Lumen Print", headline: "A failed run is a detour, not a cliff", quote: "We replay from the failed step and nothing sends twice.", name: "Ines Kaur", role: "Support lead" },
      ].map((s) => h("article", { class: "story-card" },
        h("p", { class: "story-brand", "aria-hidden": "true" }, h("span", { class: "spx" }), h("span", { class: "spx spx-2" }), h("span", { class: "spx spx-3" })),
        h("p", { class: "story-company" }, s.company),
        h("h3", { class: "story-head" }, s.headline),
        h("blockquote", { class: "story-quote" }, `"${s.quote}"`),
        h("p", { class: "story-name" }, `${s.name}, ${s.role}`)))));
}

function ExampleDiagram(p: { tab: number }): VNode {
  const node = (x: number, y: number, label: string, sub: string) => h("g", { transform: `translate(${x},${y})` },
    h("rect", { class: "ex-node", width: 56, height: 56, rx: 10 }),
    h("text", { class: "ex-node-text", x: 28, y: 34, "text-anchor": "middle" }, label),
    h("text", { class: "ex-node-sub", x: 28, y: 74, "text-anchor": "middle" }, sub));
  const edge = (x1: number, y1: number, x2: number, y2: number) => h("path", {
    class: "ex-edge", d: `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`,
  });
  if (p.tab === 0) {
    return h("svg", { viewBox: "0 0 520 140", class: "ex-svg", "aria-hidden": "true" },
      edge(60, 60, 150, 60), edge(206, 60, 296, 60), edge(352, 60, 442, 60),
      node(30, 32, "F", "Form"), node(150, 32, "S", "Set values"), node(296, 32, "T", "Table row"), node(442, 32, "M", "Mail"));
  }
  if (p.tab === 1) {
    return h("svg", { viewBox: "0 0 520 140", class: "ex-svg", "aria-hidden": "true" },
      edge(60, 60, 170, 60), edge(226, 60, 336, 60), edge(392, 60, 460, 60),
      node(30, 32, "C", "Clock"), node(170, 32, "W", "Wait"), node(336, 32, "S", "Set values"), node(430, 32, "M", "Mail"));
  }
  return h("svg", { viewBox: "0 0 520 140", class: "ex-svg", "aria-hidden": "true" },
    edge(60, 60, 160, 60), edge(216, 60, 316, 60), edge(372, 40, 440, 40), edge(372, 80, 440, 80),
    node(30, 32, "H", "Hook"), node(160, 32, "L", "Loop"), node(316, 32, "R", "Table"), node(430, 12, "+", "Add row"));
}
