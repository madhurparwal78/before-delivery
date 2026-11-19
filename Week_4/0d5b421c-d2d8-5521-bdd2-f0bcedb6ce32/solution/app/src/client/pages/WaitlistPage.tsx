import { useEffect, useState, type FormEvent } from "react";
import type { TonightResponse, WaitlistEntryResponse } from "../../shared/api.js";
import { addDays, formatDayLabel, guestsLabel } from "../../shared/calendar.js";
import { get, post } from "../api.js";
import { useAnnouncer } from "../announce.js";
import { DateField, PartySize, TextField } from "../components/Fields.js";
import { Page } from "../components/Shell.js";
import { useRules } from "../reference.js";

function joinedSentence(position: number): string {
  return `You're on the waitlist at position ${position}. We'll email you if a table frees up.`;
}

function validParty(value: string | null): number {
  const party = Number(value);
  return Number.isInteger(party) && party >= 1 && party <= 8 ? party : 2;
}

export function WaitlistPage({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const rules = useRules();
  const slots = rules?.slot_times ?? [];
  const [today, setToday] = useState<string | null>(null);
  const [party, setParty] = useState(() => validParty(params.get("party")));
  const [date, setDate] = useState(() => params.get("date") ?? "");
  const [earliest, setEarliest] = useState(() => params.get("earliest") ?? "18:00");
  const [latest, setLatest] = useState(() => params.get("latest") ?? "22:00");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const { messages, announce } = useAnnouncer(1);

  useEffect(() => {
    void get<TonightResponse>("/api/tonight").then((outcome) => {
      if (!outcome.ok) return;
      setToday(outcome.body.date);
      setDate((current) => (current === "" ? outcome.body.date : current));
    });
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const outcome = await post<WaitlistEntryResponse>("/api/waitlist", { date, party_size: party, earliest, latest, name, email });
    setPending(false);
    if (outcome.ok) {
      setErrors({});
      setPosition(outcome.body.position);
      announce(joinedSentence(outcome.body.position));
    } else {
      setErrors(outcome.failure.fields);
      const first = Object.values(outcome.failure.fields)[0];
      if (first !== undefined) announce(Object.values(outcome.failure.fields).join(" "));
    }
  };

  const horizon = rules?.booking_horizon_days ?? 30;
  return (
    <Page
      summary={`${date === "" ? "" : formatDayLabel(date)} · ${guestsLabel(party)}`.replace(/^ · /, "")}
      live={{ label: "Booking updates", messages }}
      narrow
    >
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <span className="field-label">Party size</span>
          <PartySize value={party} onChange={setParty} />
        </div>
        <DateField value={date} min={today ?? date} max={today === null ? date : addDays(today, horizon)} onChange={setDate} />
        {errors["date"] !== undefined && <p className="field-error">{errors["date"]}</p>}
        <div className="field">
          <label htmlFor="earliest">Earliest time</label>
          <select id="earliest" className="select" value={earliest} onChange={(event) => setEarliest(event.target.value)}>
            {slots.map((slot) => (
              <option key={slot}>{slot}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="latest">Latest time</label>
          <select id="latest" className="select" value={latest} onChange={(event) => setLatest(event.target.value)}>
            {slots.map((slot) => (
              <option key={slot}>{slot}</option>
            ))}
          </select>
          {errors["latest"] !== undefined && <p className="field-error">{errors["latest"]}</p>}
        </div>
        <TextField id="name" label="Name" value={name} onChange={setName} error={errors["name"]} autoComplete="name" />
        <TextField id="email" label="Email" type="email" value={email} onChange={setEmail} error={errors["email"]} autoComplete="email" />
        <button type="submit" className="button button-solid" disabled={pending}>
          Join the waitlist
        </button>
        {position !== null && <p className="notice">{joinedSentence(position)}</p>}
      </form>
    </Page>
  );
}
