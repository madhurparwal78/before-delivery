import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, FIELD } from "../../shared/copy";
import { COUNTRIES } from "../../shared/countries";
import { formatDay, formatTime } from "../../shared/format";
import { formatMoney } from "../../shared/money";
import { api, sharedCopy } from "../lib/api";
import { useInterval, useLoad, useWide } from "../lib/hooks";
import { bad, Button, Field, focusFirstError, NoteLine, ok, Problems, SelectField, useAction } from "../ui/Controls";
import { Dialog, useDialog } from "../ui/Dialog";
import { DataTable, EndedPage, NotFoundPage } from "../ui/Shell";
import { useKeepAboveBar } from "../ui/StickyBar";
import { Loader } from "../ui/Visuals";
import { holdStatusLabel, WEEK_STATUS } from "./common";
import { holdRefusal } from "./Sales";

interface ManifestGuest {
  id: string;
  fullName: string;
  nationality: string | null;
  passportOnFile: boolean;
  dateOfBirthOnFile: boolean;
  photoOnFile: boolean;
}

interface ManifestData {
  yachtName: string;
  weekStart: string;
  weekEnd: string;
  maxGuests: number;
  endsAt: string;
  guests: ManifestGuest[];
}

interface GuestForm {
  id: string;
  fullName: string;
  nationality: string;
  dateOfBirth: string;
  passportNumber: string;
}

const NATIONALITIES = [{ value: "", label: "Choose a country" }, ...COUNTRIES.map((c) => ({ value: c.code, label: c.name }))];

export function ManifestPage({ token }: { token: string }) {
  const wide = useWide();
  const manifest = useLoad<ManifestData>(`/api/manifest/${token}`);
  const [forms, setForms] = useState<GuestForm[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ended, setEnded] = useState(false);
  const save = useAction();
  const adding = useAction();
  const photo = useAction();
  const addSheet = useDialog();
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | undefined>();
  const bar = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useKeepAboveBar(bar, !wide);

  const data = manifest.data;
  useEffect(() => {
    if (!data) return;
    setForms((current) =>
      data.guests.map((g) => {
        const kept = current.find((f) => f.id === g.id);
        return kept ?? { id: g.id, fullName: g.fullName, nationality: g.nationality ?? "", dateOfBirth: "", passportNumber: "" };
      }),
    );
  }, [data]);

  if (ended || (manifest.result && !manifest.result.ok && manifest.result.status === 410)) return <EndedPage />;
  if (manifest.result && !manifest.result.ok) return <NotFoundPage />;
  if (!data) return <Loader active />;

  const gone = (status: number) => {
    if (status === 410) setEnded(true);
    return status === 410;
  };

  const labels: Record<string, { label: string; id: string }> = {};
  forms.forEach((f, i) => {
    labels[`guests.${i}.fullName`] = { label: `Guest ${i + 1} full name`, id: `guest-${f.id}-name` };
    labels[`guests.${i}.nationality`] = { label: `Guest ${i + 1} nationality`, id: `guest-${f.id}-nationality` };
    labels[`guests.${i}.dateOfBirth`] = { label: `Guest ${i + 1} date of birth`, id: `guest-${f.id}-birth` };
    labels[`guests.${i}.passportNumber`] = { label: `Guest ${i + 1} passport number`, id: `guest-${f.id}-passport` };
  });

  const update = (id: string, key: keyof GuestForm, value: string) => setForms(forms.map((f) => (f.id === id ? { ...f, [key]: value } : f)));

  const submit = (event: Event) => {
    event.preventDefault();
    void save.run("Saving manifest", async () => {
      const result = await api<{ guests: ManifestGuest[] }>("PUT", `/api/manifest/${token}/guests`, {
        guests: forms.map((f) => ({ id: f.id, fullName: f.fullName, nationality: f.nationality, dateOfBirth: f.dateOfBirth, passportNumber: f.passportNumber })),
      });
      if (result.ok) {
        setErrors({});
        setForms(forms.map((f) => ({ ...f, dateOfBirth: "", passportNumber: "" })));
        await manifest.reload();
        return ok(COPY.manifestSaved);
      }
      if (gone(result.status)) return null;
      const found = result.body.errors ?? {};
      setErrors(found);
      save.focusLater(() => focusFirstError(Object.keys(labels).filter((k) => found[k]).map((k) => labels[k].id)));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  const addGuest = (event: Event) => {
    event.preventDefault();
    void adding.run("", async () => {
      const result = await api<{ guest: ManifestGuest }>("POST", `/api/manifest/${token}/guests`, { fullName: newName });
      if (result.ok) {
        setAddError(undefined);
        addSheet.hide();
        await manifest.reload();
        save.setNote(ok(COPY.guestAdded(result.data.guest.fullName)));
        return null;
      }
      if (gone(result.status)) return null;
      setAddError(result.body.errors?.fullName);
      adding.focusLater(() => focusFirstError(result.body.errors?.fullName ? ["new-guest-name"] : [], addButton.current));
      if (result.body.error === "manifest_full") return bad(COPY.manifestFull(Number(result.body.maxGuests)));
      return result.status === 422 ? null : bad(sharedCopy(result));
    });
  };

  const uploadPhoto = (guest: ManifestGuest, input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    if (!chosen) return;
    void photo.run("Uploading photo", async () => {
      const form = new FormData();
      form.append("photo", chosen, chosen.name);
      const result = await api<{ guest: ManifestGuest }>("POST", `/api/manifest/${token}/guests/${guest.id}/photo`, undefined, form);
      input.value = "";
      if (result.ok) {
        await manifest.reload();
        return ok(COPY.photoSaved(guest.fullName));
      }
      if (gone(result.status)) return null;
      if (result.status === 413) return bad(COPY.photoTooLarge);
      if (result.status === 422) return bad(result.body.errors?.photo ?? FIELD.photo);
      return bad(sharedCopy(result));
    });
  };

  return (
    <section class="manifest">
      <h1 class="rise">Guest manifest for {data.yachtName}</h1>
      <p class="lede">
        Week of <span class="fig">{formatDay(data.weekStart)}</span> to <span class="fig">{formatDay(data.weekEnd)}</span>. Up to{" "}
        <span class="fig">{data.maxGuests}</span> guests. This page works until <span class="fig">{formatTime(data.endsAt)}</span>.
      </p>
      <p class="muted">Passport details you save are kept for the crew and never shown here again.</p>
      <form class="form manifest__form" onSubmit={submit} noValidate>
        <Problems errors={errors} labels={labels} />
        {data.guests.map((g, i) => {
          const f = forms.find((x) => x.id === g.id);
          if (!f) return null;
          return (
            <fieldset key={g.id} class="card guest">
              <legend>Guest {i + 1}</legend>
              <Field id={`guest-${g.id}-name`} label="Full name" value={f.fullName} onInput={(v) => update(g.id, "fullName", v)} error={errors[`guests.${i}.fullName`]} />
              <SelectField id={`guest-${g.id}-nationality`} label="Nationality" value={f.nationality} onChange={(v) => update(g.id, "nationality", v)}
                options={NATIONALITIES} error={errors[`guests.${i}.nationality`]} />
              <div class="field-row">
                <Field id={`guest-${g.id}-birth`} label="Date of birth" value={f.dateOfBirth} onInput={(v) => update(g.id, "dateOfBirth", v)}
                  error={errors[`guests.${i}.dateOfBirth`]} hint="YYYY-MM-DD" />
                <Field id={`guest-${g.id}-passport`} label="Passport number" value={f.passportNumber} onInput={(v) => update(g.id, "passportNumber", v)}
                  error={errors[`guests.${i}.passportNumber`]} hint="Capital letters and digits" />
              </div>
              <div class="guest__notes">
                {g.passportOnFile || g.dateOfBirthOnFile ? <p class="on-file">Passport details on file</p> : null}
                {g.photoOnFile ? <p class="on-file">Photo on file</p> : null}
              </div>
              <div class="guest__photo">
                <label class="sr-only" for={`guest-${g.id}-photo`}>Passport photo for {g.fullName}</label>
                <input
                  id={`guest-${g.id}-photo`}
                  class="sr-only"
                  type="file"
                  accept="image/jpeg,image/png"
                  tabIndex={-1}
                  onChange={(e) => uploadPhoto(g, e.currentTarget as HTMLInputElement)}
                />
                <Button variant="quiet" onClick={() => document.getElementById(`guest-${g.id}-photo`)?.click()}>
                  Add passport photo for {g.fullName}
                </Button>
              </div>
            </fieldset>
          );
        })}
        {data.guests.length ? null : <p class="empty">No guests yet.</p>}
        <NoteLine note={photo.note} />
        <div class="manifest__add">
          <Button variant="quiet" onClick={(e) => { setNewName(""); setAddError(undefined); adding.setNote(null); addSheet.show(e); }} aria-haspopup="dialog">
            Add guest
          </Button>
        </div>
        <div class={wide ? "form__end" : "sticky-bar"} ref={bar}>
          <NoteLine note={save.note} />
          <Button type="submit" pending={save.pending} pendingLabel="Saving manifest">Save manifest</Button>
        </div>
      </form>
      <Dialog handle={addSheet} title="Add guest" variant="sheet">
        <form class="form" onSubmit={addGuest} noValidate>
          <Field id="new-guest-name" label="Full name" value={newName} onInput={setNewName} error={addError} first />
          <NoteLine note={adding.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={adding.pending} buttonRef={addButton}>Add guest</Button>
            <Button variant="quiet" onClick={addSheet.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

interface BrokerWeek {
  weekStart: string;
  weekEnd: string;
  status: "free" | "held" | "booked";
  weeklyRateMinor: number;
  currency: string;
}

interface BrokerData {
  broker: { name: string };
  company: { name: string };
  endsAt: string;
  yachts: { slug: string; name: string; base: string; cabins: number; lengthM: number; weeks: BrokerWeek[] }[];
  holds: { id: string; yachtSlug: string; weekStart: string; clientName: string; status: "waiting" | "live" | "lapsed" | "released" | "charter"; position: number | null; lapsesAt: string | null }[];
}

export function BrokerPage({ token }: { token: string }) {
  const wide = useWide();
  const view = useLoad<BrokerData>(`/api/broker/${token}`);
  useInterval(() => void view.reload(), 10_000);
  const sheet = useDialog();
  const action = useAction();
  const page = useAction();
  const [target, setTarget] = useState<{ slug: string; name: string; week: BrokerWeek } | null>(null);
  const [client, setClient] = useState("");
  const [error, setError] = useState<string | undefined>();
  const placeButton = useRef<HTMLButtonElement>(null);

  if (view.result && !view.result.ok) return view.result.status === 410 ? <EndedPage /> : <NotFoundPage />;
  const data = view.data;
  if (!data) return <Loader active />;
  const names = new Map(data.yachts.map((y) => [y.slug, y.name]));

  const submit = (event: Event) => {
    event.preventDefault();
    if (!target) return;
    void action.run("Placing hold", async () => {
      const result = await api<{ hold: BrokerData["holds"][number] }>("POST", `/api/broker/${token}/holds`, {
        yachtSlug: target.slug, weekStart: target.week.weekStart, clientName: client, queue: target.week.status === "held",
      });
      await view.reload();
      if (result.ok) {
        const h = result.data.hold;
        sheet.hide();
        page.setNote(ok(h.status === "live"
          ? COPY.holdPlaced(h.clientName, target.name, formatDay(h.weekStart), formatTime(h.lapsesAt!))
          : COPY.joinedLine(h.clientName, h.position!, target.name, formatDay(h.weekStart))));
        return null;
      }
      setError(result.body.errors?.clientName);
      action.focusLater(() => focusFirstError(result.body.errors?.clientName ? ["broker-client"] : [], placeButton.current));
      if (result.status === 429) return bad(COPY.tooManyHolds(Number(result.body.retryAfterSeconds)));
      return result.status === 422 ? null : bad(holdRefusal(result.body, result.status));
    });
  };

  return (
    <section class="broker">
      <h1 class="rise">Availability for {data.broker.name}</h1>
      <p class="lede">
        From {data.company.name}. Weekly rates in EUR; hold times in Split time. This page works until <span class="fig">{formatTime(data.endsAt)}</span>.
      </p>
      <NoteLine note={page.note} />
      {data.yachts.map((y) => (
        <section key={y.slug} class="broker__yacht">
          <h2>{y.name}</h2>
          <p class="muted">{y.base === "lavrio" ? "Lavrio" : "Split"} base · <span class="fig">{y.cabins}</span> cabins</p>
          <div class={wide ? "week-strip" : "week-stack"} tabIndex={wide ? 0 : undefined} role={wide ? "region" : undefined} aria-label={wide ? "Weeks, scroll sideways" : undefined}>
            <ul class="weeks" aria-label={`Weeks for ${y.name}`}>
              {y.weeks.map((w) => (
                <li key={w.weekStart} class={`week week--${w.status}`}>
                  <span class="week__date">Week of {formatDay(w.weekStart)}</span>
                  <span class={`pill pill--${w.status}`}>{WEEK_STATUS[w.status]}</span>
                  <span class="week__rate fig">{formatMoney(w.currency, w.weeklyRateMinor)}</span>
                  {w.status !== "booked" ? (
                    <Button variant={w.status === "free" ? "primary" : "quiet"}
                      onClick={(e) => { setTarget({ slug: y.slug, name: y.name, week: w }); setClient(""); setError(undefined); action.setNote(null); sheet.show(e); }}
                      aria-haspopup="dialog">
                      Hold {y.name}, week of {formatDay(w.weekStart)}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
      {data.yachts.length ? null : <p class="empty">No yachts on sale.</p>}
      <h2>Your holds</h2>
      <DataTable
        name="Your holds"
        captionHidden
        rows={data.holds}
        rowKey={(h) => h.id}
        empty="No holds yet."
        columns={[
          { label: "Client", cell: (h) => h.clientName },
          { label: "Yacht", cell: (h) => names.get(h.yachtSlug) ?? h.yachtSlug },
          { label: "Week", cell: (h) => <span class="fig">{formatDay(h.weekStart)}</span> },
          { label: "Status", cell: (h) => <span class={`pill pill--${h.status}`}>{holdStatusLabel(h)}</span> },
          { label: "Lapses", cell: (h) => <span class="fig">{h.status === "waiting" || !h.lapsesAt ? "—" : formatTime(h.lapsesAt)}</span> },
        ]}
      />
      <Dialog handle={sheet} title="Hold for a client" variant="sheet">
        <form class="form" onSubmit={submit} noValidate>
          {target ? <p class="dialog__context">{target.name}, week of {formatDay(target.week.weekStart)}</p> : null}
          <Field id="broker-client" label="Client name" value={client} onInput={setClient} error={error} first />
          <NoteLine note={action.note} />
          <div class="dialog__actions">
            <Button type="submit" pending={action.pending} pendingLabel="Placing hold" buttonRef={placeButton}>
              {target?.week.status === "held" ? "Join the line" : "Place hold"}
            </Button>
            <Button variant="quiet" onClick={sheet.hide}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
