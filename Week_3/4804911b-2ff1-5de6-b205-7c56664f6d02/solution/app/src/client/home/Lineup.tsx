import type { Catalogue } from "../../shared/types";

const GREYS = [255, 230, 205, 185, 165, 150] as const;

export function Lineup({ catalogue, sku, onDrink, onSku }: { catalogue: Catalogue | null; sku: string; onDrink: (drinkId: string) => void; onSku: (code: string) => void }) {
  const drinks = catalogue?.drinks ?? [];
  const selected = Math.max(0, drinks.findIndex((d) => d.skus.some((s) => s.code === sku)));
  const picked = drinks[selected];
  return (
    <section id="the-lineup" class="reel lineup" aria-label="The Lineup">
      <div class="lineup-inner">
        <ul class="drinks" aria-label="Drinks" role="list">
          {drinks.map((d, i) => {
            const level = GREYS[Math.min(Math.abs(i - selected), GREYS.length - 1)]!;
            return (
              <li key={d.id}>
                <button type="button" aria-pressed={i === selected ? "true" : "false"} style={{ color: `rgb(${level},${level},${level})` }} onClick={() => onDrink(d.id)}>
                  {d.name}
                </button>
              </li>
            );
          })}
        </ul>
        <div class="packs" role="radiogroup" aria-label="Packs">
          {picked?.skus.map((s) => (
            <label key={s.code} class="pack-choice">
              <input type="radio" name="packs" value={s.code} checked={s.code === sku} onChange={() => onSku(s.code)} />
              <span>{s.variant}</span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
