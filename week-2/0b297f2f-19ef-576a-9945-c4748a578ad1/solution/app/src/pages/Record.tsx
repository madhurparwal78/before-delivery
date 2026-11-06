import { useEffect, useState } from "react";
import { formatLength } from "../../shared/units";
import { get } from "../api";
import { luxHours, luxText, photoCount, poundsText, statusText } from "../format";
import { isFailure, useStore } from "../store";
import { Button } from "../ui/Button";
import { Link, Shell } from "../ui/Shell";
import { focusWhenReady } from "../ui/focus";
import type { ObjectRecord } from "../types";
import { ObjectForm } from "./ObjectForm";

const known = new Map<string, ObjectRecord>();

/** Hands a just-saved record to its page so it renders at once. */
export function rememberRecord(o: ObjectRecord): void {
  known.set(o.id, o);
}

export function RecordPage({ id }: { id: string }) {
  const store = useStore();
  const [record, setRecord] = useState<ObjectRecord | null | undefined>(() => known.get(id));
  const [editing, setEditing] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!store.staff) return;
    let live = true;
    const load = () =>
      get<{ object: ObjectRecord }>(`/api/objects/${encodeURIComponent(id)}`)
        .then((d) => live && setRecord(d.object))
        .catch((e) => {
          if (live && isFailure(e, 404)) setRecord(null);
        });
    void load();
    const off = store.onEvents((events) => {
      if (events.some((e) => e.objectId === id)) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [id, store.staff, store.onEvents]);

  const unit = store.unit;
  const p = record?.placementId ? store.placements?.find((x) => x.id === record.placementId) : undefined;
  const lines: [string, string][] = record
    ? [
        ["Object number", record.objectNumber],
        ["Lender", record.lenderName ?? "Ashgrove collection"],
        ["Medium", record.medium || "—"],
        ["Dimensions", `${formatLength(record.widthMm, unit)} × ${formatLength(record.heightMm, unit)}`],
        ["Lux limit", luxText(record.luxLimit)],
        ["Lux-hour budget", `${luxHours(record.luxHourBudget)} lux-hours`],
        ["Insurance value", poundsText(record.insuranceValueGbp)],
        ["Registrar note", record.registrarNote || "—"],
        ["Condition photos", photoCount(record.photos.length)],
        ["Placement status", statusText(record.placementStatus, p?.claimedBy?.name ?? null)],
      ]
    : [];

  return (
    <Shell section="register">
      <main id="main" tabIndex={-1} className="record">
        <p className="back">
          <Link href="/records">Back to the Loan register</Link>
        </p>
        {record === null && <h1 tabIndex={-1}>That record doesn't exist.</h1>}
        {record === undefined && (
          <h1>
            <span className="skeleton-text">Loading the record</span>
          </h1>
        )}
        {record && (
          <>
            <h1 tabIndex={-1} data-record={record.id}>
              {record.title}
            </h1>
            <dl className="record-lines">
              {lines.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={label.startsWith("Lux") || label === "Insurance value" || label === "Dimensions" ? "num" : undefined}>{value}</dd>
                </div>
              ))}
            </dl>
            {store.staff?.role === "registrar" && (
              <Button tone="primary" onClick={(e) => setEditing(e.currentTarget)}>
                Edit record
              </Button>
            )}
          </>
        )}
      </main>
      {editing && record && (
        <ObjectForm
          object={record}
          opener={editing}
          unit={unit}
          onClose={() => setEditing(null)}
          onSaved={(o) => {
            setRecord(o);
            setEditing(null);
            focusWhenReady(() => document.querySelector<HTMLElement>("main h1[data-record]"));
          }}
        />
      )}
    </Shell>
  );
}
