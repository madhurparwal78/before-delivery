import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { type Currency, minorOfPrice, printAmount } from "../../../server/domain/money.ts";
import { chairSvg, glyph, grainSvg } from "../../shared/dots.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, get, post } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { DotImage } from "../lib/dotImage.tsx";
import { AsyncButton, Field, Problems, SelectField, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { EASE, MOVE_MS, reducedMotion, STEP_MS } from "../lib/motion.ts";
import { replaceSearch } from "../lib/router.tsx";
import { Empty, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

const FAMILIES = ["Aniline", "Semi-aniline", "Pull-up", "Wool", "Linen"];
const TRAY_SIZE = 4;
const DESK_CURRENCY: Currency = "EUR";

interface Material {
  code: string;
  name: string;
  family: string;
  unit: "sqFt" | "metre";
  prices: { eur: string };
}

type Lot = { lot: string; hides: number; averageSqFt: string } | { lot: string; metres: string };

type Stock = { lots: Lot[]; refused: null } | { lots: []; refused: string };

const swatchName = (material: Material): string => `${material.name} ${material.code}`;

function lotLabel(lot: Lot): string {
  if ("metres" in lot) return `${lot.lot}, ${lot.metres} m`;
  return `${lot.lot}, ${lot.hides === 1 ? "1 hide" : `${lot.hides} hides`} at ${lot.averageSqFt} sq ft`;
}

async function readStock(code: string): Promise<Stock> {
  try {
    const { lots } = await get<{ lots: Lot[] }>(`/api/materials/${code}/lots`);
    return { lots, refused: null };
  } catch (error) {
    if (error instanceof ApiFailure && (error.status === 429 || error.status === 503)) return { lots: [], refused: error.message };
    throw error;
  }
}

async function readPieces(): Promise<{ value: string; label: string }[]> {
  const pieces: { value: string; label: string }[] = [];
  let cursor: string | null = "";
  while (cursor !== null) {
    const page: { pieces: { id: string; title: string }[]; nextCursor: string | null } = await get(`/api/pieces${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    pieces.push(...page.pieces.map((piece) => ({ value: piece.id, label: piece.title })));
    cursor = page.nextCursor;
  }
  return pieces;
}

/** Two layers cross-fade by a CSS transition: a further choice reverses it from wherever the opacity stands. */
function ChairDrawing({ code }: { code: string | null }): JSX.Element {
  const [layers, setLayers] = useState<{ art: [string, string]; front: 0 | 1 }>({ art: [code ?? "library", code ?? "library"], front: 0 });
  useEffect(() => {
    const seed = code ?? "library";
    setLayers((old) => {
      if (old.art[old.front] === seed) return old;
      const front = old.front === 0 ? 1 : 0;
      const art: [string, string] = front === 0 ? [seed, old.art[1]] : [old.art[0], seed];
      return { art, front };
    });
  }, [code]);
  return (
    <div class="library-drawing">
      {layers.art.map((seed, index) => (
        <div key={index} class="library-layer" data-front={layers.front === index ? "true" : undefined}>
          <DotImage drawing={chairSvg(seed)} />
        </div>
      ))}
    </div>
  );
}

export function LibraryScreen({ query }: ScreenProps): JSX.Element {
  const live = useLive(() => get<{ materials: Material[] }>("/api/materials"), []);
  const asked = query.get("material");
  const [chosen, setChosen] = useState<string | null>(asked);
  const stock = useLive(async () => (chosen ? readStock(chosen) : null), [chosen]);
  const [tray, setTray] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pieces, setPieces] = useState<{ value: string; label: string }[]>([]);
  const hold = useDialog("Hold a dye lot");
  const form = useForm({ code: "", piece: "", lot: "", quantity: "" }, hold);
  const swatches = useRef<HTMLHeadingElement>(null);
  const trayRow = useRef<HTMLUListElement>(null);
  const closing = useRef<{ boxes: Map<Element, DOMRect>; focus: string | null } | null>(null);
  const rising = useRef(false);

  useEffect(() => {
    if (asked) setChosen(asked);
  }, [asked]);

  useEffect(() => {
    if (!hold.open) return;
    void readPieces().then((list) => {
      setPieces(list);
      const first = list[0];
      if (first) form.set("piece", form.values.piece || first.value);
    });
  }, [hold.open]);

  useLayoutEffect(() => {
    const row = trayRow.current;
    if (!row) return;
    if (rising.current) {
      rising.current = false;
      if (!reducedMotion()) {
        row.animate(
          [
            { transform: "translateY(24px)", opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: MOVE_MS, easing: EASE },
        );
      }
    }
    const leaving = closing.current;
    if (!leaving) return;
    closing.current = null;
    for (const member of row.children) {
      const was = leaving.boxes.get(member);
      if (!was || reducedMotion()) continue;
      const now = member.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (dx !== 0 || dy !== 0) member.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: STEP_MS, easing: EASE });
    }
    const next = leaving.focus ? row.querySelector<HTMLElement>(`[data-member="${leaving.focus}"] button`) : null;
    (next ?? swatches.current)?.focus();
  }, [tray]);

  const materials = live.data?.materials;
  const chosenMaterial = materials?.find((material) => material.code === chosen) ?? null;

  const choose = (code: string): void => {
    setChosen(code);
    replaceSearch(`?material=${encodeURIComponent(code)}`);
  };

  const addToTray = (): void => {
    if (!chosen || tray.includes(chosen)) return;
    if (tray.length >= TRAY_SIZE) {
      announce(copy("F-32"));
      return;
    }
    rising.current = tray.length === 0;
    setTray([...tray, chosen]);
  };

  const takeOut = (code: string): void => {
    const row = trayRow.current as HTMLUListElement;
    const boxes = new Map([...row.children].map((member) => [member, member.getBoundingClientRect()]));
    const at = tray.indexOf(code);
    const left = tray.filter((member) => member !== code);
    closing.current = { boxes, focus: left[at] ?? left.at(-1) ?? null };
    setTray(left);
  };

  const refresh = async (): Promise<void> => {
    try {
      const { count } = await post<{ count: number }>("/api/materials/refresh");
      setRefusal(null);
      announce(copy("F-31", { n: count }));
      await live.reload();
    } catch (error) {
      const message = error instanceof ApiFailure ? error.message : copy("F-29");
      setRefusal(message);
      announce(message);
    }
  };

  const askHold = async (): Promise<void> => {
    const { piece, lot, quantity } = form.values;
    if (!piece) {
      form.refuse({ piece: copy("F-04") });
      return;
    }
    let label = "";
    const saved = await form.submit(async () => {
      const answer = await post<{ hold: { label: string } }>(`/api/pieces/${piece}/holds`, { code: chosen ?? "", lot, quantity });
      label = answer.hold.label;
    });
    if (!saved) return;
    hold.done();
    announce(label);
    form.replace({ code: "", piece, lot: "", quantity: "" });
  };

  if (!materials) return <Loading height={640} />;
  const families = [...FAMILIES, ...new Set(materials.map((material) => material.family).filter((family) => !FAMILIES.includes(family)))];
  const unit = chosenMaterial?.unit === "metre" ? "metre" : "sq ft";
  const lots = stock.data?.lots ?? [];

  return (
    <>
      <Heading text="Material library">
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => hold.show(event.currentTarget)}>
            Hold a dye lot
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-large swatch-tile" aria-label="Swatch grid">
          <div class="swatch-head">
            <h2 ref={swatches} tabIndex={-1}>
              Swatches
            </h2>
            <AsyncButton label="Refresh library" onPress={refresh} />
          </div>
          {refusal ? <p class="tile-refusal">{refusal}</p> : null}
          {families.map((family) => {
            const members = materials.filter((material) => material.family === family);
            return (
              <div key={family} class="swatch-family">
                <h3 class="family-heading">{family}</h3>
                {members.length === 0 ? (
                  <Empty text="Nothing here until the library is refreshed." />
                ) : (
                  <div class="swatch-grid" role="radiogroup" aria-label={family}>
                    {members.map((material) => (
                      <label key={material.code} class="swatch">
                        <input
                          type="radio"
                          name={`family-${family}`}
                          checked={chosen === material.code}
                          aria-label={swatchName(material)}
                          onChange={() => choose(material.code)}
                          onFocus={(event) => {
                            const heading = event.currentTarget.closest(".swatch-family")?.querySelector(".family-heading");
                            const covered = (heading?.getBoundingClientRect().bottom ?? 0) + 8 - event.currentTarget.getBoundingClientRect().top;
                            if (covered > 0) scrollBy({ top: -covered, behavior: "instant" });
                          }}
                        />
                        <span class="swatch-grain">
                          <DotImage drawing={grainSvg(material.code, material.family)} />
                        </span>
                        <span class="swatch-name">{material.name}</span>
                        <span class="swatch-code small">{material.code}</span>
                        <span class="swatch-check" dangerouslySetInnerHTML={{ __html: glyph("check") }} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        <div class="t-medium side-stack">
          <MintTile
            label={chosenMaterial ? `Price per ${unit}` : "Chosen price"}
            figure={chosenMaterial ? printAmount(minorOfPrice(chosenMaterial.prices.eur, DESK_CURRENCY), DESK_CURRENCY) : "None yet"}
            size=""
          />
          <section class="tile" aria-label="Chair drawing">
            <ChairDrawing code={chosen} />
            <p class="drawing-name">{chosenMaterial ? swatchName(chosenMaterial) : "No swatch chosen"}</p>
            <button type="button" class="button" onClick={addToTray}>
              Add to compare
            </button>
          </section>
          <section class="tile stock-tile" aria-label="Stock">
            <h2>Stock</h2>
            {!chosen ? (
              <p class="muted">Choose a swatch to read its lots.</p>
            ) : !stock.data ? (
              <p>{copy("F-99")}</p>
            ) : stock.data.refused ? (
              <p class="tile-refusal">{stock.data.refused}</p>
            ) : (
              <ul class="stock-lots">
                {lots.map((lot) => (
                  <li key={lot.lot}>{lotLabel(lot)}</li>
                ))}
              </ul>
            )}
          </section>
          <section class="tile tray-tile" aria-label="Compare tray">
            <h2>Compare</h2>
            {tray.length === 0 ? <Empty text="Add up to four swatches to read them side by side." /> : null}
            <ul ref={trayRow} class="tray-row">
              {tray.map((code) => {
                const material = materials.find((item) => item.code === code);
                if (!material) return null;
                return (
                  <li key={code} class="tray-member" data-member={code}>
                    <span class="tray-grain">
                      <DotImage drawing={grainSvg(material.code, material.family)} />
                    </span>
                    <button type="button" class="button" onClick={() => takeOut(code)}>
                      Take out {swatchName(material)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
      <Dialog control={hold} title="Hold a dye lot">
        <Problems form={form} firstField="quantity" />
        <SelectField form={form} name="piece" label="Piece" choices={pieces} />
        <p id={form.ids.code} tabIndex={-1}>
          {chosenMaterial ? swatchName(chosenMaterial) : "No swatch chosen"}
        </p>
        <div class="field">
          <span class="field-label" id={`${form.ids.lot}-label`}>
            Lot
          </span>
          <div class="choices choices--stacked" role="radiogroup" aria-labelledby={`${form.ids.lot}-label`}>
            {lots.map((lot, index) => (
              <label key={lot.lot} class="choice">
                <input type="radio" name="hold-lot" id={index === 0 ? form.ids.lot : undefined} checked={form.values.lot === lot.lot} onChange={() => form.set("lot", lot.lot)} />
                {lotLabel(lot)}
              </label>
            ))}
          </div>
          {form.errors.lot ? <span class="field-message">{form.errors.lot}</span> : null}
        </div>
        <Field form={form} name="quantity" label="Quantity" inputMode="decimal" />
        <AsyncButton label="Hold" primary onPress={askHold} />
      </Dialog>
    </>
  );
}
