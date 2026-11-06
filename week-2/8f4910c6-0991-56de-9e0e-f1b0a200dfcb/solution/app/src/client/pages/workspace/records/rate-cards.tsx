// Rate cards (agency director): every card with its rates in the published money format, and a new card.

import { useState, type FormEvent } from "react";
import { api } from "../../../api.js";
import { definePage } from "../../../router.js";

import { officeToday } from "../../../../shared/zones.js";
import { Button } from "../../../ui/button.js";
import { FieldError, TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { useAnnouncer } from "../../../ui/status.js";
import { formatDate, formatMoney, parseMoneyInput } from "../../../../shared/format.js";
import { LOADING, RecordsPage } from "./common.js";
import { failureCopy, useResource, useMember } from "../../../workspace/data.js";

const BOARDS = [["women", "Women"], ["men", "Men"], ["creators", "Creators"], ["new_faces", "New Faces"]] as const;
const RATES = [["fullDayCents", "Full day"], ["halfDayCents", "Half day"], ["overtimeQuarterHourCents", "Overtime per quarter hour"]] as const;
const MEDIA = [["digital", "Digital"], ["print", "Print"], ["out_of_home", "Out of home"], ["broadcast", "Broadcast"]] as const;

type BoardKey = (typeof BOARDS)[number][0];
type RateKey = (typeof RATES)[number][0];
type MediaKey = (typeof MEDIA)[number][0];

interface RateCard {
  id: string;
  name: string;
  effectiveFrom: string;
  boards: Record<BoardKey, Record<RateKey, number>>;
  usageBaseCents: Record<MediaKey, number>;
}

function CardView({ card, current }: { card: RateCard; current: boolean }) {
  return (
    <article className="rate-card" aria-labelledby={`card-${card.id}`}>
      <header className="package-head">
        <h2 id={`card-${card.id}`}>{card.name}</h2>
        {current ? <span className="tag quiet">In effect today</span> : null}
      </header>
      <p className="muted">Effective from {formatDate(card.effectiveFrom)}</p>
      <div className="table-scroll" role="region" aria-label={`${card.name} rates`} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr><th scope="col">Board</th>{RATES.map(([key, label]) => <th key={key} scope="col" className="num">{label}</th>)}</tr>
          </thead>
          <tbody>
            {BOARDS.map(([board, label]) => (
              <tr key={board}>
                <th scope="row">{label}</th>
                {RATES.map(([key]) => <td key={key} className="num">{formatMoney(card.boards[board][key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="facts compact">
        {MEDIA.map(([media, label]) => (
          <div key={media}><dt>Usage base, {label}</dt><dd>{formatMoney(card.usageBaseCents[media])}</dd></div>
        ))}
      </dl>
    </article>
  );
}

const fieldId = (key: string) => `card-${key.replace(/\./g, "-")}`;

function NewCard({ onCreated, announce }: { onCreated: (card: RateCard) => Promise<unknown>; announce: (text: string) => void }) {
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [money, setMoney] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const errorFields: Record<string, string> = { name: fieldId("name"), effectiveFrom: fieldId("effective") };
  for (const [board] of BOARDS) errorFields[`boards.${board}`] = fieldId(`${board}.fullDayCents`);
  for (const [media] of MEDIA) errorFields[`usageBaseCents.${media}`] = fieldId(`usage.${media}`);
  const form = useFormErrors(errorFields);
  const cents = (key: string) => parseMoneyInput(money[key] ?? "") ?? 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api<RateCard>("POST", "/api/rate-cards", {
      name,
      effectiveFrom,
      boards: Object.fromEntries(BOARDS.map(([board]) => [board,
        Object.fromEntries(RATES.map(([key]) => [key, cents(`${board}.${key}`)]))])),
      usageBaseCents: Object.fromEntries(MEDIA.map(([media]) => [media, cents(`usage.${media}`)])),
    });
    setPending(false);
    if (result.ok) {
      form.clear();
      announce(`Added the ${result.data.name} rate card, effective from ${formatDate(result.data.effectiveFrom)}.`);
      await onCreated(result.data);
      return;
    }
    if (!form.take(result.error, announce)) announce(failureCopy(result.error));
  };

  const moneyField = (key: string, label: string) => (
    <TextField key={key} id={fieldId(key)} label={label} inputMode="decimal" value={money[key] ?? ""}
      onChange={(value) => setMoney((current) => ({ ...current, [key]: value }))} hint="CAD, like 2,500.00" />
  );

  return (
    <section className="panel" aria-labelledby="new-card-title">
      <h2 id="new-card-title">New rate card</h2>
      <p className="muted">A new card applies to jobs on and after its effective date; earlier jobs keep their card.</p>
      <Problems items={form.problems} />
      <form noValidate className="stack" onSubmit={(event) => void submit(event)}>
        <div className="field-grid">
          <TextField id={fieldId("name")} label="Name" value={name} onChange={setName} error={form.error("name")} />
          <TextField id={fieldId("effective")} label="Effective from" type="date" value={effectiveFrom}
            onChange={setEffectiveFrom} error={form.error("effectiveFrom")} />
        </div>
        {BOARDS.map(([board, label]) => (
          <fieldset key={board} className="money-group">
            <legend className="group-label">{label}</legend>
            <FieldError id={`${fieldId(board)}-rates`} error={form.error(`boards.${board}`)} />
            <div className="field-grid">{RATES.map(([key, rate]) => moneyField(`${board}.${key}`, rate))}</div>
          </fieldset>
        ))}
        <fieldset className="money-group">
          <legend className="group-label">Usage base</legend>
          <div className="field-grid">
            {MEDIA.map(([media, label]) => (
              <div key={media}>
                {moneyField(`usage.${media}`, label)}
                <FieldError id={`${fieldId(media)}-usage`} error={form.error(`usageBaseCents.${media}`)} />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="btn-row">
          <Button type="submit" pending={pending} pendingLabel="Saving…">Add rate card</Button>
        </div>
      </form>
    </section>
  );
}

function RateCards() {
  const { data, reload } = useResource<{ rateCards: RateCard[] }>("/api/rate-cards");
  const { message, announce } = useAnnouncer();
  const member = useMember();
  const today = officeToday(member.office);
  const inEffect = data?.rateCards.filter((card) => card.effectiveFrom <= today).at(-1)?.id;
  return (
    <RecordsPage title="Rate cards" lede="Day, half-day, overtime and usage rates by board. Each booking uses the card in effect on its job day."
      statusName="Rate card" message={message}>
      {data ? (
        <div className="rate-card-list">
          {[...data.rateCards].reverse().map((card) => <CardView key={card.id} card={card} current={card.id === inEffect} />)}
        </div>
      ) : LOADING}
      <NewCard onCreated={reload} announce={announce} />
    </RecordsPage>
  );
}

definePage({ pattern: "/workspace/rate-cards", kind: "workspace", roles: ["agency_director"], render: () => <RateCards /> });
