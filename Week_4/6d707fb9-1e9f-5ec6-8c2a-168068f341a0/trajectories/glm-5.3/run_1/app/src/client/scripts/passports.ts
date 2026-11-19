// Passports: the desk list with withdrawal, and the public passport in four languages.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd } from "./app.js";
import { STATE_NAMES, UI } from "./copy.js";
import { overlayClose, overlayOpen } from "./overlay.js";

interface PassportRow {
  styleId: string;
  styleName: string;
  gtin: string;
  edition: number;
  state: string;
  publishedAt: string;
  address: string;
}

export function registerPassportsScreen(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Passports");
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  const frame = el("div", { class: "table-frame", role: "region", "aria-label": "Passports table", tabindex: "0" });
  const table = el("table");
  const tbody = el("tbody");
  table.append(el("thead", {}, el("tr", {}, ...["Style", "GTIN", "Edition", "State", "Published", ""].map((x) => el("th", {}, x)))), tbody);
  frame.append(table);
  main.append(h1, refreshLine, frame);

  async function load(): Promise<void> {
    try {
      const out = await api<{ passports: PassportRow[] }>("/api/passports");
      refreshLine.hidden = true;
      tbody.textContent = "";
      const byGtin = new Map<string, PassportRow[]>();
      for (const row of out.passports) {
        const list = byGtin.get(row.gtin) ?? [];
        list.push(row);
        byGtin.set(row.gtin, list);
      }
      for (const [gtin, rows] of byGtin) {
        const newest = rows.reduce((a, b) => (b.edition > a.edition ? b : a));
        for (const row of rows) {
          const tr = el("tr");
          const link = el("a", { href: row.address }, `${row.styleName} edition ${row.edition}`);
          tr.append(
            el("td", {}, link),
            el("td", { class: "num" }, row.gtin),
            el("td", { class: "num" }, String(row.edition)),
            el("td", {}, STATE_NAMES[row.state] ?? row.state),
            el("td", {}, row.publishedAt),
            el("td", {}),
          );
          if (row === newest && row.state === "published") {
            const withdraw = el("button", { class: "btn" }, `Withdraw ${row.styleName}`);
            withdraw.addEventListener("click", () => void openWithdraw(withdraw, row));
            tr.lastElementChild?.append(withdraw);
          }
          tbody.append(tr);
        }
      }
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  async function openWithdraw(opener: HTMLElement, row: PassportRow): Promise<void> {
    const body = overlayOpen({ label: "Withdraw passport", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const withdraw = el("button", { class: "btn btn-primary" }, "Withdraw");
    const keep = el("button", { class: "btn" }, "Keep");
    keep.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("p", {}, `Withdraw ${row.styleName}?`), el("div", { class: "dialog-foot" }, withdraw, keep));
    withdraw.addEventListener("click", async () => {
      await withWorking(withdraw, UI.working, async () => {
        try {
          await api(`/api/styles/${row.styleId}/passport/withdraw`, { method: "POST" });
          announce(UI.withdrawn(row.styleName));
          overlayClose(dialog);
          await load();
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
  }

  void load();
  const timer = window.setInterval(() => void load(), 5000);
  return () => window.clearInterval(timer);
}

interface PublicPassport {
  gtin: string;
  edition: number;
  lang: string;
  styleName: string;
  labelName: string;
  garment: string;
  publishedAt: string;
  correctedOn: string | null;
  factorEdition: string;
  dataQualityPercent: number;
  dataQualityGrade: string;
  scoreShown: string;
  measures: { measure: string; totalShown: string }[];
}

const PASSPORT_LABELS: Record<string, Record<string, string>> = {
  en: {
    label: "Label",
    garment: "Garment",
    footprint: "Footprint",
    score: "Score",
    edition: "Edition",
    factorEdition: "Factor edition",
    dataQuality: "Data quality",
    corrected: "Corrected",
    claimNote: "These figures are published sums. They are not a legal claim.",
    withdrawn: "This passport has been withdrawn.",
  },
};

export function registerPassportScreen(ctx: RouteCtx): void {
  const main = ctx.main;
  const parts = location.pathname.split("/");
  const gtin = parts[2];
  const edition = parts[4] ? Number.parseInt(parts[4], 10) : undefined;
  const lang = ctx.params.get("lang") ?? "en";

  const langNav = el("nav", { class: "language-links", "aria-label": "Language" });
  for (const [code, name] of [["en", "English"], ["fr", "Fran\u00E7ais"], ["tr", "T\u00FCrk\u00E7e"], ["ar", "\u0627\u0644\u0639\u0631\u0628\u064A\u0629"]] as [string, string][]) {
    const href = edition !== undefined ? `/p/${gtin}/e/${edition}?lang=${code}` : `/p/${gtin}?lang=${code}`;
    langNav.append(el("a", { href, "aria-current": code === lang ? "true" : undefined }, name));
  }
  main.append(langNav);

  void api<PublicPassport>(
    `/api/passports/${gtin}${edition !== undefined ? `/editions/${edition}` : ""}?lang=${lang}`,
  )
    .then((passport) => {
      const labels = PASSPORT_LABELS.en;
      const h1 = el("h1", {}, passport.styleName);
      main.append(h1);
      const rows: [string, string][] = [
        [labels.label, passport.labelName],
        [labels.garment, garmentName(passport.garment)],
      ];
      const facts = el("div", { class: "panel" });
      for (const [label, value] of rows) {
        facts.append(el("p", {}, el("strong", {}, `${label}: `), value));
      }
      facts.append(el("h2", {}, labels.footprint));
      for (const measure of passport.measures) {
        facts.append(el("p", { class: "passport-figure num" }, `${measureName(measure.measure, lang)}: ${measure.totalShown}`));
      }
      facts.append(el("h2", {}, labels.score));
      facts.append(el("p", { class: "num" }, passport.scoreShown));
      facts.append(el("p", {}, `${labels.factorEdition} ${passport.factorEdition}`));
      facts.append(el("p", {}, `${labels.dataQuality} ${passport.dataQualityGrade} (${passport.dataQualityPercent}%)`));
      facts.append(el("p", {}, `${labels.edition} ${passport.edition}`));
      if (passport.correctedOn) {
        facts.append(el("p", {}, `${labels.corrected} ${passport.correctedOn}`));
      }
      facts.append(el("p", { class: "hint" }, labels.claimNote));
      main.append(facts);
    })
    .catch((err) => {
      const failure = err as { status?: number };
      const h1 = el("h1", {}, failure.status === 410 ? `This passport has been withdrawn.` : `We couldn't find that page.`);
      main.append(h1);
      if (failure.status === 410) {
        document.title = `This passport has been withdrawn. \u2014 Fio Contado Desk`;
      }
    });
}

function garmentName(id: string): string {
  const names: Record<string, string> = { tshirt: "T-shirt", shirt: "Shirt", jeans: "Jeans", coat: "Coat" };
  return names[id] ?? id;
}

function measureName(measure: string, lang: string): string {
  const names: Record<string, string> = {
    climate: "Climate",
    water: "Water",
    fossilEnergy: "Fossil energy",
    landUse: "Land use",
    freshwaterToxicity: "Freshwater toxicity",
    microfibres: "Microfibres",
  };
  return names[measure] ?? measure;
}
