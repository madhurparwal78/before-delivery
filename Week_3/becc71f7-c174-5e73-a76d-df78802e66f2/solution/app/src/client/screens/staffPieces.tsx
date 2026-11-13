// Pieces, a piece's own page, the till and the sale: the assistant's daily screens.
import { useRef, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { Consignor, Hold, Payment, Piece, Sale } from "../../shared/api";
import { CATEGORIES, CONDITIONS, labelOf, PIECE_STATUSES, SIZES, type Role } from "../../shared/catalog";
import { formatDate, formatDateTime, formatEuros, formatMoney, formatTime, parseEuros } from "../../shared/format";
import { api, ApiFailure, request } from "../api";
import { useAction, useDialog, useFields, usePoll, type DialogControl, type Poll } from "../hooks";
import { announce, focusHeading, navigate, useAddress } from "../state";
import { MainAction } from "../ui/bars";
import { Dialog } from "../ui/Dialog";
import { Garment } from "../ui/Garment";
import { Button, DialogForm, Empty, Heading, Link, NotFound, Problems, RadioGroup, SelectField, Skeleton, TableFrame, TextField } from "../ui/kit";
import { Stations } from "../ui/Stations";
import { Tag } from "../ui/Tag";

const LISTED_STATUSES = PIECE_STATUSES.filter((status) => status.value !== "returned");
const PAYMENTS = [
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
];
const SELLABLE: readonly string[] = ["on_rail", "on_hold"];
const ARCHIVABLE: readonly string[] = ["on_rail", "returns_shelf", "donation_box", "returned"];
const PRICED: readonly string[] = ["on_rail", "on_hold", "returns_shelf", "donation_box", "returned"];

function NewPieceForm({ control }: { control: DialogControl }) {
  const action = useAction();
  const form = useFields(control.name, { consignorId: "", category: "", brand: "", description: "", size: "", condition: "", askingPrice: "", intakeDate: "" });
  const consignors = usePoll(() => api<{ consignors: Consignor[] }>("/api/consignors"), "consignors");
  const options = (consignors.data?.consignors ?? []).filter((consignor) => consignor.status === "active").map((consignor) => ({ value: consignor.id, label: consignor.name }));
  const submit = async (): Promise<void> => {
    const { askingPrice, ...fields } = form.values;
    const { piece } = await api<{ piece: Piece }>("/api/pieces", { method: "POST", json: { ...fields, askingPriceCents: parseEuros(askingPrice) } });
    announce(`Piece ${piece.tagCode} saved.`);
    control.close({ returnFocus: false });
    focusHeading({ afterNavigation: true });
    navigate(`/staff/pieces/${piece.id}`);
  };
  return (
    <DialogForm action={action} submit="Save piece" onSubmit={submit} onCancel={() => control.close()}>
      <div className="form-grid">
      <SelectField form={form} action={action} name="consignorId" label="Consignor" options={options} placeholder="Choose a consignor" />
      <SelectField form={form} action={action} name="category" label="Category" options={CATEGORIES} placeholder="Choose a category" />
      <TextField form={form} action={action} name="brand" label="Brand" />
      <TextField form={form} action={action} name="description" label="Description" />
      <SelectField form={form} action={action} name="size" label="Size" options={SIZES} placeholder="Choose a size" />
      <RadioGroup label="Condition" name="condition" options={CONDITIONS} value={form.values.condition} onChange={(value) => form.set("condition", value)} error={action.problem?.fields.condition} />
      <TextField form={form} action={action} name="askingPrice" problemKey="askingPriceCents" label="Asking price" hint="In euros, such as 49.90" inputMode="decimal" />
      <TextField form={form} action={action} name="intakeDate" label="Intake date" hint="As YYYY-MM-DD" />
      </div>
    </DialogForm>
  );
}

export function PiecesScreen() {
  const { search } = useAddress();
  const status = new URLSearchParams(search).get("status") ?? "on_rail";
  const poll = usePoll(() => api<{ pieces: Piece[] }>(`/api/pieces?status=${status}`), status);
  const create = useDialog("New piece");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pieces = poll.data?.pieces ?? null;
  const selected = pieces?.find((piece) => piece.id === selectedId) ?? pieces?.[0];
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Pieces</Heading>
        <MainAction>
          <button
            ref={(element) => {
              create.opener.current = element;
            }}
            type="button"
            className="button primary"
            onClick={create.open}
          >
            New piece
          </button>
        </MainAction>
      </div>
      <nav className="switcher" aria-label="Piece status">
        {LISTED_STATUSES.map((option) => (
          <Link key={option.value} to={`/staff/pieces?status=${option.value}`} aria-current={option.value === status ? "page" : undefined}>
            {option.label}
          </Link>
        ))}
      </nav>
      <div className="split">
        <div className="split-main">
          {pieces === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Pieces">
              <thead>
                <tr>
                  <th scope="col">Tag code</th>
                  <th scope="col">Description</th>
                  <th scope="col">Consignor</th>
                  <th scope="col">Station</th>
                  <th scope="col" className="amount">Price</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {pieces.map((piece) => (
                  <tr key={piece.id} className={piece.id === selected?.id ? "selected" : undefined}>
                    <td className="num">
                      <Link to={`/staff/pieces/${piece.id}`}>{piece.tagCode}</Link>
                    </td>
                    <td>{piece.description}</td>
                    <td>{piece.consignor.name}</td>
                    <td>{piece.stations.find((station) => station.station === piece.station)?.label}</td>
                    <td className="amount num">{formatMoney(piece.currentPriceCents)}</td>
                    <td>
                      <button type="button" className="row-button" aria-pressed={piece.id === selected?.id} aria-label={`Show ${piece.tagCode}`} onClick={() => setSelectedId(piece.id)}>
                        Show
                      </button>
                    </td>
                  </tr>
                ))}
                {pieces.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No pieces here right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="Selected piece">
          {selected ? (
            <>
              <div className="detail-garment">
                {selected.photos[0] ? <img className="piece-photo" src={selected.photos[0].publicUrl} alt={selected.description} /> : <Garment category={selected.category} seed={selected.tagCode} />}
              </div>
              <h2 className="num">{selected.tagCode}</h2>
              <p>{selected.description}</p>
              <p className="brand">{selected.brand}</p>
              <p className="muted">
                {labelOf(SIZES, selected.size)} · {labelOf(CONDITIONS, selected.condition)} · taken in {formatDate(selected.intakeDate)}
              </p>
              <p className="muted">{labelOf(PIECE_STATUSES, selected.status)}</p>
              <Link to={`/staff/pieces/${selected.id}`}>Open this piece</Link>
            </>
          ) : (
            <Empty title="No pieces have this status." />
          )}
        </aside>
      </div>
      <Dialog control={create} wide>
        <NewPieceForm control={create} />
      </Dialog>
    </main>
  );
}

const requestKey = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function SellForm({ piece, control }: { piece: Piece; control: DialogControl }) {
  const action = useAction();
  const [payment, setPayment] = useState<string>("card");
  const submit = async (): Promise<void> => {
    const key = requestKey();
    const send = (): Promise<{ sale: Sale }> => api<{ sale: Sale }>("/api/sales", { method: "POST", json: { pieceId: piece.id, payment }, headers: { "Request-Key": key } });
    // A retry of the same press reuses its request key, so the till can't record the sale twice.
    const { sale } = await send().catch((error: unknown) => {
      if (error instanceof ApiFailure && error.status === 0) return send();
      throw error;
    });
    announce(`Sold ${sale.tagCode} for ${formatMoney(sale.priceCents)}.`);
    control.close({ returnFocus: false });
    focusHeading({ afterNavigation: true });
    navigate(`/staff/sales/${sale.id}`);
  };
  return (
    <DialogForm action={action} submit="Complete sale" onSubmit={submit} onCancel={() => control.close()}>
      <p className="muted num">{piece.tagCode}, {piece.description}</p>
      <p className="lead num">{formatMoney(piece.currentPriceCents)}</p>
      <RadioGroup label="Payment" name="payment" options={PAYMENTS} value={payment} onChange={setPayment} grid />
    </DialogForm>
  );
}

function ChangePriceForm({ piece, control, poll }: { piece: Piece; control: DialogControl; poll: Poll<{ piece: Piece }> }) {
  const action = useAction();
  const form = useFields(control.name, { askingPrice: formatEuros(piece.askingPriceCents) });
  const version = useRef(piece.version);
  const submit = async (): Promise<void> => {
    const { piece: changed } = await api<{ piece: Piece }>(`/api/pieces/${piece.id}`, { method: "PATCH", json: { askingPriceCents: parseEuros(form.values.askingPrice) }, headers: { "If-Match": `"${version.current}"` } });
    await poll.refresh();
    announce(`Price changed to ${formatMoney(changed.askingPriceCents)}.`);
    control.close();
  };
  return (
    <DialogForm action={action} submit="Save price" onSubmit={submit} onCancel={() => control.close()}>
      <TextField form={form} action={action} name="askingPrice" problemKey="askingPriceCents" label="Asking price" hint="In euros, such as 49.90" inputMode="decimal" />
    </DialogForm>
  );
}

function PlaceHoldForm({ piece, control }: { piece: Piece; control: DialogControl }) {
  const action = useAction();
  const form = useFields(control.name, { name: "", email: "" });
  const submit = async (): Promise<void> => {
    const { hold } = await api<{ hold: Pick<Hold, "id" | "endsAt"> }>(`/api/pieces/${piece.id}/holds`, { method: "POST", json: form.values });
    announce(`Hold placed until ${formatTime(hold.endsAt)}.`);
    control.close({ returnFocus: false });
    focusHeading({ afterNavigation: true });
    navigate(`/staff/holds/${hold.id}`);
  };
  return (
    <DialogForm action={action} submit="Hold piece" onSubmit={submit} onCancel={() => control.close()}>
      <div className="choice-grid">
        <TextField form={form} action={action} name="name" label="Shopper name" />
        <TextField form={form} action={action} name="email" type="email" label="Shopper email" />
      </div>
    </DialogForm>
  );
}

function ArchiveForm({ piece, control, poll }: { piece: Piece; control: DialogControl; poll: Poll<{ piece: Piece }> }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    await api(`/api/pieces/${piece.id}/archive`, { method: "POST" });
    await poll.refresh();
    announce("Piece archived.");
    control.close({ returnFocus: false });
    focusHeading();
  };
  return (
    <DialogForm action={action} submit="Archive piece" onSubmit={submit} onCancel={() => control.close()}>
      <p>{piece.tagCode} leaves every list. You can bring it back exactly as it was.</p>
    </DialogForm>
  );
}

function openerRef(control: DialogControl) {
  return (element: HTMLButtonElement | null): void => {
    control.opener.current = element;
  };
}

function PhotoSection({ piece, role, poll }: { piece: Piece; role: Role; poll: Poll<{ piece: Piece }> }) {
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const onChoose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void action.run(async () => {
      const body = new FormData();
      body.append("photo", file);
      await request(`/api/pieces/${piece.id}/photos`, { method: "POST", body });
      await poll.refresh();
      announce("Photo saved.");
      action.focusAfter(button.current);
    });
  };
  return (
    <section className="photos" aria-label="Photos">
      <h2>Photos</h2>
      <Problems action={action} />
      <ul className="photo-grid" role="list">
        {piece.photos.map((photo) => (
          <li key={photo.id}>
            <img className="piece-photo" src={photo.publicUrl} alt={`${piece.description}, photo`} width={photo.width} height={photo.height} />
            {role === "owner" && (
              <a href={`/api/photos/${photo.id}/original`} download>
                Download original
              </a>
            )}
          </li>
        ))}
      </ul>
      {piece.photos.length === 0 && <p className="muted">No photos yet. Shoppers see a drawing of the garment.</p>}
      <label className="visually-hidden">
        Photo
        <input ref={input} className="visually-hidden" type="file" tabIndex={-1} accept="image/jpeg,image/png,image/webp" onChange={onChoose} />
      </label>
      <Button ref={button} action={action} onClick={() => input.current?.click()}>
        <Upload aria-hidden="true" size={18} /> Add photo
      </Button>
    </section>
  );
}

export function StaffPiecePage({ id, role }: { id: string; role: Role }) {
  const poll = usePoll(() => api<{ piece: Piece }>(`/api/pieces/${id}`), id);
  const sell = useDialog("Sell piece");
  const price = useDialog("Change price");
  const hold = useDialog("Place hold");
  const archive = useDialog("Archive piece");
  const action = useAction();
  const piece = poll.data?.piece;
  if (poll.failure) return <NotFound />;
  if (!piece) {
    return (
      <main className="page">
        <Skeleton />
      </main>
    );
  }
  const owner = role === "owner";
  const simple = (path: string, done: string): Promise<void> =>
    action.run(async () => {
      await api(`/api/pieces/${piece.id}/${path}`, { method: "POST" });
      await poll.refresh();
      announce(done);
      focusHeading();
    });
  return (
    <main className="page">
      <div className="screen-head">
        <Heading className="num">{piece.tagCode}</Heading>
        <MainAction>
          <button ref={openerRef(sell)} type="button" className="button primary" disabled={!SELLABLE.includes(piece.status)} onClick={sell.open}>
            Sell
          </button>
        </MainAction>
      </div>
      <Problems action={action} />
      <div className="piece-page staff">
        <div className="piece-pictures">
          <div className="card-image large">
            {piece.photos[0] ? <img className="piece-photo" src={piece.photos[0].publicUrl} alt={piece.description} /> : <Garment category={piece.category} seed={piece.tagCode} />}
          </div>
          <Tag currentCents={piece.currentPriceCents} previousCents={piece.previousPriceCents} />
        </div>
        <div className="piece-facts">
          <p className="lead">{piece.description}</p>
          <p className="brand">{piece.brand}</p>
          <dl className="facts">
            <div>
              <dt>Consignor</dt>
              <dd>
                <Link to={`/staff/consignors/${piece.consignor.id}`}>{piece.consignor.name}</Link>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{labelOf(PIECE_STATUSES, piece.status)}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{labelOf(SIZES, piece.size)}</dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>{labelOf(CONDITIONS, piece.condition)}</dd>
            </div>
            <div>
              <dt>Asking price</dt>
              <dd className="num">{formatMoney(piece.askingPriceCents)}</dd>
            </div>
            <div>
              <dt>Intake date</dt>
              <dd className="num">{formatDate(piece.intakeDate)}</dd>
            </div>
            {piece.choice && (
              <div>
                <dt>At the end of its period</dt>
                <dd>{piece.choice === "return" ? "Return to me" : "Donate"}</dd>
              </div>
            )}
          </dl>
          <div className="actions">
            {owner && PRICED.includes(piece.status) && (
              <button ref={openerRef(price)} type="button" className="button secondary" onClick={price.open}>
                Change price
              </button>
            )}
            {piece.status === "on_rail" && (
              <button ref={openerRef(hold)} type="button" className="button secondary" onClick={hold.open}>
                Place hold
              </button>
            )}
            {owner && ARCHIVABLE.includes(piece.status) && (
              <button ref={openerRef(archive)} type="button" className="button secondary" onClick={archive.open}>
                Archive
              </button>
            )}
            {owner && piece.status === "archived" && (
              <Button action={action} onClick={() => void simple("restore", "Piece brought back.")}>
                Bring back
              </Button>
            )}
            {piece.status === "returns_shelf" && (
              <Button action={action} onClick={() => void simple("collected", `${piece.tagCode} collected by its consignor.`)}>
                Mark collected
              </Button>
            )}
          </div>
        </div>
      </div>
      <section className="piece-stations" aria-label="Markdown">
        <h2>Markdown stations</h2>
        <Stations stations={piece.stations} />
      </section>
      <PhotoSection piece={piece} role={role} poll={poll} />
      <Dialog control={sell}>
        <SellForm piece={piece} control={sell} />
      </Dialog>
      <Dialog control={price}>
        <ChangePriceForm piece={piece} control={price} poll={poll} />
      </Dialog>
      <Dialog control={hold}>
        <PlaceHoldForm piece={piece} control={hold} />
      </Dialog>
      <Dialog control={archive}>
        <ArchiveForm piece={piece} control={archive} poll={poll} />
      </Dialog>
    </main>
  );
}

export function TillScreen() {
  const action = useAction();
  const form = useFields("Till", { tag: "" });
  const [pieceId, setPieceId] = useState<string | null>(null);
  const sell = useDialog("Sell piece");
  const poll = usePoll(() => (pieceId ? api<{ piece: Piece }>(`/api/pieces/${pieceId}`) : Promise.resolve(null)), pieceId ?? "");
  const piece = poll.data?.piece;
  const find = (): Promise<void> =>
    action.run(async () => {
      const found = await api<{ piece: Piece }>(`/api/pieces/lookup?tag=${encodeURIComponent(form.values.tag)}`);
      setPieceId(found.piece.id);
    });
  return (
    <main className="page narrow">
      <Heading>Till</Heading>
      <div className="till-layout">
      <div>
      <form
        className="till-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!action.pending) void find();
        }}
      >
        <Problems action={action} />
        <TextField form={form} action={action} name="tag" label="Tag code" hint="Any case, dashes optional" />
        <Button action={action} type="submit">
          Find piece
        </Button>
      </form>
      <MainAction>
        <button ref={openerRef(sell)} type="button" className="button primary" disabled={!piece || !SELLABLE.includes(piece.status)} onClick={sell.open}>
          Sell
        </button>
      </MainAction>
      </div>
      {piece && (
        <section className="till-piece" aria-label="Piece found">
          <div className="card-image">
            {piece.photos[0] ? <img className="piece-photo" src={piece.photos[0].publicUrl} alt={piece.description} /> : <Garment category={piece.category} seed={piece.tagCode} />}
          </div>
          <Tag currentCents={piece.currentPriceCents} previousCents={piece.previousPriceCents} />
          <p className="lead num">{piece.tagCode}</p>
          <p>{piece.description}</p>
          <p className="muted">
            {piece.brand} · {labelOf(PIECE_STATUSES, piece.status)}
          </p>
        </section>
      )}
      </div>
      {piece && (
        <Dialog control={sell}>
          <SellForm piece={piece} control={sell} />
        </Dialog>
      )}
    </main>
  );
}

function RefundForm({ sale, control, poll }: { sale: Sale; control: DialogControl; poll: Poll<{ sale: Sale }> }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    await api(`/api/sales/${sale.id}/refund`, { method: "POST" });
    await poll.refresh();
    announce(`Refund recorded. ${sale.tagCode} is back on the rail.`);
    control.close({ returnFocus: false });
    focusHeading();
  };
  return (
    <DialogForm action={action} submit="Confirm refund" onSubmit={submit} onCancel={() => control.close()}>
      <p className="num">
        Refund {formatMoney(sale.priceCents)} for {sale.tagCode}.
      </p>
    </DialogForm>
  );
}

export function SaleScreen({ id, role }: { id: string; role: Role }) {
  const poll = usePoll(() => api<{ sale: Sale }>(`/api/sales/${id}`), id);
  const refund = useDialog("Refund sale");
  const sale = poll.data?.sale;
  if (poll.failure) return <NotFound />;
  if (!sale) {
    return (
      <main className="page">
        <Skeleton />
      </main>
    );
  }
  const payment: Payment = sale.payment;
  return (
    <main className="page narrow">
      <div className="screen-head">
        <Heading className="num">{`Sale ${sale.tagCode}`}</Heading>
        {role !== "bookkeeper" && (
          <MainAction>
            <button ref={openerRef(refund)} type="button" className="button primary" disabled={sale.refundedAt !== null} onClick={refund.open}>
              Refund
            </button>
          </MainAction>
        )}
      </div>
      <dl className="facts wide">
        <div>
          <dt>Sold at</dt>
          <dd className="num">{formatDateTime(sale.soldAt)}</dd>
        </div>
        <div>
          <dt>Sold by</dt>
          <dd>{sale.soldBy.name}</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>{labelOf(PAYMENTS, payment)}</dd>
        </div>
        <div>
          <dt>Consignor</dt>
          <dd>{sale.consignorName}</dd>
        </div>
        <div>
          <dt>Sale price</dt>
          <dd className="num">{formatMoney(sale.priceCents)}</dd>
        </div>
        <div>
          <dt>Consignor share</dt>
          <dd className="num">{formatMoney(sale.consignorShareCents)}</dd>
        </div>
        <div>
          <dt>Commission</dt>
          <dd className="num">{formatMoney(sale.commissionCents)}</dd>
        </div>
        <div>
          <dt>VAT inside the commission</dt>
          <dd className="num">{formatMoney(sale.vatCents)}</dd>
        </div>
        <div>
          <dt>{sale.refundedAt ? "Refunded at" : "Refundable until"}</dt>
          <dd className="num">{formatDateTime(sale.refundedAt ?? sale.refundableUntil)}</dd>
        </div>
      </dl>
      <Dialog control={refund}>
        <RefundForm sale={sale} control={refund} poll={poll} />
      </Dialog>
    </main>
  );
}
