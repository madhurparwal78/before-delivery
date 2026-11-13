import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, formatDate } from "../../../shared/copy";
import type { Catalogue, DrinkSummary, HistoryEntry, PackFacts, SkuSummary } from "../../../shared/types";
import { get, messageOf, patch, post } from "../../lib/net";

const FIELD: Record<HistoryEntry["field"], string> = { drink_name: "Drink name", variant: "Pack wording" };

export function RenameForms({ catalogue, onCatalogue, onRenamed }: { catalogue: Catalogue | null; onCatalogue: (next: Catalogue) => void; onRenamed: () => void }) {
  const drinks = catalogue?.drinks ?? [];
  const [drinkId, setDrinkId] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [newDrink, setNewDrink] = useState("");
  const [newPack, setNewPack] = useState("");
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyToken = useRef(0);
  const busy = useRef(false);
  const catalogueRef = useRef(catalogue);
  catalogueRef.current = catalogue;

  const drink = drinks.find((d) => d.id === drinkId) ?? drinks[0];
  const pack = drink?.skus.find((s) => s.code === skuCode) ?? drink?.skus[0];
  const code = pack?.code ?? "";
  const codeRef = useRef(code);
  codeRef.current = code;

  const loadHistory = () => {
    const shown = codeRef.current;
    if (!shown) return;
    const mine = ++historyToken.current;
    void get<{ history: HistoryEntry[] }>(`/api/editor/skus/${shown}/history`)
      .then((answer) => {
        if (mine === historyToken.current) setHistory(answer.history);
      })
      .catch(() => undefined);
  };
  useEffect(loadHistory, [code]);

  const replaceDrink = (next: DrinkSummary) => {
    const cat = catalogueRef.current;
    if (cat) onCatalogue({ ...cat, drinks: cat.drinks.map((d) => (d.id === next.id ? next : d)) });
  };
  const replaceSku = (next: SkuSummary) => {
    const cat = catalogueRef.current;
    if (cat) onCatalogue({ ...cat, drinks: cat.drinks.map((d) => ({ ...d, skus: d.skus.map((s) => (s.code === next.code ? next : s)) })) });
  };

  const rename = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setStatus("Renaming.");
    try {
      await work();
      setStatus("Renamed. Published notices keep their old name.");
      loadHistory();
      onRenamed();
    } catch (error) {
      setStatus(messageOf(error, COPY.unavailable));
    } finally {
      busy.current = false;
    }
  };

  return (
    <section class="renames" aria-label="Renames and history">
      <h2>Renames and history</h2>
      <div class="block">
        <label for="rename-drink">Drink</label>
        <select id="rename-drink" value={drink?.id ?? ""} onChange={(e) => { setDrinkId((e.currentTarget as HTMLSelectElement).value); setSkuCode(""); }}>
          {drinks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <label for="rename-drink-name">New drink name</label>
        <input id="rename-drink-name" type="text" value={newDrink} onInput={(e) => setNewDrink((e.currentTarget as HTMLInputElement).value)} />
        <button
          type="button"
          class="rect-button"
          onClick={() => {
            const id = drink?.id;
            if (id) void rename(async () => {
              replaceDrink(await patch<DrinkSummary>(`/api/editor/drinks/${id}`, { name: newDrink }));
              setNewDrink("");
            });
          }}
        >
          Rename drink
        </button>
        <label for="rename-pack">Pack</label>
        <select id="rename-pack" value={code} onChange={(e) => setSkuCode((e.currentTarget as HTMLSelectElement).value)}>
          {(drink?.skus ?? []).map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} {s.variant}
            </option>
          ))}
        </select>
        <label for="rename-pack-wording">New pack wording</label>
        <input id="rename-pack-wording" type="text" value={newPack} onInput={(e) => setNewPack((e.currentTarget as HTMLInputElement).value)} />
        <button
          type="button"
          class="rect-button"
          onClick={() => {
            const target = code;
            if (target) void rename(async () => {
              replaceSku(await patch<SkuSummary>(`/api/editor/skus/${target}`, { variant: newPack }));
              setNewPack("");
            });
          }}
        >
          Rename pack
        </button>
        <div role="status" aria-label="Rename status" class="status">
          {status}
        </div>
      </div>
      <section role="region" aria-label="Pack history" class="history">
        <h3>Pack history</h3>
        {history.length === 0 && <p class="pdf-note">No renames on this pack yet.</p>}
        <ol class="history-list">
          {history.map((h) => (
            <li key={`${h.at}-${h.field}-${h.to}`}>
              {formatDate(h.at.slice(0, 10))} · {FIELD[h.field]}: <span class="wrap">{h.from}</span> to <span class="wrap">{h.to}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

export function BatchForm({ catalogue }: { catalogue: Catalogue | null }) {
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [oldWrapper, setOldWrapper] = useState(false);
  const [status, setStatus] = useState("");
  const busy = useRef(false);
  const skus = (catalogue?.drinks ?? []).flatMap((d) => d.skus);
  const chosen = sku || skus[0]?.code || "";
  const register = async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus("Registering.");
    try {
      const made = await post<PackFacts>("/api/editor/batches", { code: code.trim(), skuCode: chosen, oldWrapper });
      setStatus(`Batch ${made.batchCode} registered.`);
      setCode("");
    } catch (error) {
      setStatus(messageOf(error, COPY.unavailable));
    } finally {
      busy.current = false;
    }
  };
  return (
    <section class="batches" aria-label="Batch registration">
      <h2>Batch registration</h2>
      <form
        class="block"
        onSubmit={(e) => {
          e.preventDefault();
          void register();
        }}
      >
        <label for="batch-new">New batch code</label>
        <input id="batch-new" type="text" autocomplete="off" value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
        <label for="batch-pack">Batch pack</label>
        <select id="batch-pack" value={chosen} onChange={(e) => setSku((e.currentTarget as HTMLSelectElement).value)}>
          {skus.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} {s.name}
            </option>
          ))}
        </select>
        <label class="check" for="batch-old">
          <input id="batch-old" type="checkbox" checked={oldWrapper} onChange={(e) => setOldWrapper((e.currentTarget as HTMLInputElement).checked)} />
          <span>Old wrapper</span>
        </label>
        <button type="submit" class="rect-button">
          Register batch
        </button>
        <div role="status" aria-label="Batch status" class="status">
          {status}
        </div>
      </form>
    </section>
  );
}
