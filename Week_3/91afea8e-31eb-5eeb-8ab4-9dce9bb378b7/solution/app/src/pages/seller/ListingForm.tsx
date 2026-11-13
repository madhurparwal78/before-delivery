import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { NotFound } from "../../components/NotFound";
import { ApiFailure, failureMessage, patch, post, api } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { Failure, Loading, StaffGate, paiseText, toPaise, useResource, wholeNumber, type ListingItem } from "./staff";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const NOTE_MAX = 500;
const CATEGORIES = ["kitchen", "fashion", "electronics", "beverages"] as const;

type Photo = ListingItem["photos"][number];
type FieldName = "title" | "brand" | "category" | "description" | "price" | "cost" | "stock" | "returnNote";

/** The names the API uses for the fields, so a server field error lands on its input. */
const FIELD_OF: Record<string, FieldName> = {
  title: "title",
  brand: "brand",
  category: "category",
  description: "description",
  price_paise: "price",
  cost_price_paise: "cost",
  stock: "stock",
  return_note: "returnNote",
};

const LABEL_OF: Record<FieldName, string> = {
  title: "Title",
  brand: "Brand",
  category: "Category",
  description: "Description",
  price: "Price (₹)",
  cost: "Cost price (₹)",
  stock: "Stock",
  returnNote: "Return note",
};

interface Values {
  title: string;
  brand: string;
  category: string;
  description: string;
  returnNote: string;
  price: string;
  cost: string;
  stock: string;
  cod: boolean;
  emi: boolean;
}

const BLANK: Values = { title: "", brand: "", category: CATEGORIES[0], description: "", returnNote: "", price: "", cost: "", stock: "", cod: true, emi: false };

function valuesOf(item: ListingItem): Values {
  return {
    title: item.title,
    brand: "",
    category: item.category,
    description: item.description,
    returnNote: item.return_note,
    price: paiseText(item.price_paise),
    cost: paiseText(item.cost_price_paise),
    stock: String(item.stock),
    cod: item.cod_allowed,
    emi: item.no_cost_emi,
  };
}

const count = (text: string): number => [...text].length;

function listingBody(values: Values, create: boolean, baseTitle: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    description: values.description,
    return_note: values.returnNote,
    price_paise: toPaise(values.price),
    stock: wholeNumber(values.stock),
    cod_allowed: values.cod,
    no_cost_emi: values.emi,
  };
  if (values.cost.trim() !== "") body.cost_price_paise = toPaise(values.cost);
  if (create) {
    body.title = values.title;
    body.brand = values.brand;
    body.category = values.category;
  } else if (values.title !== baseTitle) {
    body.title = values.title;
  }
  return body;
}

/** Each file is POSTed on its own; the first refusal stops the rest and its server message is returned. */
async function uploadPhotos(id: string, files: File[], added: (photo: Photo) => void): Promise<string | null> {
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    try {
      added(await api<Photo>("POST", `/api/seller/listings/${id}/photos`, undefined, { form }));
    } catch (error) {
      return failureMessage(error);
    }
  }
  return null;
}

interface FormProps {
  id: string | null;
  listing: ListingItem | null;
  initialStatus: string;
}

function Form({ id, listing, initialStatus }: FormProps): ReactNode {
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>(listing ? valuesOf(listing) : BLANK);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [others, setOthers] = useState<string[]>([]);
  const [summary, setSummary] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>(listing?.photos ?? []);
  const [staged, setStaged] = useState<File[]>([]);
  const baseTitle = useRef(listing?.title ?? "");
  const summaryRef = useRef<HTMLDivElement>(null);
  const create = id === null;

  useEffect(() => {
    if (summary) summaryRef.current?.focus();
  }, [summary]);

  const set = <K extends keyof Values>(key: K, value: Values[K]): void => setValues((current) => ({ ...current, [key]: value }));

  const choosePhotos = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.target;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;
    if (id === null) {
      setStaged(files);
      return;
    }
    setUploading(true);
    const refusal = await uploadPhotos(id, files, (photo) => setPhotos((current) => [...current, photo]));
    setUploading(false);
    if (refusal) setStatus(refusal);
  };

  const fail = (error: unknown): void => {
    if (error instanceof ApiFailure && error.body.error === "validation_failed") {
      const known: Partial<Record<FieldName, string>> = {};
      const rest: string[] = [];
      for (const [key, message] of Object.entries(error.body.errors ?? {})) {
        const field = FIELD_OF[key];
        if (field) known[field] = message;
        else rest.push(message);
      }
      setErrors(known);
      setOthers(rest);
      setSummary(true);
      setStatus(`Not saved: ${error.body.message}`);
      return;
    }
    if (error instanceof ApiFailure && error.body.error === "listing_quota") setStatus(error.body.message);
    else setStatus(`Not saved: ${failureMessage(error)}`);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setOthers([]);
    setSummary(false);
    try {
      if (id === null) {
        const made = await post<ListingItem>("/api/seller/listings", listingBody(values, true, ""));
        const refusal = await uploadPhotos(made.listing_id, staged, () => undefined);
        navigate(`/seller/listings/${made.listing_id}`, { replace: true, state: { saved: refusal ? `Listing saved. ${refusal}` : "Listing saved." } });
        return;
      }
      const saved = await patch<ListingItem>(`/api/seller/listings/${id}`, listingBody(values, false, baseTitle.current));
      baseTitle.current = saved.title;
      setStatus("Listing saved.");
    } catch (error) {
      fail(error);
    }
    setSaving(false);
  };

  const invalid = (field: FieldName): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `error-${field}` } : {};
  const problem = (field: FieldName): ReactNode =>
    errors[field] ? (
      <p className="field-error" id={`error-${field}`}>
        {errors[field]}
      </p>
    ) : null;

  const failed = Object.keys(errors).length + others.length > 0;

  return (
    <section className="panel panel--black staff-form-panel">
      <form className="staff-form" onSubmit={(event) => void save(event)} noValidate>
        {summary && failed && (
          <div className="form-summary card card--pink" role="alert" tabIndex={-1} ref={summaryRef}>
            <p className="form-summary__title">Check the highlighted fields.</p>
            <ul>
              {(Object.keys(errors) as FieldName[]).map((field) => (
                <li key={field}>
                  <a href={`#field-${field}`}>{LABEL_OF[field]}</a>: {errors[field]}
                </li>
              ))}
              {others.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label htmlFor="field-title">Title</label>
          <input id="field-title" type="text" value={values.title} onChange={(event) => set("title", event.target.value)} {...invalid("title")} />
          <span className={`counter${count(values.title) > TITLE_MAX ? " counter--over" : ""}`}>
            {count(values.title)}/{TITLE_MAX}
          </span>
          {problem("title")}
        </div>

        {create && (
          <div className="staff-form__pair">
            <div className="field">
              <label htmlFor="field-brand">Brand</label>
              <input id="field-brand" type="text" value={values.brand} onChange={(event) => set("brand", event.target.value)} {...invalid("brand")} />
              {problem("brand")}
            </div>
            <div className="field">
              <label htmlFor="field-category">Category</label>
              <select id="field-category" value={values.category} onChange={(event) => set("category", event.target.value)} {...invalid("category")}>
                {CATEGORIES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {problem("category")}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="field-description">Description</label>
          <textarea id="field-description" rows={5} value={values.description} onChange={(event) => set("description", event.target.value)} {...invalid("description")} />
          <span className={`counter${count(values.description) > DESCRIPTION_MAX ? " counter--over" : ""}`}>
            {count(values.description)}/{DESCRIPTION_MAX}
          </span>
          {problem("description")}
        </div>

        <div className="field">
          <label htmlFor="field-returnNote">Return note</label>
          <textarea id="field-returnNote" rows={3} value={values.returnNote} onChange={(event) => set("returnNote", event.target.value)} {...invalid("returnNote")} />
          <span className={`counter${count(values.returnNote) > NOTE_MAX ? " counter--over" : ""}`}>
            {count(values.returnNote)}/{NOTE_MAX}
          </span>
          {problem("returnNote")}
        </div>

        <div className="staff-form__trio">
          <div className="field">
            <label htmlFor="field-price">Price (₹)</label>
            <input id="field-price" type="number" inputMode="decimal" step="0.01" min="0" value={values.price} onChange={(event) => set("price", event.target.value)} {...invalid("price")} />
            {problem("price")}
          </div>
          <div className="field">
            <label htmlFor="field-cost">Cost price (₹)</label>
            <input id="field-cost" type="number" inputMode="decimal" step="0.01" min="0" value={values.cost} onChange={(event) => set("cost", event.target.value)} {...invalid("cost")} />
            {problem("cost")}
          </div>
          <div className="field">
            <label htmlFor="field-stock">Stock</label>
            <input id="field-stock" type="number" inputMode="numeric" step="1" min="0" max="9999" value={values.stock} onChange={(event) => set("stock", event.target.value)} {...invalid("stock")} />
            {problem("stock")}
          </div>
        </div>

        <div className="row">
          <label className="choice">
            <input type="checkbox" checked={values.cod} onChange={(event) => set("cod", event.target.checked)} />
            Cash on delivery
          </label>
          <label className="choice">
            <input type="checkbox" checked={values.emi} onChange={(event) => set("emi", event.target.checked)} />
            No-cost EMI
          </label>
        </div>

        <div className="field">
          <label htmlFor="field-photos">Listing photos</label>
          <input id="field-photos" className="file-input" type="file" multiple disabled={uploading} onChange={(event) => void choosePhotos(event)} />
          {create ? (
            <p className="muted">{staged.length === 0 ? "Photos upload once the listing is saved." : `${staged.length} ${staged.length === 1 ? "photo" : "photos"} ready: ${staged.map((file) => file.name).join(", ")}`}</p>
          ) : (
            <p className="muted">
              {photos.length} of 6 photos{uploading ? ", uploading" : ""}
            </p>
          )}
          {photos.length > 0 && (
            <ul className="photo-strip">
              {photos.map((photo, index) => (
                <li key={photo.photo_id}>
                  <img src={photo.url} alt={`Photo ${index + 1}`} width={96} height={96} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="row">
          <Button type="submit" variant="primary" busy={saving} disabled={uploading}>
            Save listing
          </Button>
        </div>
        <p className="status status-bar" role="status" aria-label="Save status">
          {status}
        </p>
      </form>
    </section>
  );
}

function Heading({ text }: { text: string }): ReactNode {
  return (
    <section className="panel panel--ground staff-head">
      <h1>{text}</h1>
    </section>
  );
}

function EditListing({ id }: { id: string }): ReactNode {
  useTitle("edit listing");
  const location = useLocation();
  const { resource } = useResource<{ listings: ListingItem[] }>(`/api/seller/listings?q=${encodeURIComponent(id)}&limit=1`);
  if (resource.phase === "loading") return <Loading />;
  if (resource.phase === "failed") return <Failure status={resource.status} message={resource.message} />;
  const listing = resource.data.listings.find((item) => item.listing_id === id);
  if (!listing) return <NotFound />;
  const saved = (location.state as { saved?: string } | null)?.saved ?? "";
  return (
    <>
      <Heading text="edit listing" />
      <Form id={id} listing={listing} initialStatus={saved} />
    </>
  );
}

function NewListing(): ReactNode {
  useTitle("new listing");
  return (
    <>
      <Heading text="new listing" />
      <Form id={null} listing={null} initialStatus="" />
    </>
  );
}

export default function ListingForm(): ReactNode {
  const { id } = useParams();
  return <StaffGate role="seller">{id === undefined ? <NewListing key="new" /> : <EditListing key={id} id={id} />}</StaffGate>;
}
