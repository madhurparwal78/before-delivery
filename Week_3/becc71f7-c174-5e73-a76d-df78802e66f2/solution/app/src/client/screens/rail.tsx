// The public rail and the public piece page.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { CATEGORIES, CONDITIONS, labelOf, PRICE_BANDS, SIZES } from "../../shared/catalog";
import type { PublicPiece, RailPiece } from "../../shared/api";
import { formatMoney, formatTime } from "../../shared/format";
import { api, ApiFailure } from "../api";
import { useAction, useDialog, useFields, useMedia, usePoll, type DialogControl } from "../hooks";
import { announce, setQuery, useAddress } from "../state";
import { MainAction, PublicBar } from "../ui/bars";
import { Dialog } from "../ui/Dialog";
import { Garment } from "../ui/Garment";
import { Button, DialogForm, Empty, GoneScreen, Heading, Link, NotFound, RadioGroup, Skeleton, TextField } from "../ui/kit";
import { Stations } from "../ui/Stations";
import { Tag } from "../ui/Tag";

const SEARCH_PAUSE_MS = 300;

function PieceImage({ piece }: { piece: Pick<RailPiece, "category" | "tagCode" | "photoUrls" | "description"> }) {
  const photo = piece.photoUrls[0];
  return photo ? <img className="piece-photo" src={photo} alt={piece.description} /> : <Garment category={piece.category} seed={piece.tagCode} />;
}

function Badge({ status }: { status: RailPiece["status"] }) {
  if (status === "on_hold") return <span className="badge">On hold</span>;
  if (status === "sold") return <span className="badge">Sold</span>;
  return null;
}

function PieceCard({ piece }: { piece: RailPiece }) {
  return (
    <li className="card">
      <div className="card-image">
        <PieceImage piece={piece} />
        <Badge status={piece.status} />
      </div>
      <Tag currentCents={piece.currentPriceCents} previousCents={piece.previousPriceCents} />
      <Link to={`/pieces/${piece.id}`} className="card-title">
        {piece.description}
      </Link>
      <p className="brand">{piece.brand}</p>
      <p className="meta">
        {labelOf(SIZES, piece.size)} · {labelOf(CONDITIONS, piece.condition)}
      </p>
    </li>
  );
}

interface Filters {
  params: URLSearchParams;
  setChoice: (key: string, value: string) => void;
  text: string;
  onText: (text: string) => void;
  brands: string[];
}

function FilterFields({ params, setChoice, text, onText, brands }: Filters) {
  const size = params.get("size") ?? "";
  return (
    <div className="filters">
      <div className="field search-field">
        <label htmlFor="rail-search">Search the rail</label>
        <div className="search-box">
          <Search aria-hidden="true" size={18} />
          <input id="rail-search" type="search" value={text} onChange={(event) => onText(event.target.value)} autoComplete="off" />
        </div>
      </div>
      <RadioGroup
        label="Category"
        name="category"
        options={[{ value: "", label: "All" }, ...CATEGORIES]}
        value={params.get("category") ?? ""}
        onChange={(value) => setChoice("category", value)}
        adorn={(option) => {
          const category = CATEGORIES.find((candidate) => candidate.value === option.value);
          return category && <span className="swatch"><Garment category={category.value} /></span>;
        }}
      />
      <div className="size-group" role="group" aria-label="Size">
        <p className="radio-title" aria-hidden="true">
          Size
        </p>
        <div className="pills">
          {SIZES.map((option) => (
            <button key={option.value} type="button" className="pill" aria-pressed={size === option.value} onClick={() => setChoice("size", size === option.value ? "" : option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="rail-brand">Brand</label>
        <div className="select-box">
          <select id="rail-brand" value={params.get("brand") ?? ""} onChange={(event) => setChoice("brand", event.target.value)}>
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={18} />
        </div>
      </div>
      <RadioGroup label="Price" name="price" options={[{ value: "", label: "Any price" }, ...PRICE_BANDS]} value={params.get("price") ?? ""} onChange={(value) => setChoice("price", value)} />
    </div>
  );
}

export function Rail() {
  const { search } = useAddress();
  const params = new URLSearchParams(search);
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wide = useMedia("(min-width: 1100px)");
  const narrow = useMedia("(max-width: 767px)");
  const sheet = useDialog("Filters");

  const rail = usePoll(() => api<{ pieces: RailPiece[] }>(`/api/rail${search}`), search);
  const everything = usePoll(() => api<{ pieces: RailPiece[] }>("/api/rail"), "all");

  useEffect(() => setText(q), [q]);
  useEffect(() => () => clearTimeout(pause.current), []);

  const withChoice = (key: string, value: string): string => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    return query ? `/?${query}` : "/";
  };
  const setChoice = (key: string, value: string): void => setQuery(withChoice(key, value));
  const onText = (value: string): void => {
    setText(value);
    clearTimeout(pause.current);
    pause.current = setTimeout(() => setChoice("q", value), SEARCH_PAUSE_MS);
  };

  const pieces = rail.data?.pieces ?? null;
  const selectedBrand = params.get("brand");
  const brands = [...new Set([...(everything.data?.pieces ?? []).map((piece) => piece.brand), ...(selectedBrand ? [selectedBrand] : [])])].sort((a, b) => a.localeCompare(b));
  const filters: Filters = { params, setChoice, text, onText, brands };

  return (
    <>
      <PublicBar />
      <main className="rail-page">
        <Heading className="visually-hidden">The rail at Atelier Ourlet</Heading>
        {wide && (
          <aside className="filters-column">
            <FilterFields {...filters} />
          </aside>
        )}
        <div className="rail-main">
          {!wide && (
            <MainAction>
              <button
                ref={(element) => {
                  sheet.opener.current = element;
                }}
                type="button"
                className="button primary"
                onClick={sheet.open}
              >
                <SlidersHorizontal aria-hidden="true" size={18} /> Filters
              </button>
            </MainAction>
          )}
          {pieces === null ? (
            <Skeleton />
          ) : pieces.length === 0 ? (
            <Empty title="Nothing on the rail matches these choices.">
              <Garment category="coats" />
            </Empty>
          ) : (
            <ul className="piece-grid" role="list" aria-label="Pieces">
              {pieces.map((piece) => (
                <PieceCard key={piece.id} piece={piece} />
              ))}
            </ul>
          )}
        </div>
      </main>
      <Dialog control={sheet} variant={narrow ? "sheet-bottom" : "sheet-right"}>
        <div className="sheet-head">
          <Button onClick={() => sheet.close()}>
            <X aria-hidden="true" size={18} /> Close filters
          </Button>
        </div>
        <div className="sheet-body">
          <FilterFields {...filters} />
        </div>
        <div className="dialog-foot">
          <Button kind="primary" onClick={() => sheet.close()}>
            {`Show ${pieces?.length ?? 0} pieces`}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function HoldForm({ piece, control }: { piece: PublicPiece; control: DialogControl }) {
  const action = useAction();
  const form = useFields(control.name, { name: "", email: "" });
  const submit = async (): Promise<void> => {
    const { hold } = await api<{ hold: { endsAt: string } }>(`/api/pieces/${piece.id}/holds`, { method: "POST", json: form.values });
    announce(`Held for you until ${formatTime(hold.endsAt)}. The details are on their way by mail.`);
    control.close();
  };
  return (
    <DialogForm action={action} submit="Hold piece" onSubmit={submit} onCancel={() => control.close()}>
      <p className="muted">
        {piece.description}, {formatMoney(piece.currentPriceCents)}
      </p>
      <div className="choice-grid">
        <TextField form={form} action={action} name="name" label="Your name" autoComplete="name" />
        <TextField form={form} action={action} name="email" type="email" label="Email" autoComplete="email" />
      </div>
    </DialogForm>
  );
}

export function PublicPiecePage({ id }: { id: string }) {
  const poll = usePoll(() => api<{ piece: PublicPiece }>(`/api/public/pieces/${id}`), id);
  const hold = useDialog("Hold this piece");
  const piece = poll.data?.piece;
  if (poll.failure instanceof ApiFailure && poll.failure.code === "piece_gone") {
    return (
      <>
        <PublicBar />
        <GoneScreen heading="This piece has left the rail." />
      </>
    );
  }
  if (poll.failure) {
    return (
      <>
        <PublicBar />
        <NotFound />
      </>
    );
  }
  return (
    <>
      <PublicBar />
      <main className="piece-page">
        {piece ? (
          <>
            <div className="piece-pictures">
              <div className="card-image large">
                <PieceImage piece={piece} />
                <Badge status={piece.status} />
              </div>
              <Tag currentCents={piece.currentPriceCents} previousCents={piece.previousPriceCents} />
              {piece.photoUrls.slice(1).map((url) => (
                <img key={url} className="piece-photo thumb" src={url} alt={piece.description} />
              ))}
            </div>
            <div className="piece-facts">
              <Heading>{piece.description}</Heading>
              <p className="brand">{piece.brand}</p>
              <dl className="facts">
                <div>
                  <dt>Size</dt>
                  <dd>{labelOf(SIZES, piece.size)}</dd>
                </div>
                <div>
                  <dt>Condition</dt>
                  <dd>{labelOf(CONDITIONS, piece.condition)}</dd>
                </div>
                <div>
                  <dt>Tag code</dt>
                  <dd className="num">{piece.tagCode}</dd>
                </div>
              </dl>
              <MainAction>
                <button
                  ref={(element) => {
                    hold.opener.current = element;
                  }}
                  type="button"
                  className="button primary"
                  disabled={piece.status === "sold"}
                  onClick={hold.open}
                >
                  Hold this piece
                </button>
              </MainAction>
            </div>
            <section className="piece-stations" aria-label="Markdown">
              <h2>Markdown stations</h2>
              <Stations stations={piece.stations} />
            </section>
            <Dialog control={hold}>
              <HoldForm piece={piece} control={hold} />
            </Dialog>
          </>
        ) : (
          <Skeleton />
        )}
      </main>
    </>
  );
}
