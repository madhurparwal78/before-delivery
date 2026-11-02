import { Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { dollars, FLAVOUR_NAMES } from "../../shared/format";
import { failureOf, Loading, PageFailure, parseDollars, useOfficeData } from "./shared";

// Owner settings: each province's shipping and free-shipping threshold, and the limited drop.
// Saving sends only what changed, and stays on the page.

interface ProvinceSetting {
  code: string;
  name: string;
  shipping_cents: number;
  free_shipping_threshold_cents: number;
}

interface DropSetting {
  flavour: string;
  can_price_cents: number;
  released: number;
}

interface SettingsBody {
  provinces: ProvinceSetting[];
  drop: DropSetting;
}

/** Form values and field errors share these keys. */
const shippingKey = (code: string) => `${code}.shipping_cents`;
const thresholdKey = (code: string) => `${code}.free_shipping_threshold_cents`;
const PRICE_KEY = "drop.can_price_cents";
const RELEASED_KEY = "drop.released";

function formValues(settings: SettingsBody): Record<string, string> {
  const values: Record<string, string> = {
    [PRICE_KEY]: dollars(settings.drop.can_price_cents),
    [RELEASED_KEY]: String(settings.drop.released),
  };
  for (const p of settings.provinces) {
    values[shippingKey(p.code)] = dollars(p.shipping_cents);
    values[thresholdKey(p.code)] = dollars(p.free_shipping_threshold_cents);
  }
  return values;
}

const wholeCans = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

function prefixed(prefix: string, fields: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([field, message]) => [`${prefix}.${field}`, message]));
}

function DollarField({ id, label, value, error, onChange }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="num"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Settings() {
  const { data, failure } = useOfficeData<SettingsBody>("/api/owner/settings");
  const [saved, setSaved] = useState<SettingsBody | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!data) return;
    setSaved(data);
    setValues(formValues(data));
  }, [data]);

  const set = (key: string) => (value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saved) return;
    setPending(true);
    setStatus("");
    const found: Record<string, string> = {};
    const problems: string[] = [];
    const provinces = [...saved.provinces];
    let drop = saved.drop;

    for (const [index, p] of saved.provinces.entries()) {
      const shipping = parseDollars(values[shippingKey(p.code)]);
      const threshold = parseDollars(values[thresholdKey(p.code)]);
      if (shipping === p.shipping_cents && threshold === p.free_shipping_threshold_cents) continue;
      try {
        const { province } = await api<{ province: ProvinceSetting }>("PUT", `/api/owner/provinces/${p.code}`, {
          shipping_cents: shipping,
          free_shipping_threshold_cents: threshold,
        });
        provinces[index] = province;
      } catch (error) {
        const failed = failureOf(error);
        Object.assign(found, prefixed(p.code, failed.body.fields));
        problems.push(failed.message);
      }
    }

    const price = parseDollars(values[PRICE_KEY]);
    const released = wholeCans(values[RELEASED_KEY]);
    const changes = {
      ...(price === saved.drop.can_price_cents ? {} : { can_price_cents: price }),
      ...(released === saved.drop.released ? {} : { released }),
    };
    if (Object.keys(changes).length > 0) {
      try {
        drop = (await api<{ drop: DropSetting }>("PUT", "/api/owner/drop", changes)).drop;
      } catch (error) {
        const failed = failureOf(error);
        Object.assign(found, prefixed("drop", failed.body.fields));
        problems.push(failed.message);
      }
    }

    setSaved({ provinces, drop });
    setErrors(found);
    setStatus(problems.length === 0 ? "Settings saved." : [...new Set(problems)].join(" "));
    setPending(false);
  };

  if (!saved) {
    return (
      <div className="office-page">
        <h1>Settings</h1>
        {failure ? <PageFailure failure={failure} /> : <Loading />}
      </div>
    );
  }

  const dropName = FLAVOUR_NAMES[saved.drop.flavour] ?? saved.drop.flavour;
  return (
    <div className="office-page">
      <h1>Settings</h1>
      <form onSubmit={(event) => void save(event)} noValidate className="settings-form">
        <div className="office-grid">
          <section aria-labelledby="settings-shipping" className="panel span-8">
            <h2 id="settings-shipping">Shipping by province</h2>
            <div className="province-grid">
              {saved.provinces.map((p) => (
                <fieldset key={p.code} className="province-set">
                  <legend>{p.name}</legend>
                  <DollarField
                    id={`set-${shippingKey(p.code)}`}
                    label={`${p.name} shipping`}
                    value={values[shippingKey(p.code)] ?? ""}
                    error={errors[shippingKey(p.code)]}
                    onChange={set(shippingKey(p.code))}
                  />
                  <DollarField
                    id={`set-${thresholdKey(p.code)}`}
                    label={`${p.name} free-shipping threshold`}
                    value={values[thresholdKey(p.code)] ?? ""}
                    error={errors[thresholdKey(p.code)]}
                    onChange={set(thresholdKey(p.code))}
                  />
                </fieldset>
              ))}
            </div>
          </section>
          <section aria-labelledby="settings-drop" className="panel span-4">
            <h2 id="settings-drop">Limited drop</h2>
            <DollarField id="set-drop-price" label={`${dropName} price`} value={values[PRICE_KEY] ?? ""} error={errors[PRICE_KEY]} onChange={set(PRICE_KEY)} />
            <div className="field">
              <label htmlFor="set-drop-released">{`${dropName} released`}</label>
              <input
                id="set-drop-released"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="num"
                value={values[RELEASED_KEY] ?? ""}
                onChange={(event) => set(RELEASED_KEY)(event.target.value)}
                aria-invalid={errors[RELEASED_KEY] ? true : undefined}
                aria-describedby={errors[RELEASED_KEY] ? "set-drop-released-error" : undefined}
              />
              {errors[RELEASED_KEY] && (
                <p id="set-drop-released-error" className="field-error">
                  {errors[RELEASED_KEY]}
                </p>
              )}
            </div>
          </section>
        </div>
        <div className="settings-save">
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            <Save size={18} aria-hidden="true" />
            Save settings
          </button>
          <p role="status" aria-label="Settings status" className="status-line">
            {status}
          </p>
        </div>
      </form>
    </div>
  );
}
