// The private sign-off page: read the dossier and sign by typing a name.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { UI } from "./copy.js";

interface SignOffPage {
  dossier: {
    id: string;
    state: string;
    styleName: string;
    edition: string;
    dataQualityPercent: number;
    dataQualityGrade: string;
    measures: { measure: string; totalShown: string }[];
    madeAt: string;
    signedOffBy: string | null;
    signedOffAt: string | null;
  };
  endsAt: string;
}

export function registerSignOffScreen(ctx: RouteCtx): (() => void) | void {
  const token = location.pathname.split("/")[2];
  const main = ctx.main;

  async function load(first: boolean): Promise<void> {
    try {
      const out = await api<SignOffPage>(`/api/s/${token}`);
      if (first) build(out);
    } catch (err) {
      const failure = err as { status?: number; body?: { error?: { message?: string } } };
      const message = failure.body?.error?.message ?? `This page has ended.`;
      main.textContent = "";
      main.append(el("h1", {}, message));
      document.title = `${message} \u2014 Fio Contado Desk`;
    }
  }

  function build(out: SignOffPage): void {
    document.title = `Sign off ${out.dossier.styleName} \u2014 Fio Contado Desk`;
    const h1 = el("h1", {}, `Sign off ${out.dossier.styleName}`);
    const facts = el("div", { class: "panel" });
    const measureNames: Record<string, string> = {
      climate: "Climate",
      water: "Water",
      fossilEnergy: "Fossil energy",
      landUse: "Land use",
      freshwaterToxicity: "Freshwater toxicity",
      microfibres: "Microfibres",
    };
    for (const measure of out.dossier.measures) {
      facts.append(el("p", { class: "num" }, `${measureNames[measure.measure] ?? measure.measure}: ${measure.totalShown}`));
    }
    facts.append(el("p", {}, `Factor edition ${out.dossier.edition}`));
    facts.append(el("p", {}, `Data quality ${out.dossier.dataQualityGrade} (${out.dossier.dataQualityPercent}%)`));
    if (out.dossier.signedOffBy) {
      facts.append(el("p", {}, `Signed off by ${out.dossier.signedOffBy}`));
    }
    const readLink = el("a", { href: `/api/s/${token}/file` }, `Read the dossier`);
    readLink.addEventListener("click", () => announce(UI.downloaded));
    const name = el("input", { type: "text", "aria-label": "Your name" });
    const signBtn = el("button", { class: "btn btn-primary" }, "Sign off");
    signBtn.addEventListener("click", async () => {
      await withWorking(signBtn, UI.working, async () => {
        try {
          await api(`/api/s/${token}/sign`, { method: "POST", body: JSON.stringify({ name: name.value }) });
          announce(UI.signedOff(name.value));
          await load(false);
          location.reload();
        } catch (err) {
          const failure = err as { status?: number; body?: { error?: { message?: string } } };
          announce(failure.body?.error?.message ?? `Type your name to sign off.`);
        }
      });
    });
    const bar = el("div", { class: "bottom-bar" });
    bar.append(signBtn.cloneNode(true));
    main.append(h1, facts, readLink, el("label", { class: "field" }, el("span", {}, "Your name"), name), signBtn, bar);
  }

  void load(true);
  const timer = window.setInterval(() => void load(false), 5000);
  return () => window.clearInterval(timer);
}
