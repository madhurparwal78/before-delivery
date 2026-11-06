// Office closure dates (agency director): the published and added dates per office, and Add closure date.

import { useState, type FormEvent } from "react";
import { api } from "../../../api.js";
import { definePage } from "../../../router.js";
import { Button } from "../../../ui/button.js";
import { TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { useAnnouncer } from "../../../ui/status.js";
import { formatDate } from "../../../../shared/format.js";
import type { OfficeId } from "../../../../shared/zones.js";
import { LOADING, RecordsPage } from "./common.js";
import { failureCopy, useResource } from "../../../workspace/data.js";

interface Office {
  id: OfficeId;
  city: string;
  timeZone: string;
  closures: string[];
}

function OfficeSection({ office, onAdded, announce }: {
  office: Office;
  onAdded: () => Promise<unknown>;
  announce: (text: string) => void;
}) {
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const id = `closure-${office.id}`;
  const form = useFormErrors({ date: id });
  const years = [...new Set(office.closures.map((day) => day.slice(0, 4)))];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api("POST", `/api/offices/${office.id}/closures`, { date });
    setPending(false);
    if (result.ok) {
      form.clear();
      setDate("");
      announce(`Added ${formatDate(date)} to the ${office.city} closure dates. Automatic releases ahead were moved.`);
      await onAdded();
      return;
    }
    if (!form.take(result.error, announce)) announce(failureCopy(result.error));
  };

  return (
    <section className="office-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{office.city}</h2>
      <p className="muted">Office time is {office.timeZone}. Holds never release on these days.</p>
      {years.map((year) => (
        <div key={year} className="closure-year">
          <h3>{year}</h3>
          <ul className="closure-list">
            {office.closures.filter((day) => day.startsWith(year)).map((day) => <li key={day} className="num">{formatDate(day)}</li>)}
          </ul>
        </div>
      ))}
      <Problems items={form.problems} level={3} />
      <form noValidate className="closure-form" onSubmit={(event) => void submit(event)}>
        <TextField id={id} label={`New ${office.city} closure date`} type="date" value={date} onChange={setDate}
          error={form.error("date")} />
        <Button type="submit" pending={pending} pendingLabel="Saving…">Add closure date</Button>
      </form>
    </section>
  );
}

function Offices() {
  const { data, reload } = useResource<{ offices: Office[] }>("/api/offices");
  const { message, announce } = useAnnouncer();
  return (
    <RecordsPage title="Offices" lede="Closure dates decide business days, and so every automatic release."
      statusName="Office" message={message}>
      {data ? (
        <div className="office-grid">
          {data.offices.map((office) => <OfficeSection key={office.id} office={office} onAdded={reload} announce={announce} />)}
        </div>
      ) : LOADING}
    </RecordsPage>
  );
}

definePage({ pattern: "/workspace/offices", kind: "workspace", roles: ["agency_director"], render: () => <Offices /> });
