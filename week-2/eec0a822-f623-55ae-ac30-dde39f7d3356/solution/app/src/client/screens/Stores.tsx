import { useEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/copy";
import { api, sharedCopy } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { navigate, setFlash, takeFlash } from "../lib/nav";
import { bad, Button, Field, focusFirstError, Link, NoteLine, ok, SelectField, useAction } from "../ui/Controls";
import { Dialog, useDialog, type DialogHandle } from "../ui/Dialog";
import { NotFoundPage, type Member } from "../ui/Shell";
import { Loader } from "../ui/Visuals";

interface Item {
  id: string;
  name: string;
  unit: string;
  category: string;
  receivedQty: number;
  usedQty: number;
  spoiledQty: number;
  onHandQty: number;
}

const CATEGORIES = [
  { value: "provisions", label: "Provisions" },
  { value: "drinks", label: "Drinks" },
  { value: "cleaning", label: "Cleaning" },
  { value: "engine_room", label: "Engine room" },
  { value: "safety", label: "Safety" },
];

const KINDS = [
  { value: "received", label: "Received" },
  { value: "used", label: "Used" },
  { value: "spoiled", label: "Spoiled" },
] as const;

/** The Log movement sheet. On success it closes and the screen shows the saved message next to the list. */
function MovementSheet({ handle, item, base, onLogged }: {
  handle: DialogHandle;
  item: Item | null;
  base: string;
  onLogged: (item: Item, note: string) => void;
}) {
  const [kind, setKind] = useState<"received" | "used" | "spoiled">("received");
  const [quantity, setQuantity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const submitButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (handle.open) {
      setKind("received");
      setQuantity("");
      setErrors({});
      action.setNote(null);
    }
  }, [handle.open, item?.id]);

  const submit = (event: Event) => {
    event.preventDefault();
    if (!item) return;
    void action.run("Logging movement", async () => {
      const qty = /^\s*\d+\s*$/.test(quantity) ? Number(quantity) : quantity;
      const result = await api<{ item: Item; movement: { quantity: number; kind: string } }>("POST", `${base}/${item.id}/movements`, { kind, quantity: qty });
      if (result.ok) {
        const { item: updated, movement } = result.data;
        onLogged(updated, COPY.movementLogged(movement.quantity, updated.unit, movement.kind, updated.onHandQty));
        handle.hide();
        return null;
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      action.focusLater(() => focusFirstError(found.quantity ? ["movement-quantity"] : [], submitButton.current));
      if (result.body.error === "insufficient_stock") return bad(COPY.notEnough(Number(result.body.onHandQty), item.unit));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  return (
    <Dialog handle={handle} title="Log movement" variant="sheet">
      <form class="form" onSubmit={submit} noValidate>
        {item ? <p class="dialog__context">{item.name} · <span class="fig">{item.onHandQty} {item.unit}</span> on hand</p> : null}
        <fieldset class="choice">
          <legend id="movement-label">Movement</legend>
          <div role="radiogroup" aria-labelledby="movement-label" class="choice__options">
            {KINDS.map((k) => (
              <label key={k.value} class="choice__option">
                <input type="radio" name="movement" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} data-first={kind === k.value ? "" : undefined} />
                <span>{k.label}</span>
              </label>
            ))}
          </div>
          {errors.kind ? <p class="field__error">{errors.kind}</p> : null}
        </fieldset>
        <Field id="movement-quantity" label="Quantity" inputMode="numeric" value={quantity} onInput={setQuantity} error={errors.quantity} />
        <NoteLine note={action.note} />
        <div class="dialog__actions">
          <Button type="submit" pending={action.pending} pendingLabel="Logging movement" buttonRef={submitButton}>Log movement</Button>
          <Button variant="quiet" onClick={handle.hide}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Stores({ member, slug }: { member: Member; slug: string }) {
  const ws = member.workspaceSlug;
  const base = `/api/w/${ws}/yachts/${slug}/stores`;
  const yacht = useLoad<{ yacht: { name: string } }>(`/api/w/${ws}/yachts/${slug}`);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState<number | null>(null);
  const latest = useRef(0);
  const sheet = useDialog();
  const add = useDialog();
  const [target, setTarget] = useState<Item | null>(null);
  const saved = useAction();
  const adding = useAction();
  const [draft, setDraft] = useState({ name: "", unit: "", category: "provisions" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const flash = takeFlash(location.pathname);
    if (flash) saved.setNote(ok(flash));
  }, []);

  useEffect(() => {
    const ask = (latest.current += 1);
    void api<{ items: Item[]; nextCursor: string | null }>("GET", `${base}?q=${encodeURIComponent(q)}`).then((result) => {
      if (ask !== latest.current) return;
      if (result.ok) {
        setItems(result.data.items);
        setNext(result.data.nextCursor);
      } else {
        setFailed(result.status);
      }
    });
  }, [q]);

  if (failed === 404 || (yacht.result && !yacht.result.ok && yacht.result.status === 404)) return <NotFoundPage />;

  const loadMore = async () => {
    if (!next) return;
    const ask = latest.current;
    setLoadingMore(true);
    const result = await api<{ items: Item[]; nextCursor: string | null }>("GET", `${base}?q=${encodeURIComponent(q)}&cursor=${encodeURIComponent(next)}`);
    setLoadingMore(false);
    if (ask !== latest.current || !result.ok) return;
    setItems((current) => [...(current ?? []), ...result.data.items]);
    setNext(result.data.nextCursor);
  };

  const submitAdd = (event: Event) => {
    event.preventDefault();
    void adding.run("Adding item", async () => {
      const result = await api<{ item: Item }>("POST", base, draft);
      if (result.ok) {
        const path = `/w/${ws}/yachts/${slug}/stores/${result.data.item.id}`;
        setFlash(path, COPY.itemAdded(result.data.item.name));
        navigate(path);
        return null;
      }
      const found = result.body.errors ?? {};
      setErrors(found);
      adding.focusLater(() =>
        focusFirstError([found.name ? "item-name" : "", found.unit ? "item-unit" : "", found.category ? "item-category" : ""].filter(Boolean), addButton.current));
      if (result.body.error === "item_exists") return bad(COPY.itemExists(draft.name.trim()));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  return (
    <section>
      <Loader active={!yacht.data || (items === null && failed === null)} />
      {/* The page shows with its first data so nothing below the loader moves when it lands. */}
      {!yacht.data || (items === null && failed === null) ? null : <>
      <h1 class="rise">{yacht.data.yacht.name} stores</h1>
      <p class="lede">On hand is always received minus used minus spoiled.</p>
      <div class="toolbar">
        <div class="field field--search">
          <label for="stores-search">Search stores</label>
          <input id="stores-search" type="search" value={q} autoComplete="off" onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <Button onClick={(e) => { setDraft({ name: "", unit: "", category: "provisions" }); setErrors({}); adding.setNote(null); add.show(e); }} aria-haspopup="dialog">
          Add item
        </Button>
      </div>
      <NoteLine note={saved.note} />
      <ul class="rows rows--stores" aria-label="Stores">
        {(items ?? []).map((item) => (
          <li key={item.id} class="row-card store">
            <Link class="store__name" href={`/w/${ws}/yachts/${slug}/stores/${item.id}`}>{item.name}</Link>
            <span class="store__hand fig">{item.onHandQty} {item.unit} on hand</span>
            <Button variant="quiet" onClick={(e) => { setTarget(item); sheet.show(e); }} aria-haspopup="dialog">Log movement for {item.name}</Button>
          </li>
        ))}
      </ul>
      {items && !items.length ? <p class="empty">No items match.</p> : null}
      {next ? <Button variant="quiet" onClick={loadMore} disabled={loadingMore}>Load more</Button> : null}
      </>}
      <MovementSheet
        handle={sheet}
        item={target}
        base={base}
        onLogged={(updated, note) => {
          setItems((current) => (current ?? []).map((i) => (i.id === updated.id ? updated : i)));
          saved.setNote(ok(note));
        }}
      />
      <Dialog handle={add} title="Add item">
        <form class="form" onSubmit={submitAdd} noValidate>
          <Field id="item-name" label="Item name" value={draft.name} onInput={(v) => setDraft({ ...draft, name: v })} error={errors.name} first />
          <Field id="item-unit" label="Unit" value={draft.unit} onInput={(v) => setDraft({ ...draft, unit: v })} error={errors.unit} hint="For example bottles, kg or litres" />
          <SelectField id="item-category" label="Category" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} options={CATEGORIES} error={errors.category} />
          <NoteLine note={adding.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={adding.pending} pendingLabel="Adding item" buttonRef={addButton}>Add item</Button>
            <Button variant="quiet" onClick={add.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

export function StoreItem({ member, slug, id }: { member: Member; slug: string; id: string }) {
  const ws = member.workspaceSlug;
  const base = `/api/w/${ws}/yachts/${slug}/stores`;
  const loaded = useLoad<{ item: Item }>(`${base}/${id}`);
  const [item, setItem] = useState<Item | null>(null);
  const page = useAction();
  const sheet = useDialog();
  const remove = useDialog();

  useEffect(() => {
    if (loaded.data) setItem(loaded.data.item);
  }, [loaded.data]);
  useEffect(() => {
    const flash = takeFlash(location.pathname);
    if (flash) page.setNote(ok(flash));
  }, []);

  if (loaded.result && !loaded.result.ok && loaded.result.status !== 401) return <NotFoundPage />;

  const confirmRemove = () =>
    void page.run("Removing item", async () => {
      const result = await api("DELETE", `${base}/${id}`);
      remove.hide();
      if (!result.ok) return bad(sharedCopy(result));
      const path = `/w/${ws}/yachts/${slug}/stores`;
      setFlash(path, COPY.itemRemoved(item!.name));
      navigate(path);
      return null;
    });

  return (
    <section class="narrow-page">
      <Loader active={!item} />
      {item ? (
        <>
          <p class="crumbs"><Link href={`/w/${ws}/yachts/${slug}/stores`}>All stores</Link></p>
          <h1 class="rise">{item.name}</h1>
          <p class="lede">{CATEGORIES.find((c) => c.value === item.category)?.label} · counted in {item.unit}</p>
          <div class="card">
            <dl class="counts">
              <div><dt>Received</dt><dd class="fig">{item.receivedQty}</dd></div>
              <div><dt>Used</dt><dd class="fig">{item.usedQty}</dd></div>
              <div><dt>Spoiled</dt><dd class="fig">{item.spoiledQty}</dd></div>
              <div class="counts__hand"><dt>On hand</dt><dd class="fig">{item.onHandQty} {item.unit}</dd></div>
            </dl>
            <div class="stack-actions">
              <Button onClick={sheet.show} aria-haspopup="dialog">Log movement</Button>
              <Button variant="danger" onClick={remove.show} pending={page.pending} pendingLabel="Removing item" aria-haspopup="dialog">Remove item</Button>
            </div>
            <NoteLine note={page.note} />
          </div>
        </>
      ) : null}
      <MovementSheet
        handle={sheet}
        item={item}
        base={base}
        onLogged={(updated, note) => {
          setItem(updated);
          page.setNote(ok(note));
        }}
      />
      <Dialog handle={remove} title="Remove item">
        <p>{item?.name} and its movements are removed for good.</p>
        <div class="dialog__actions">
          <Button variant="quiet" onClick={remove.hide}>Keep item</Button>
          <Button variant="danger" onClick={confirmRemove}>Remove item</Button>
        </div>
      </Dialog>
    </section>
  );
}
