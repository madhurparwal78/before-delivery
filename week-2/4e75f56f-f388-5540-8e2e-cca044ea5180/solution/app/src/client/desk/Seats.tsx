import { useLayoutEffect, useState } from "preact/hooks";
import { call } from "../api.js";

interface Inventory {
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  waitlisted: { bench: number; atelier: number };
  atelier: { active: number; cap: number };
}

/** Sold, held and waitlisted counts, refreshed every second and after each desk action. */
export function SeatsRegion({ refresh }: { refresh: number }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const reply = await call<Inventory>("GET", "/api/desk/inventory");
      if (reply.ok) setInventory(reply.data);
      timer = setTimeout(() => void load(), 1000);
    };
    void load();
    return () => clearTimeout(timer);
  }, [refresh]);
  const waitlisted = inventory ? inventory.waitlisted.bench + inventory.waitlisted.atelier : 0;
  return (
    <section class="card seats-card" aria-label="Seats">
      <p class="eyebrow">Seats</p>
      {inventory ? (
        <ul class="seats-card__list">
          <li>
            Sold <span class="num">{inventory.sold}</span>
          </li>
          <li>
            Held <span class="num">{inventory.held}</span>
          </li>
          <li>
            Waitlisted <span class="num">{waitlisted}</span>
          </li>
        </ul>
      ) : (
        <p class="muted">Counting seats…</p>
      )}
      {inventory && (
        <p class="muted">
          <span class="num">{inventory.seats_remaining}</span> of <span class="num">{inventory.seats_total}</span> remaining ·{" "}
          <span class="nowrap">
            Atelier <span class="num">{inventory.atelier.active}/{inventory.atelier.cap}</span>
          </span>
        </p>
      )}
    </section>
  );
}
