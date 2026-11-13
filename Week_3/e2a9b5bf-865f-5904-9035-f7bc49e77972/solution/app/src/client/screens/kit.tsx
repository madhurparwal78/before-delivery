import { useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/messages";
import { apertureLabel, apertureMm } from "../../shared/optics";
import { TIME_ZONES } from "../../shared/time";
import type { Barlow, Eyepiece, Site, Telescope } from "../../shared/types";
import { useSelect } from "../lib/store";
import { call } from "../state/http";
import { accountId, app } from "../state/model";
import { refreshKit } from "../state/refresh";
import { FieldShell, firstInvalid, nextId, useSingleFlight } from "../ui/form";
import { Skeleton, WorkingScreen } from "../ui/layout";
import { useLayoutEffect } from "preact/hooks";

type Fields = Record<string, string>;

interface FormSpec {
  path: string;
  order: string[];
  build(values: Fields): Record<string, unknown>;
  empty: Fields;
}

function useKitForm(spec: FormSpec, say: (text: string) => void, refs: Record<string, { current: HTMLElement | null }>) {
  const [values, setValues] = useState<Fields>(spec.empty);
  const [errors, setErrors] = useState<Fields>({});
  const flight = useSingleFlight();
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const submit = (event: Event) => {
    event.preventDefault();
    void flight(async () => {
      const account = accountId();
      const answer = await call<Record<string, unknown> & { fields?: Fields; name?: string }>("POST", spec.path, spec.build(values));
      if (!answer) return say(COPY.needsSignal);
      if (answer.status === 201) {
        setErrors({});
        setValues(spec.empty);
        say(COPY.added(String(answer.body.name ?? values.name ?? "")));
        if (account) await refreshKit();
        refs[spec.order[0]!]?.current?.focus();
        return;
      }
      if (answer.status === 422) {
        const fields = answer.body.fields ?? {};
        setErrors(fields);
        const first = firstInvalid(spec.order, fields);
        if (first) refs[first]?.current?.focus();
        return;
      }
      if (answer.status >= 500) say(COPY.serverError);
    });
  };
  return { values, errors, set, submit };
}

function Input(props: {
  label: string;
  name: string;
  type?: "text" | "number";
  form: ReturnType<typeof useKitForm>;
  refs: Record<string, { current: HTMLElement | null }>;
  ids: Record<string, string>;
}) {
  const { label, name, form, refs, ids, type = "text" } = props;
  const error = form.errors[name];
  return (
    <FieldShell label={label} id={ids[name]!} error={error}>
      <input
        id={ids[name]}
        ref={refs[name] as { current: HTMLInputElement | null }}
        type={type}
        step={type === "number" ? "any" : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        value={form.values[name] ?? ""}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${ids[name]}-error` : undefined}
        onInput={(e) => form.set(name, (e.target as HTMLInputElement).value)}
      />
    </FieldShell>
  );
}

function makeRefs(names: string[]) {
  const refs: Record<string, { current: HTMLElement | null }> = {};
  for (const n of names) refs[n] = useRef<HTMLElement | null>(null);
  return refs;
}

function makeIds(names: string[]) {
  const ids = useRef<Record<string, string>>({});
  for (const n of names) ids.current[n] ??= nextId(n);
  return ids.current;
}

function TelescopeForm({ say }: { say: (t: string) => void }) {
  const names = ["name", "aperture", "aperture_unit", "focal_length_mm"];
  const refs = makeRefs(names);
  const ids = makeIds(names);
  const form = useKitForm(
    {
      path: "/api/kit/telescopes",
      order: names,
      empty: { name: "", aperture: "", aperture_unit: "mm", focal_length_mm: "" },
      build: (v) => ({
        name: v.name,
        aperture: v.aperture === "" ? null : Number(v.aperture),
        aperture_unit: v.aperture_unit,
        focal_length_mm: v.focal_length_mm === "" ? null : Number(v.focal_length_mm),
      }),
    },
    say,
    refs,
  );
  const unit = form.values.aperture_unit === "in" ? "in" : "mm";
  const typed = Number(form.values.aperture);
  const millimetres = form.values.aperture !== "" && Number.isFinite(typed) ? `${apertureLabel(apertureMm(typed, unit))} mm` : "";
  return (
    <form class="stack" onSubmit={form.submit} noValidate>
      <h2>Add a telescope</h2>
      <Input label="Telescope name" name="name" form={form} refs={refs} ids={ids} />
      <div class="pair-row">
        <Input label="Aperture" name="aperture" type="number" form={form} refs={refs} ids={ids} />
        <FieldShell label="Aperture unit" id={ids.aperture_unit!} error={form.errors.aperture_unit}>
          <select
            id={ids.aperture_unit}
            ref={refs.aperture_unit as { current: HTMLSelectElement | null }}
            value={form.values.aperture_unit}
            onChange={(e) => form.set("aperture_unit", (e.target as HTMLSelectElement).value)}
          >
            <option value="mm">mm</option>
            <option value="in">in</option>
          </select>
        </FieldShell>
      </div>
      <div role="status" aria-label="Aperture in millimetres" class="readout-inline">
        {millimetres || null}
      </div>
      <Input label="Focal length (mm)" name="focal_length_mm" type="number" form={form} refs={refs} ids={ids} />
      <button type="submit" class="btn primary">
        Add telescope
      </button>
    </form>
  );
}

function EyepieceForm({ say }: { say: (t: string) => void }) {
  const names = ["name", "focal_length_mm", "apparent_field_deg"];
  const refs = makeRefs(names);
  const ids = makeIds(names);
  const form = useKitForm(
    {
      path: "/api/kit/eyepieces",
      order: names,
      empty: { name: "", focal_length_mm: "", apparent_field_deg: "" },
      build: (v) => ({
        name: v.name,
        focal_length_mm: v.focal_length_mm === "" ? null : Number(v.focal_length_mm),
        apparent_field_deg: v.apparent_field_deg === "" ? null : Number(v.apparent_field_deg),
      }),
    },
    say,
    refs,
  );
  return (
    <form class="stack" onSubmit={form.submit} noValidate>
      <h2>Add an eyepiece</h2>
      <Input label="Eyepiece name" name="name" form={form} refs={refs} ids={ids} />
      <Input label="Eyepiece focal length (mm)" name="focal_length_mm" type="number" form={form} refs={refs} ids={ids} />
      <Input label="Apparent field (°)" name="apparent_field_deg" type="number" form={form} refs={refs} ids={ids} />
      <button type="submit" class="btn">
        Add eyepiece
      </button>
    </form>
  );
}

function BarlowForm({ say }: { say: (t: string) => void }) {
  const names = ["name", "factor"];
  const refs = makeRefs(names);
  const ids = makeIds(names);
  const form = useKitForm(
    {
      path: "/api/kit/barlows",
      order: names,
      empty: { name: "", factor: "" },
      build: (v) => ({ name: v.name, factor: v.factor === "" ? null : Number(v.factor) }),
    },
    say,
    refs,
  );
  return (
    <form class="stack" onSubmit={form.submit} noValidate>
      <h2>Add a Barlow</h2>
      <Input label="Barlow name" name="name" form={form} refs={refs} ids={ids} />
      <Input label="Barlow factor" name="factor" type="number" form={form} refs={refs} ids={ids} />
      <button type="submit" class="btn">
        Add Barlow
      </button>
    </form>
  );
}

function SiteForm({ say }: { say: (t: string) => void }) {
  const names = ["name", "latitude", "longitude", "time_zone"];
  const refs = makeRefs(names);
  const ids = makeIds(names);
  const form = useKitForm(
    {
      path: "/api/sites",
      order: names,
      empty: { name: "", latitude: "", longitude: "", time_zone: "UTC" },
      build: (v) => ({
        name: v.name,
        latitude: v.latitude === "" ? null : Number(v.latitude),
        longitude: v.longitude === "" ? null : Number(v.longitude),
        time_zone: v.time_zone,
      }),
    },
    say,
    refs,
  );
  return (
    <form class="stack" onSubmit={form.submit} noValidate>
      <h2>Add a site</h2>
      <Input label="Site name" name="name" form={form} refs={refs} ids={ids} />
      <div class="pair-row">
        <Input label="Latitude" name="latitude" type="number" form={form} refs={refs} ids={ids} />
        <Input label="Longitude" name="longitude" type="number" form={form} refs={refs} ids={ids} />
      </div>
      <FieldShell label="Time zone" id={ids.time_zone!} error={form.errors.time_zone}>
        <select
          id={ids.time_zone}
          ref={refs.time_zone as { current: HTMLSelectElement | null }}
          value={form.values.time_zone}
          onChange={(e) => form.set("time_zone", (e.target as HTMLSelectElement).value)}
        >
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </FieldShell>
      <button type="submit" class="btn">
        Add site
      </button>
    </form>
  );
}

function KitList({ telescopes, eyepieces, barlows, sites }: { telescopes: Telescope[]; eyepieces: Eyepiece[]; barlows: Barlow[]; sites: Site[] }) {
  return (
    <section class="stack" aria-label="Your kit">
      <h2>Your kit</h2>
      <ul class="rows">
        {telescopes.map((t) => (
          <li key={t.id}>
            <span class="ink">{t.name}</span>
            <span class="muted">{` ${apertureLabel(t.aperture_mm)} mm · ${t.focal_length_mm} mm focal length`}</span>
          </li>
        ))}
        {eyepieces.map((e) => (
          <li key={e.id}>
            <span class="ink">{e.name}</span>
            <span class="muted">{` ${e.focal_length_mm} mm · ${e.apparent_field_deg}° apparent field`}</span>
          </li>
        ))}
        {barlows.map((b) => (
          <li key={b.id}>
            <span class="ink">{b.name}</span>
            <span class="muted">{` ${b.factor.toFixed(1)}×`}</span>
          </li>
        ))}
        {sites.map((s) => (
          <li key={s.id}>
            <span class="ink">{s.name}</span>
            <span class="muted">{` ${s.latitude}, ${s.longitude} · ${s.time_zone}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeviceName() {
  const name = useSelect(app, (s) => s.deviceName);
  return (
    <FieldShell label="This device" id="device-name">
      <input
        id="device-name"
        type="text"
        value={name}
        onInput={(e) => app.set({ deviceName: (e.target as HTMLInputElement).value })}
        onBlur={() => window.localStorage.setItem("lowlamp:device", app.get().deviceName.trim().slice(0, 40) || "laptop")}
        onChange={() => window.localStorage.setItem("lowlamp:device", app.get().deviceName.trim().slice(0, 40) || "laptop")}
      />
    </FieldShell>
  );
}

export function KitScreen() {
  const kit = useSelect(app, (s) => s.server.kit);
  const sites = useSelect(app, (s) => s.server.sites);
  const [message, setMessage] = useState("");
  useLayoutEffect(() => {
    void refreshKit();
  }, []);
  return (
    <WorkingScreen heading="Kit">
      <div role="status" aria-label="Kit status" class="sentences">
        {message ? <p class="sentence">{message}</p> : null}
      </div>
      <TelescopeForm say={setMessage} />
      <EyepieceForm say={setMessage} />
      <BarlowForm say={setMessage} />
      {kit && sites ? (
        <KitList telescopes={kit.telescopes} eyepieces={kit.eyepieces} barlows={kit.barlows} sites={sites} />
      ) : (
        <Skeleton rows={3} />
      )}
      <SiteForm say={setMessage} />
      <h2>This device</h2>
      <DeviceName />
    </WorkingScreen>
  );
}
