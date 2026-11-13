import { useEffect, useRef, useState } from "react";
import type { AdminProduct, AdminVariant, UploadedImage } from "../../shared/api";
import { Loading } from "../components/Panel";
import { ApiFail, api, newKey } from "../lib/api";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { useData } from "../lib/useData";
import { ErrorAlert, PageTitle, SelectField, StatusBlock, TableWrap, TextField, toneOf, useAction } from "./ui";

const STATUS_WORD = { draft: "Draft", published: "Published", archived: "Archived" } as const;

export function ProductsList() {
  const { data, loading } = useData<AdminProduct[]>("/api/admin/products");
  if (loading || !data) return <Loading />;
  return (
    <>
      <PageTitle>Products</PageTitle>
      <TableWrap>
        <table className="tbl">
          <caption className="sr-only">Products</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Status</th>
              <th scope="col">Variants</th>
            </tr>
          </thead>
          <tbody>
            {data.map((product) => (
              <tr key={product.slug}>
                <td>
                  <Link href={`/admin/products/${product.slug}`}>{product.name}</Link>
                </td>
                <td>
                  <StatusBlock word={STATUS_WORD[product.status]} tone={toneOf(product.status)} />
                </td>
                <td>{product.variants.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

interface Draft {
  price: string;
  compare: string;
  bhiwandi: string;
  gurugram: string;
}

function toDraft(variant: AdminVariant): Draft {
  const at = (location: string) => String(variant.stock.find((s) => s.location === location)?.available ?? 0);
  return {
    price: String(variant.price),
    compare: variant.compare_at === null ? "" : String(variant.compare_at),
    bhiwandi: at("bhiwandi"),
    gurugram: at("gurugram"),
  };
}

function same(a: Draft, b: Draft): boolean {
  return a.price === b.price && a.compare === b.compare && a.bhiwandi === b.bhiwandi && a.gurugram === b.gurugram;
}

/** A typed number goes to the API as a number when it is whole; anything else goes as typed so the API names the problem. */
function wire(text: string): number | string {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

interface VariantFormProps {
  variant: AdminVariant;
  reload: () => Promise<AdminProduct>;
}

function VariantForm({ variant, reload }: VariantFormProps) {
  const [draft, setDraft] = useState(() => toDraft(variant));
  const [version, setVersion] = useState(variant.version);
  const { pending, error, run, clear } = useAction();
  const base = useRef(toDraft(variant));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const edit = (field: keyof Draft) => (value: string) => setDraft({ ...draftRef.current, [field]: value });

  // A live change replaces only what the manager has not touched.
  useEffect(() => {
    const next = toDraft(variant);
    if (same(draftRef.current, base.current)) {
      setDraft(next);
      setVersion(variant.version);
    }
    base.current = next;
  }, [variant]);

  /** Takes the server's record as the new base; with `keepEdits` the fields the manager changed stay as typed. */
  const resync = (fresh: AdminVariant | undefined, keepEdits: boolean) => {
    if (!fresh) return;
    const next = toDraft(fresh);
    const before = base.current;
    const current = draftRef.current;
    base.current = next;
    const keep = (field: keyof Draft): string => (keepEdits && current[field] !== before[field] ? current[field] : next[field]);
    setDraft({ price: keep("price"), compare: keep("compare"), bhiwandi: keep("bhiwandi"), gurugram: keep("gurugram") });
    setVersion(fresh.version);
    clear();
  };

  const reloadLatest = async () => {
    const product = await reload();
    resync(product.variants.find((v) => v.sku === variant.sku), true);
  };

  const save = async () => {
    const body: Record<string, unknown> = { version };
    if (draft.price !== base.current.price) body.price = wire(draft.price);
    if (draft.compare !== base.current.compare) body.compare_at = draft.compare.trim() === "" ? null : wire(draft.compare);
    const stock: { location: string; available: number | string }[] = [];
    for (const location of ["bhiwandi", "gurugram"] as const) {
      if (draft[location] !== base.current[location]) {
        stock.push({ location, available: wire(draft[location]) });
      }
    }
    if (stock.length) body.stock = stock;
    const ok = await run(async () => {
      await api.patch(`/api/admin/variants/${variant.sku}`, body);
      return `Saved ${variant.sku}.`;
    });
    if (ok) resync((await reload()).variants.find((v) => v.sku === variant.sku), false);
  };

  // Field errors come back keyed by field; stock errors by their position in the list that was sent.
  const failure = error instanceof ApiFail ? error : null;
  const sentLocations = (["bhiwandi", "gurugram"] as const).filter((l) => draft[l] !== base.current[l]);
  const fieldError = (key: string): string | undefined => failure?.fields[key];
  const stockError = (location: "bhiwandi" | "gurugram"): string | undefined => {
    const index = sentLocations.indexOf(location);
    return failure?.fields[`stock.${index}.available`] ?? failure?.fields[`stock.${index}.location`];
  };

  return (
    <div role="group" aria-label={variant.sku} className="variant-form">
      <h3 className="variant-title">
        {variant.sku} <span className="muted">{variant.colour}, {variant.size}</span>
      </h3>
      <div className="variant-fields">
        <TextField label="Price" inputMode="numeric" value={draft.price} onChange={edit("price")} error={fieldError("price")} />
        <TextField label="Compare-at price" inputMode="numeric" value={draft.compare} onChange={edit("compare")} error={fieldError("compare_at")} />
        <TextField label="Available at Bhiwandi" type="number" value={draft.bhiwandi} onChange={edit("bhiwandi")} error={stockError("bhiwandi")} />
        <TextField label="Available at Gurugram" type="number" value={draft.gurugram} onChange={edit("gurugram")} error={stockError("gurugram")} />
      </div>
      <ErrorAlert error={failure && failure.code !== "validation_failed" ? failure : null} onReload={() => void reloadLatest()} />
      <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>
        {pending ? "Saving" : `Save ${variant.sku}`}
      </button>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

export function ProductPage({ slug }: { slug: string }) {
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [missing, setMissing] = useState<ApiFail | null>(null);

  const load = async (): Promise<AdminProduct> => {
    const fresh = await api.get<AdminProduct>(`/api/admin/products/${slug}`);
    setProduct(fresh);
    return fresh;
  };

  useEffect(() => {
    load().catch((failure: ApiFail) => setMissing(failure));
  }, [slug]);

  const refresh = (sku: string) => {
    if (product?.variants.some((v) => v.sku === sku)) void load();
  };
  useLive("price", (event) => refresh(event.sku));
  useLive("stock", (event) => refresh(event.sku));

  if (missing) return <ErrorAlert error={missing} />;
  if (!product) return <Loading />;
  return (
    <>
      <PageTitle>{product.name}</PageTitle>
      <StatusSection product={product} reload={load} />
      <section aria-labelledby="variants-heading">
        <h2 id="variants-heading">Variants</h2>
        {product.variants.map((variant) => (
          <VariantForm key={variant.sku} variant={variant} reload={load} />
        ))}
      </section>
      <ImageUpload product={product} reload={load} />
    </>
  );
}

function StatusSection({ product, reload }: { product: AdminProduct; reload: () => Promise<AdminProduct> }) {
  const [status, setStatus] = useState<string>(product.status);
  const [version, setVersion] = useState(product.version);
  const { pending, error, run, clear } = useAction();
  const baseStatus = useRef(product.status);

  useEffect(() => {
    if (status === baseStatus.current) {
      setStatus(product.status);
      setVersion(product.version);
    }
    baseStatus.current = product.status;
  }, [product]);

  const save = async () => {
    const ok = await run(async () => {
      await api.patch(`/api/admin/products/${product.slug}`, { version, status });
      return `Saved ${product.slug}.`;
    });
    if (ok) {
      const fresh = await reload();
      baseStatus.current = fresh.status;
      setStatus(fresh.status);
      setVersion(fresh.version);
    }
  };

  const reloadLatest = async () => {
    const fresh = await reload();
    baseStatus.current = fresh.status;
    setStatus(fresh.status);
    setVersion(fresh.version);
    clear();
  };

  return (
    <section aria-labelledby="status-heading" className="staff-section">
      <h2 id="status-heading">Status</h2>
      <SelectField label="Product status" value={status} onChange={setStatus} options={STATUS_OPTIONS} error={error?.fields.status} />
      <ErrorAlert error={error && error.code !== "validation_failed" ? error : null} onReload={() => void reloadLatest()} />
      <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>
        {pending ? "Saving" : "Save status"}
      </button>
    </section>
  );
}

function ImageUpload({ product, reload }: { product: AdminProduct; reload: () => Promise<AdminProduct> }) {
  const colours = [...new Set(product.variants.map((v) => v.colour))];
  const [colour, setColour] = useState(colours[0] ?? "");
  const [alt, setAlt] = useState("");
  const [failedFile, setFailedFile] = useState<{ file: File; key: string; colour: string; alt: string } | null>(null);
  const { pending, error, run } = useAction();
  const input = useRef<HTMLInputElement>(null);

  const send = async (file: File, key: string, chosenColour: string, chosenAlt: string) => {
    const ok = await run(async () => {
      const form = new FormData();
      form.set("colour", chosenColour);
      form.set("alt", chosenAlt);
      form.set("file", file);
      await api.upload<UploadedImage>(`/api/admin/products/${product.slug}/images`, form, key);
      return `Image added to ${product.name} in ${chosenColour}.`;
    });
    setFailedFile(ok ? null : { file, key, colour: chosenColour, alt: chosenAlt });
    if (ok) {
      setAlt("");
      await reload();
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void send(file, newKey(), colour, alt);
    if (input.current) input.current.value = "";
  };

  const failure = error && error.code !== "validation_failed" ? error : null;
  return (
    <section aria-labelledby="image-heading" className="staff-section">
      <h2 id="image-heading">Images</h2>
      <TextField label="Alt text" value={alt} onChange={setAlt} error={error?.fields.alt} />
      <SelectField label="Image colour" value={colour} onChange={setColour} options={colours.map((c) => ({ value: c, label: c }))} error={error?.fields.colour} />
      {error?.fields.file && <p className="field-error">{error.fields.file}</p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Product image" className="sr-only" tabIndex={-1} onChange={(event) => onFile(event.target.files?.[0])} />
      <ErrorAlert error={failure} />
      <div className="staff-actions">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => input.current?.click()}>
          {pending ? "Saving" : "Upload image"}
        </button>
        {failedFile && failure && (
          <button type="button" className="btn" disabled={pending} onClick={() => void send(failedFile.file, failedFile.key, failedFile.colour, failedFile.alt)}>
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
