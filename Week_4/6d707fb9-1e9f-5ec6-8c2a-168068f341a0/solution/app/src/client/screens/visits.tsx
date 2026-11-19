import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { READING_UNITS, TOWNS } from "../../shared/catalog";
import type { Label, Reading, Visit } from "../../shared/api";
import { shownDay } from "../../shared/time";
import { ApiFailure, NetworkFailure, announce, navigate, post, useRefresher, useResource, useTitle } from "../lib";
import { Button, Field, Modal, Problems, TableFrame, useDialog, useForm, type DialogControl } from "../ui";
import { RefreshLine } from "../frame";
import { Heading, NotFound } from "./public";

function BookForm({ control }: { control: DialogControl }): JSX.Element {
  const labels = useResource<{ labels: Label[] }>("/api/labels");
  const open = (labels.data?.labels ?? []).filter((label) => label.state === "open");
  const form = useForm("book-visit", { factoryName: "", labelId: "", town: "porto", localDate: "", localTime: "" });
  const { values } = form;
  const labelId = values.labelId || open[0]?.id || "";
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      const visit = await post<Visit>("/api/visits", { ...values, labelId });
      control.hide();
      navigate(`/visits/${visit.id}`);
      announce(`Visit to ${visit.factoryName} booked.`);
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>Book visit</h2>
      <Problems form={form} />
      <Field form={form} name="factoryName" label="Factory" value={values.factoryName} onValue={(value) => form.set("factoryName", value)} />
      <Field form={form} name="labelId" label="Label" value={labelId} onValue={(value) => form.set("labelId", value)} options={open.map((label) => ({ value: label.id, label: label.name }))} />
      <Field form={form} name="town" label="Town" value={values.town} onValue={(value) => form.set("town", value)} options={TOWNS.map((town) => ({ value: town.id, label: town.name }))} />
      <Field form={form} name="localDate" label="Date" hint="As YYYY-MM-DD" value={values.localDate} onValue={(value) => form.set("localDate", value)} />
      <Field form={form} name="localTime" label="Local time" hint="As 24-hour HH:MM" value={values.localTime} onValue={(value) => form.set("localTime", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save visit
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

export function Visits(): JSX.Element {
  useTitle("Visits");
  const visits = useResource<{ visits: Visit[] }>("/api/visits");
  const dialog = useDialog("book-visit");
  const groups = new Map<string, Visit[]>();
  for (const visit of visits.data?.visits ?? []) groups.set(visit.lisbonDate, [...(groups.get(visit.lisbonDate) ?? []), visit]);
  return (
    <main class="desk-main">
      <Heading>Visits</Heading>
      <RefreshLine />
      <div class="screen-actions">
        <span />
        <div class="action-bar">
          <Button green onPress={dialog.show}>
            Book visit
          </Button>
        </div>
      </div>
      {[...groups.entries()].map(([date, entries]) => {
        const hours = entries[0]?.lisbonDayHours;
        return (
          <section key={date} class="panel diary-day" aria-label={shownDay(date)}>
            <h2>{hours === 24 ? shownDay(date) : `${shownDay(date)}, ${hours} hours`}</h2>
            <ul class="plain-list">
              {entries.map((visit) => (
                <li key={visit.id}>
                  <a class="cell-link" href={`/visits/${visit.id}`}>
                    {visit.factoryName}
                  </a>
                  <span>{visit.shown}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {visits.data && !visits.data.visits.length ? (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fake-button">Book visit</span>
          </div>
          <p>No visits yet. Press Book visit to add the first one.</p>
        </div>
      ) : null}
      <Modal name="Book visit" control={dialog}>
        <BookForm control={dialog} />
      </Modal>
    </main>
  );
}

// ---- readings waiting on the device

interface WaitingReading {
  key: string;
  meter: number;
  value: string;
  unit: string;
  savedAt: number;
  keepMine?: boolean;
  /** The published question, while the lower-reading dialog waits for its answer. */
  question?: string;
}

const QUEUE_PREFIX = "fio.readings.";

function readQueue(visitId: string): WaitingReading[] {
  return JSON.parse(localStorage.getItem(QUEUE_PREFIX + visitId) ?? "[]") as WaitingReading[];
}

function writeQueue(visitId: string, queue: WaitingReading[]): void {
  if (queue.length) localStorage.setItem(QUEUE_PREFIX + visitId, JSON.stringify(queue));
  else localStorage.removeItem(QUEUE_PREFIX + visitId);
}

/** How many readings wait on this device, on any visit. */
export function waitingReadings(): number {
  let total = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) as string;
    if (key.startsWith(QUEUE_PREFIX)) total += (JSON.parse(localStorage.getItem(key) as string) as unknown[]).length;
  }
  return total;
}

export function signOutRefusal(count: number): string {
  return count === 1 ? "1 reading is still waiting. Go back online to send it first." : `${count} readings are still waiting. Go back online to send them first.`;
}

function waitingLine(count: number, offline: boolean): string {
  const readings = count === 1 ? "1 reading" : `${count} readings`;
  if (offline) return `Offline — ${readings} waiting on this device.`;
  return count ? `Sending — ${readings} waiting on this device.` : "All readings sent.";
}

export function VisitPage({ id }: { id: string }): JSX.Element {
  const visit = useResource<Visit & { readings: Reading[] }>(`/api/visits/${id}`);
  const [queue, setQueue] = useState<WaitingReading[]>(() => readQueue(id));
  const [offline, setOffline] = useState(false);
  const form = useForm(null, { meter: "", value: "", unit: "kWh" });
  const lowerControl = useDialog();
  const flushing = useRef(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const recordButton = useRef<HTMLDivElement>(null);
  const heading = visit.data ? `Visit to ${visit.data.factoryName}` : "";
  useTitle(heading);

  const update = (next: WaitingReading[]): void => {
    queueRef.current = next;
    writeQueue(id, next);
    setQueue(next);
  };

  /** A dialog opened by the server's answer gives focus back to Record reading. */
  const askLower = (): void => {
    lowerControl.show();
    lowerControl.opener.current = recordButton.current?.querySelector("button") ?? null;
  };

  /** Tries the waiting readings in the order taken; `fromForm` is the reading just pressed. */
  const flush = async (fromForm: string | null): Promise<void> => {
    if (flushing.current) return;
    flushing.current = true;
    let reachable = true;
    try {
      for (const waiting of [...queueRef.current]) {
        if (waiting.question) continue;
        try {
          await post<Reading>(
            `/api/visits/${id}/readings`,
            {
              meter: waiting.meter,
              value: waiting.value,
              unit: waiting.unit,
              secondsAgo: Math.max(0, Math.round((Date.now() - waiting.savedAt) / 1000)),
              ...(waiting.keepMine ? { keepMine: true } : {}),
            },
            { headers: { "Request-Key": waiting.key } },
          );
          update(queueRef.current.filter((entry) => entry.key !== waiting.key));
          await visit.reload().catch(() => undefined);
        } catch (error) {
          if (error instanceof NetworkFailure) {
            reachable = false;
            break;
          }
          if (error instanceof ApiFailure && error.code === "lower_reading") {
            update(queueRef.current.map((entry) => (entry.key === waiting.key ? { ...entry, question: error.message } : entry)));
            askLower();
          } else if (error instanceof ApiFailure && error.status === 422) {
            update(queueRef.current.filter((entry) => entry.key !== waiting.key));
            if (fromForm === waiting.key) form.refuse(error.message, error.fields);
            else announce(error.message);
          }
        }
      }
      setOffline(!reachable);
    } finally {
      flushing.current = false;
    }
  };

  useRefresher(async () => {
    await flush(null);
    if (queueRef.current.some((entry) => entry.question)) askLower();
    try {
      await visit.reload();
      if (!queueRef.current.some((entry) => !entry.question)) setOffline(false);
    } catch (error) {
      if (error instanceof NetworkFailure) setOffline(true);
    }
  });

  useLayoutEffect(() => {
    void flush(null);
    if (queueRef.current.some((entry) => entry.question)) askLower();
  }, [id]);

  if (visit.missing) return <NotFound />;

  const record = (event: Event): void => {
    event.preventDefault();
    const meter = form.values.meter.trim();
    const value = form.values.value.trim();
    const entry: WaitingReading = {
      key: crypto.randomUUID(),
      meter: /^\d+$/.test(meter) ? Number(meter) : Number.NaN,
      value,
      unit: form.values.unit,
      savedAt: Date.now(),
    };
    if (!meter || !value || Number.isNaN(entry.meter) || entry.meter < 1) {
      const fields: Record<string, string> = {};
      if (!meter || Number.isNaN(entry.meter) || entry.meter < 1) fields.meter = "Give a value here.";
      if (!value) fields.value = "Give a value here.";
      form.refuse(Object.values(fields)[0] as string, fields);
      return;
    }
    update([...queueRef.current, entry]);
    form.set("value", "");
    announce(`Reading for meter ${entry.meter} recorded.`);
    void flush(entry.key);
  };

  const asking = queue.find((entry) => entry.question);

  const answerLower = (keep: "mine" | "recorded"): void => {
    if (!asking) return;
    const rest = queueRef.current.filter((entry) => entry.key !== asking.key);
    update(keep === "mine" ? [...rest, { ...asking, key: crypto.randomUUID(), keepMine: true, question: undefined }] : rest);
    lowerControl.hide();
    void flush(null);
  };

  return (
    <main class="desk-main visit-page">
      <Heading>{heading}</Heading>
      {visit.data ? (
        <>
          <p class="visit-time">{visit.data.shown}</p>
          <p class="waiting-line" data-part="waiting-line">
            {waitingLine(queue.length, offline)}
          </p>
          <form class="panel" onSubmit={record} noValidate>
            <h2>Record a reading</h2>
            <Problems form={form} />
            <Field form={form} name="meter" label="Meter" inputMode="numeric" value={form.values.meter} onValue={(value) => form.set("meter", value)} />
            <Field form={form} name="value" label="Reading" inputMode="decimal" value={form.values.value} onValue={(value) => form.set("value", value)} />
            <Field form={form} name="unit" label="Unit" value={form.values.unit} onValue={(value) => form.set("unit", value)} options={READING_UNITS.map((unit) => ({ value: unit.id, label: unit.name }))} />
            <div ref={recordButton} class="action-bar">
              <Button type="submit" green>
                Record reading
              </Button>
            </div>
          </form>
          <h2 class="section-heading">Recorded readings</h2>
          {visit.data.readings.length ? (
            <TableFrame name="Recorded readings">
              <table class="table-fit">
                <thead>
                  <tr>
                    <th scope="col">Meter</th>
                    <th scope="col" class="figure">
                      Reading
                    </th>
                    <th scope="col">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {visit.data.readings.map((reading) => (
                    <tr key={reading.id}>
                      <td>{reading.meter}</td>
                      <td class="figure">{reading.value}</td>
                      <td>{reading.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          ) : (
            <div class="empty-state">
              <div class="fragment fragment-empty" aria-hidden="true">
                <span class="fake-button">Record reading</span>
              </div>
              <p>No readings yet. Record reading is the first action.</p>
            </div>
          )}
        </>
      ) : null}
      <Modal name={asking?.question ?? "Keep which?"} control={lowerControl}>
        <div>
          <h2>{asking?.question}</h2>
          <div class="dialog-actions">
            <Button green onPress={() => answerLower("mine")}>
              Keep mine
            </Button>
            <Button onPress={() => answerLower("recorded")}>Keep recorded</Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
