import { api, announce, qs, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { mintTile } from "./pieces.js";

type Rate = { takesEffectOn: string; eur: string; gbp: string; usd: string; jpy: string; aed: string };

export async function installRates(root: HTMLElement): Promise<void> {
  const load = async (): Promise<void> => {
    const { rates } = await api<{ rates: Rate[] }>("/api/rates");
    const { session } = await api<{ session: { today: string } }>("/api/session");
    const today = rates.filter((r) => r.takesEffectOn <= session.today).slice(-1)[0] ?? rates[0];
    root.innerHTML = `<div class="bento">
      <div class="tile wide">
        <div class="table-frame" tabindex="0" role="region" aria-label="Rates table">
          <table><thead><tr><th>From</th><th>EUR</th><th>GBP</th><th>USD</th><th>JPY</th><th>AED</th></tr></thead>
          <tbody>${rates.map((r) => `<tr><td>${r.takesEffectOn}</td><td>${r.eur}</td><td>${r.gbp}</td><td>${r.usd}</td><td>${r.jpy}</td><td>${r.aed}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
      ${today ? mintTile(`€${today.eur}`, "today's rate in EUR") : ""}
    </div>`;
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="new-rate">New rate</button>`;
    qs("#new-rate", bar)!.addEventListener("click", () => {
      dialogs.openDialog("New rate", `
        <label>Takes effect on<input name="takesEffectOn" placeholder="YYYY-MM-DD"></label>
        <label>EUR<input name="eur" inputmode="decimal"></label>
        <label>GBP<input name="gbp" inputmode="decimal"></label>
        <label>USD<input name="usd" inputmode="decimal"></label>
        <label>JPY<input name="jpy" inputmode="decimal"></label>
        <label>AED<input name="aed" inputmode="decimal"></label>`,
        async (form) => {
          const json: Record<string, string> = {};
          for (const key of ["takesEffectOn", "eur", "gbp", "usd", "jpy", "aed"]) {
            json[key] = (form.elements.namedItem(key) as HTMLInputElement).value;
          }
          const res = await api<{ rates: Rate[] }>("/api/rates", { method: "POST", json });
          announce(`Rate saved. It applies to new estimates from ${json.takesEffectOn}.`);
          dialogs.closeDialog();
          await load();
          void res;
        });
    });
  }

  await load();
  void ApiFail;
}
