// The Blend builder. Packets and prices always come from the server's preview.

import { useEffect, useRef, useState } from "react";
import { BlendAnswer, IngredientsAnswer, PreviewBlendAnswer, type BlendView, type IngredientView, type PackedBlend } from "../shared/api";
import { formatCents } from "../shared/format";
import { ingredientName, PACKET_CAPSULES } from "../shared/ingredients";
import { ApiFailure, getJson, sendJson } from "./api";
import { CapsuleGlyph } from "./glyphs";
import { closeDialog, navigate, openDialog } from "./stores";
import { ActionBar, Button, Dialog, PageHeading, Problems, Skeleton, useAction, useLoad, useMedia } from "./ui";

interface Item {
  ingredient: string;
  capsules: string;
}

function strengthText(ingredient: IngredientView): string {
  const amount = Number(ingredient.strength.amount).toLocaleString("en-US");
  const base = `${amount} ${ingredient.strength.unit}`;
  return ingredient.strength.mcg ? `${base} (${ingredient.strength.mcg} mcg)` : base;
}

function CatalogList({ ingredients, chosen, onAdd }: { ingredients: readonly IngredientView[]; chosen: readonly Item[]; onAdd: (id: string) => void }) {
  return (
    <ul className="ingredient-list">
      {ingredients.map((ingredient) => {
        const added = chosen.some((item) => item.ingredient === ingredient.id);
        return (
          <li key={ingredient.id}>
            <div>
              <p className="ingredient-name">{ingredient.name}</p>
              <p className="muted">{strengthText(ingredient)} · {formatCents(ingredient.priceCentsPerCapsule)} a capsule</p>
            </div>
            <button type="button" className="button button-secondary" aria-disabled={added ? true : undefined} onClick={() => {
              if (!added) onAdd(ingredient.id);
            }}>Add {ingredient.name}</button>
          </li>
        );
      })}
    </ul>
  );
}

function PacketCard({ name, count, packed, side }: { name: string; count: number; packed: PackedBlend | null; side: "morning" | "evening" }) {
  const lines = (packed?.items ?? []).filter((item) => item[side] > 0);
  return (
    <section role="region" aria-label={`${name} packet`} className="card packet">
      <h2>{name}</h2>
      <p className="packet-count">{count} of {PACKET_CAPSULES} capsules</p>
      <div className="capsule-row" aria-hidden="true">
        {Array.from({ length: PACKET_CAPSULES }, (_, index) => (
          <span key={index} className={index < count ? "capsule capsule-full" : "capsule"}><CapsuleGlyph size={24} /></span>
        ))}
      </div>
      <ul className="packet-items">
        {lines.map((item) => <li key={item.ingredient}>{ingredientName(item.ingredient)} × {item[side]}</li>)}
      </ul>
    </section>
  );
}

export function BlendScreen({ memberId, memberName, startFrom, children }: { memberId: string; memberName: string; startFrom: BlendView | null; children?: React.ReactNode }) {
  const catalog = useLoad(() => getJson("/api/ingredients", IngredientsAnswer), "ingredients");
  const [items, setItems] = useState<Item[]>(() => (startFrom?.items ?? []).map((item) => ({ ingredient: item.ingredient, capsules: String(item.capsulesPerDay) })));
  const [packed, setPacked] = useState<PackedBlend | null>(startFrom);
  const saveAction = useAction();
  const previewTicket = useRef(0);
  const sheetLayout = useMedia("(max-width: 599px)");
  const ingredients = catalog.data?.ingredients ?? [];
  const previewPath = `/api/members/${memberId}/blends/preview`;

  const asBody = (): { items: { ingredient: string; capsulesPerDay: number | null }[] } => ({
    items: items.map((item) => ({
      ingredient: item.ingredient,
      capsulesPerDay: /^\d+$/.test(item.capsules) ? Number(item.capsules) : null,
    })),
  });

  const { refuse, clear } = saveAction;
  const signature = JSON.stringify(items);
  useEffect(() => {
    previewTicket.current += 1;
    const mine = previewTicket.current;
    if (items.length === 0) {
      setPacked(null);
      clear();
      return;
    }
    sendJson("POST", previewPath, asBody(), PreviewBlendAnswer).then(
      (answer) => {
        if (mine !== previewTicket.current) return;
        setPacked(answer.blend);
        clear();
      },
      (error: unknown) => {
        if (mine !== previewTicket.current || !(error instanceof ApiFailure) || error.code === "session_ended") return;
        refuse(error.message, false);
      },
    );
    // The preview follows the items; the helpers it reads are stable.
  }, [signature]);

  const addIngredient = (id: string): void => {
    setItems((current) => [...current, { ingredient: id, capsules: "1" }]);
    if (sheetLayout) closeDialog();
  };

  const save = (): void => {
    void saveAction.run(async () => {
      const answer = await sendJson("POST", `/api/members/${memberId}/blends`, asBody(), BlendAnswer);
      navigate(`/staff/members/${memberId}/blends/${answer.blend.id}`);
      return "Blend saved.";
    });
  };

  return (
    <>
      <section className="page-head">
        <PageHeading>{`Blend for ${memberName}`}</PageHeading>
      </section>
      <Problems form="blend" action={saveAction} />
      {catalog.data || catalog.failed ? <div className="blend-layout">
        {sheetLayout ? (
          <div className="card">
            <Button kind="secondary" onClick={(event) => openDialog("ingredient-catalog", event.currentTarget)}>Ingredient catalog</Button>
          </div>
        ) : (
          <section role="region" aria-label="Ingredient catalog" className="card blend-catalog">
            <h2>Ingredient catalog</h2>
            <CatalogList ingredients={ingredients} chosen={items} onAdd={addIngredient} />
          </section>
        )}
        <div className="blend-main">
          <div className="packets">
            <PacketCard name="Morning" count={packed?.morningCapsules ?? 0} packed={packed} side="morning" />
            <PacketCard name="Evening" count={packed?.eveningCapsules ?? 0} packed={packed} side="evening" />
          </div>
          <section className="card stack">
            <h2>Daily doses</h2>
            {items.length === 0 ? <p className="muted">Add an ingredient from the catalog to start.</p> : null}
            <ul className="dose-list">
              {items.map((item) => (
                <li key={item.ingredient}>
                  <label htmlFor={`dose-${item.ingredient}`}>{ingredientName(item.ingredient)}</label>
                  <input
                    id={`dose-${item.ingredient}`}
                    type="number"
                    min={1}
                    step={1}
                    aria-label={`Capsules a day, ${ingredientName(item.ingredient)}`}
                    value={item.capsules}
                    onChange={(event) => setItems((current) => current.map((entry) => (entry.ingredient === item.ingredient ? { ...entry, capsules: event.target.value } : entry)))}
                  />
                  <Button kind="quiet" onClick={() => setItems((current) => current.filter((entry) => entry.ingredient !== item.ingredient))}>{`Remove ${ingredientName(item.ingredient)}`}</Button>
                </li>
              ))}
            </ul>
            <p className="prices">
              <span>30-day list price {formatCents(packed?.listPriceCents ?? 0)}</span>
              <span>Member price {formatCents(packed?.memberPriceCents ?? 0)}</span>
            </p>
            <ActionBar><Button action={saveAction} onClick={save}>Save blend</Button></ActionBar>
          </section>
          {children}
        </div>
      </div> : <Skeleton />}
      <Dialog id="ingredient-catalog" title="Ingredient catalog" kind="sheet">
        <CatalogList ingredients={ingredients} chosen={items} onAdd={addIngredient} />
      </Dialog>
    </>
  );
}

