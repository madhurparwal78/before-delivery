import { CycleRow, all, one, run, tx } from "../db";
import { errors } from "../errors";
import { bumpVersion, cycle, line, product } from "./club";

/** The single place that decides an unfilled case's one resolution. */
export function resolveLine(c: CycleRow, productId: string, action: "drop" | "take_up"): void {
  tx(() => {
    const cyc = cycle(c.id)!;
    const nowSec = Math.floor(Date.now() / 1000);
    const effStatus = cyc.status === "open" && cyc.cutoff_at !== null && nowSec >= cyc.cutoff_at ? "sealing" : cyc.status;
    if (effStatus !== "sealing") throw errors.wrongCycleState();
    const ln = line(c.id, productId);
    if (!ln) throw errors.notFound();
    if (ln.status === "sealed") throw errors.lineAlreadyFull();
    if (ln.status === "dropped" || ln.status === "taken_up") {
      throw errors.lineAlreadyResolved(ln.status as "dropped" | "taken_up");
    }
    const p = product(productId)!;
    if (action === "drop") {
      run("UPDATE lines SET status = 'dropped' WHERE cycle_id = ? AND product_id = ?", c.id, productId);
    } else {
      const pledgedRows = all<{ units: number }>("SELECT units FROM pledges WHERE cycle_id = ? AND product_id = ?", c.id, productId);
      const pledged = pledgedRows.reduce((n, r) => n + r.units, 0);
      const remaining = p.pack - pledged;
      run(
        "INSERT INTO pledges (cycle_id, product_id, household_code, units, created_at) VALUES (?, ?, 'club', ?, ?)",
        c.id, productId, remaining, Math.floor(Date.now() / 1000)
      );
      run("UPDATE lines SET status = 'taken_up' WHERE cycle_id = ? AND product_id = ?", c.id, productId);
    }
    bumpVersion(c.id, productId);
  });
}
