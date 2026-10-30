// The tickets section: a ruled price table for the full-festival pass and the day passes.
import { euro } from "../../shared/money.ts";
import { buyPass } from "../checkout/actions.ts";
import type { Filters } from "../state/filters.ts";
import type { Programme, User } from "../types.ts";

export function Tickets({ programme, user, filters }: { programme: Programme | null; user: User | null; filters: Filters }) {
  const policy = programme?.price_policy;
  const day = filters.day ?? programme?.festival_days[0]?.date ?? null;
  return (
    <section className="section section--tickets" data-ground="paper" aria-labelledby="tickets-head" id="tickets">
      <div className="grid">
        <h2 id="tickets-head" className="display section__head" data-fit data-kinetic>Tickets</h2>
        <table className="prices figures" data-rules>
          <thead>
            <tr><th scope="col">Pass</th><th scope="col">Full rate</th><th scope="col">Reduced rate</th><th scope="col"><span className="visually-hidden">Buy</span></th></tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row"><span className="prices__name">Full-festival pass</span><span className="prices__note">Every pass session on all four days, Planetarium Dome included.</span></th>
              <td>{policy ? euro(policy.full_festival_full_cents) : "—"}</td>
              <td>{policy ? euro(policy.full_festival_reduced_cents) : "—"}</td>
              <td><button type="button" className="button button--primary" onClick={() => buyPass(user, "full", null)}>Buy full-festival pass</button></td>
            </tr>
            <tr>
              <th scope="row"><span className="prices__name">Day pass</span><span className="prices__note">Pass sessions of one festival day, 05:00 to 05:00, at every venue but the Planetarium Dome.</span></th>
              <td>{policy ? euro(policy.day_full_cents) : "—"}</td>
              <td>{policy ? euro(policy.day_reduced_cents) : "—"}</td>
              <td><button type="button" className="button button--primary" onClick={() => buyPass(user, "day", day)}>Buy day pass</button></td>
            </tr>
          </tbody>
        </table>
        <p className="prices__foot">Workshops and seated performances are sold by the seat from the schedule. Reduced rate is for students and jobseekers, with proof. Groups of five or more book on invoice with a {policy ? `${policy.group_discount_percent}% ` : ""}discount.</p>
      </div>
    </section>
  );
}
