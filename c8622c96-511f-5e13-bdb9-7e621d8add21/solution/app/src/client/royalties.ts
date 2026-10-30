// Royalties (contributor): only the signed-in contributor's own share lines, newest month first.
import { coopMonth } from "../shared/coop-time.js";
import { dollars, percent } from "../shared/money.js";
import { attempt, get } from "./api.js";
import { h, replace } from "./dom.js";
import { dataTable, emptyNote, mono, outageFrom, pageHead } from "./ui.js";

interface Line {
  month: string;
  licence_id: string;
  essay_title: string;
  position: number;
  split_bp: number;
  amount_minor: number;
}

export function mountRoyalties(root: HTMLElement): () => void {
  const body = h("div", {});
  replace(root, pageHead("Royalties", "Your share of every invoiced licence, from each monthly statement the treasurer runs."), body);
  void (async () => {
    const answer = await attempt(() => get<{ lines: Line[] }>("/api/studio/royalties"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    const lines = answer.data.lines;
    replace(body, lines.length ? dataTable("My royalties", ["Month", "Essay", "Share", "Amount"], lines.map((l) =>
      [mono(coopMonth(l.month)), l.essay_title, mono(`${percent(l.split_bp)}%`), mono(dollars(l.amount_minor))]), [2, 3])
      : emptyNote("No royalty lines yet. They appear once a statement covers a licence of your essays."));
  })();
  return () => undefined;
}
