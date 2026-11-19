import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { request, sessionEnded, type Answer, type Board, type CalendarInfo, type Fee, type Settings } from "../api";
import { ActionButton, Dialog, FieldMessage, FormProblems, Num, PegStrip, Status, usePoll, type Problem } from "../components/ui";
import { capitalised, centsFromTyped, dollars } from "../format";
import { takeDraft } from "../session";
import { useShell, type Me } from "../shell";
import { FEE_WORD } from "./Account";
import { PaneAnnouncements } from "./Pegboard";
import { useAnnouncer } from "./useAnnouncer";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const SHAPES = ["generic", "drill", "saw", "ladder", "hammer", "wrench", "case", "battery", "cable", "blade"] as const;

interface Row {
  open: boolean;
  opens: string;
  closes: string;
}
type Rows = Record<string, Row>;
type RuleField = "late" | "damage" | "period" | "zone";

const RULE_LABELS: Record<RuleField, string> = { late: "Late fee per open day", damage: "Damage fee", period: "Loan period in days", zone: "Time zone" };
const RULE_FOR_API: Record<string, RuleField> = { late_fee_cents: "late", damage_fee_cents: "damage", loan_period_days: "period", time_zone: "zone" };

function rowsFrom(calendar: CalendarInfo, previous: Rows | null): Rows {
  const rows: Rows = {};
  for (const day of WEEKDAYS) {
    const hours = calendar.hours.find((h) => h.weekday === day);
    rows[day] = hours ? { open: true, opens: hours.opens, closes: hours.closes } : { open: false, opens: previous?.[day]?.opens ?? "", closes: previous?.[day]?.closes ?? "" };
  }
  return rows;
}

function rulesFrom(settings: Settings): Record<RuleField, string> {
  return {
    late: dollars(settings.late_fee_cents),
    damage: dollars(settings.damage_fee_cents),
    period: String(settings.loan_period_days),
    zone: settings.time_zone,
  };
}

interface NewPart {
  name: string;
  shape: string;
  width: string;
  height: string;
}

export function Office({ me }: { me: Me }) {
  const shell = useShell();
  const news = useAnnouncer(me);
  const summary = useRef<HTMLDivElement>(null);
  const [rules, setRules] = useState<Record<RuleField, string> | null>(null);
  const editedRules = useRef(new Set<RuleField>());
  const [rows, setRows] = useState<Rows | null>(null);
  const editedRows = useRef(new Set<string>());
  const [closureDate, setClosureDate] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const editedClosure = useRef(new Set<"date" | "reason">());
  const [calendar, setCalendar] = useState<CalendarInfo | null>(null);
  const [fees, setFees] = useState<Fee[]>([]);
  const [toolCount, setToolCount] = useState(0);
  // The panels render once the first read lands, so the page does not jump as each one fills in.
  const [loaded, setLoaded] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [fieldMessages, setFieldMessages] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<"rules" | "hours" | "closure" | "tool" | null>(null);
  const [toolOpen, setToolOpen] = useState(false);
  const [tool, setTool] = useState({ tag: "", name: "", cost: "", parts: [{ name: "", shape: "generic", width: "2", height: "2" }] as NewPart[] });
  const [toolProblems, setToolProblems] = useState<Problem[]>([]);
  const addToolButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"summary" | "add-tool" | null>(null);
  const zones = useRef(Intl.supportedValuesOf("timeZone"));

  useLayoutEffect(() => {
    if (focusAfter.current === "summary") summary.current?.focus();
    if (focusAfter.current === "add-tool") addToolButton.current?.focus();
    focusAfter.current = null;
  });

  const read = useCallback(async () => {
    const [settingsAnswer, calendarAnswer, feeAnswer, boardAnswer] = await Promise.all([
      request<Settings>("GET", "/api/settings"),
      request<CalendarInfo>("GET", "/api/calendar"),
      request<{ fees: Fee[] }>("GET", "/api/fees"),
      request<Board>("GET", "/api/board"),
    ]);
    if (settingsAnswer.status === 200) {
      const server = rulesFrom(settingsAnswer.body);
      setRules((current) => {
        if (!current) return server;
        const next = { ...server };
        for (const field of editedRules.current) next[field] = current[field];
        return next;
      });
    }
    if (calendarAnswer.status === 200) {
      setCalendar(calendarAnswer.body);
      setRows((current) => {
        const server = rowsFrom(calendarAnswer.body, current);
        if (!current) return server;
        for (const day of editedRows.current) server[day] = current[day]!;
        return server;
      });
    }
    if (feeAnswer.status === 200) setFees(feeAnswer.body.fees);
    if (boardAnswer.status === 200) {
      setToolCount(boardAnswer.body.items.length);
      shell.setCounts(boardAnswer.body.counts);
    }
  }, []);

  useEffect(() => {
    void read().finally(() => setLoaded(true)).then(() => {
      const draft = takeDraft("/office", me.user.id);
      if (!draft) return;
      const kept = draft.fields;
      if (kept.closureDate !== undefined) (setClosureDate(kept.closureDate), editedClosure.current.add("date"));
      if (kept.closureReason !== undefined) (setClosureReason(kept.closureReason), editedClosure.current.add("reason"));
      setRules((current) => {
        if (!current) return current;
        const next = { ...current };
        for (const field of Object.keys(RULE_LABELS) as RuleField[]) {
          const value = kept[`rule-${field}`];
          if (value !== undefined) {
            next[field] = value;
            editedRules.current.add(field);
          }
        }
        return next;
      });
      if (draft.hours) {
        setRows((current) => ({ ...current!, ...draft.hours }));
        for (const day of Object.keys(draft.hours)) editedRows.current.add(day);
      }
    });
  }, []);
  usePoll(read, 10_000);

  const keptDraft = () => {
    const fields: Record<string, string> = {};
    if (editedClosure.current.has("date")) fields.closureDate = closureDate;
    if (editedClosure.current.has("reason")) fields.closureReason = closureReason;
    for (const field of editedRules.current) fields[`rule-${field}`] = rules![field];
    const hours: Rows = {};
    for (const day of editedRows.current) hours[day] = rows![day]!;
    return { fields, hours };
  };

  /** Shows a refusal: a 422's fields in the summary and under each field, anything else in the announcements. */
  const refused = (answer: Answer<unknown>, labels: (field: string) => { label: string; target: string }) => {
    if (sessionEnded(answer)) {
      setToolOpen(false);
      news.sessionEnded(keptDraft());
      return;
    }
    if (answer.status === 422) {
      const entries = Object.entries(answer.fields);
      setProblems(entries.map(([field, message]) => ({ field, message, ...labels(field) })));
      setFieldMessages(Object.fromEntries(entries.map(([field, message]) => [labels(field).target, message])));
      focusAfter.current = "summary";
      return;
    }
    news.announce(answer.error);
  };

  const saveRules = async () => {
    if (!rules) return;
    const late = centsFromTyped(rules.late);
    const damage = centsFromTyped(rules.damage);
    const period = /^\d+$/.test(rules.period.trim()) ? Number(rules.period) : null;
    setPending("rules");
    const answer = await request<Settings>("PUT", "/api/settings", {
      time_zone: rules.zone,
      late_fee_cents: late ?? rules.late,
      damage_fee_cents: damage ?? rules.damage,
      loan_period_days: period ?? rules.period,
    });
    setPending(null);
    if (answer.status === 200) {
      editedRules.current.clear();
      setRules(rulesFrom(answer.body));
      setProblems([]);
      setFieldMessages({});
      news.announce("Fee rules saved. They apply to loans checked out from now on.");
      return;
    }
    refused(answer, (field) => ({ label: RULE_LABELS[RULE_FOR_API[field] ?? "late"], target: `rule-${RULE_FOR_API[field] ?? "late"}` }));
  };

  const saveHours = async (event?: Event) => {
    event?.preventDefault();
    if (!rows || pending === "hours") return;
    setPending("hours");
    const hours = WEEKDAYS.filter((day) => rows[day]!.open).map((day) => ({ weekday: day, opens: rows[day]!.opens.trim(), closes: rows[day]!.closes.trim() }));
    const answer = await request<{ moved_loans: number }>("PUT", "/api/calendar/hours", { hours });
    setPending(null);
    if (answer.status === 200) {
      editedRows.current.clear();
      setProblems([]);
      setFieldMessages({});
      news.announce(`Opening hours saved. ${answer.body.moved_loans} loans moved to the next open day.`);
      await read();
      return;
    }
    refused(answer, (field) => {
      const [, day, which] = field.split(".");
      return day ? { label: `${capitalised(day)} ${which}`, target: `hours-${day}-${which}` } : { label: "Opening hours", target: "save-hours" };
    });
  };

  const declareClosure = async () => {
    setPending("closure");
    const answer = await request<{ moved_loans: number; new_due_date: string }>("POST", "/api/closures", { date: closureDate.trim(), reason: closureReason });
    setPending(null);
    if (answer.status === 201) {
      editedClosure.current.clear();
      setClosureDate("");
      setClosureReason("");
      setProblems([]);
      setFieldMessages({});
      news.announce(`Closure saved. ${answer.body.moved_loans} loans now due ${answer.body.new_due_date}.`);
      await read();
      return;
    }
    refused(answer, (field) => (field === "date" ? { label: "Closure date", target: "closure-date" } : { label: "Closure reason", target: "closure-reason" }));
  };

  const addTool = async () => {
    const cost = centsFromTyped(tool.cost);
    setPending("tool");
    const answer = await request<{ item: { tag: string } }>("POST", "/api/items", {
      tag: tool.tag.trim().toUpperCase(),
      name: tool.name,
      replacement_cost_cents: cost ?? tool.cost,
      parts: tool.parts.map((p) => ({ name: p.name, shape: p.shape, width: Number(p.width), height: Number(p.height) })),
    });
    setPending(null);
    if (answer.status === 201) {
      setToolOpen(false);
      setToolProblems([]);
      setTool({ tag: "", name: "", cost: "", parts: [{ name: "", shape: "generic", width: "2", height: "2" }] });
      news.announce(`${answer.body.item.tag} added to the board.`);
      focusAfter.current = "add-tool";
      await read();
      return;
    }
    if (answer.status === 422) {
      const labels: Record<string, [string, string]> = {
        tag: ["Tag", "tool-tag"],
        name: ["Name", "tool-name"],
        replacement_cost_cents: ["Replacement cost", "tool-cost"],
        parts: ["Parts", "tool-part-0-name"],
      };
      setToolProblems(Object.entries(answer.fields).map(([field, message]) => ({ field, message, label: labels[field]![0], target: labels[field]![1] })));
      focusAfter.current = "summary";
      return;
    }
    if (sessionEnded(answer)) {
      setToolOpen(false);
      news.sessionEnded(keptDraft());
      return;
    }
    news.announce(answer.error);
  };

  const editRule = (field: RuleField, value: string) => {
    editedRules.current.add(field);
    setRules((current) => ({ ...current!, [field]: value }));
  };
  const editRow = (day: string, change: Partial<Row>) => {
    editedRows.current.add(day);
    setRows((current) => ({ ...current!, [day]: { ...current![day]!, ...change } }));
  };

  const waiting = fees.filter((f) => f.status === "raised" && f.waiver?.status === "requested");

  return (
    <div class="page office">
      <PegStrip />
      <h1>Office</h1>
      <PaneAnnouncements news={news} summary={summary} label="Desk announcements" problems={problems} showProblems={!toolOpen} />

      {!loaded ? (
        <p class="loading-line">Loading the office…</p>
      ) : (
        <>
      <section class="panel" aria-label="Fee rules">
        <h2>Fee rules</h2>
        {rules && (
          <div class="rule-grid">
            {(["late", "damage", "period"] as const).map((field) => (
              <div key={field}>
                <label class="field">
                  <span class="field-label">{RULE_LABELS[field]}</span>
                  <input
                    id={`rule-${field}`}
                    inputMode={field === "period" ? "numeric" : "decimal"}
                    value={rules[field]}
                    onInput={(e) => editRule(field, e.currentTarget.value)}
                    aria-label={RULE_LABELS[field]}
                  />
                </label>
                <FieldMessage id={`rule-${field}`} message={fieldMessages[`rule-${field}`]} />
              </div>
            ))}
            <div>
              <label class="field">
                <span class="field-label">Time zone</span>
                <select id="rule-zone" value={rules.zone} onChange={(e) => editRule("zone", e.currentTarget.value)} aria-label="Time zone">
                  {[...new Set([rules.zone, ...zones.current])].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              <FieldMessage id="rule-zone" message={fieldMessages["rule-zone"]} />
            </div>
          </div>
        )}
        <p class="note">Money in dollars with two decimals. New rules apply to loans checked out from now on.</p>
        <ActionButton label="Save fee rules" pendingLabel="Saving..." pending={pending === "rules"} primary onAct={() => void saveRules()} />
      </section>

      <section class="panel" aria-labelledby="calendar-heading">
        <h2 id="calendar-heading">Opening calendar</h2>
        <form onSubmit={(e) => void saveHours(e)} noValidate>
          <div role="table" aria-label="Opening hours" class="hours-table">
            <div role="rowgroup" class="hours-head">
              <div role="row" class="hours-row">
                <span role="columnheader">Weekday</span>
                <span role="columnheader">Opens</span>
                <span role="columnheader">Closes</span>
              </div>
            </div>
            <div role="rowgroup">
              {rows &&
                WEEKDAYS.map((day) => {
                  const row = rows[day]!;
                  const name = capitalised(day);
                  return (
                    <div role="row" class="hours-row" key={day}>
                      <span role="rowheader" class="hours-day">
                        <label class="check">
                          <input type="checkbox" checked={row.open} onChange={(e) => editRow(day, { open: e.currentTarget.checked })} aria-label={`Open on ${name}`} />
                          <span aria-hidden="true">{name}</span>
                        </label>
                      </span>
                      {(["opens", "closes"] as const).map((which) => (
                        <span role="cell" class="hours-cell" key={which}>
                          <input
                            id={`hours-${day}-${which}`}
                            class="time-input num"
                            inputMode="numeric"
                            placeholder="HH:MM"
                            value={row[which]}
                            disabled={!row.open}
                            onInput={(e) => editRow(day, { [which]: e.currentTarget.value })}
                            aria-label={`${name} ${which}`}
                          />
                          <FieldMessage id={`hours-${day}-${which}`} message={fieldMessages[`hours-${day}-${which}`]} />
                        </span>
                      ))}
                    </div>
                  );
                })}
            </div>
          </div>
          <button
            type="submit"
            id="save-hours"
            class={`btn btn-primary${pending === "hours" ? " is-pending" : ""}`}
            aria-busy={pending === "hours" ? "true" : undefined}
            aria-disabled={pending === "hours" ? "true" : undefined}
          >
            {pending === "hours" ? "Saving..." : "Save hours"}
          </button>
          <FieldMessage id="save-hours" message={fieldMessages["save-hours"]} />
        </form>

        <h3>Closures</h3>
        <div class="closure-form">
          <div>
            <label class="field">
              <span class="field-label">Closure date</span>
              <input
                id="closure-date"
                class="num"
                placeholder="YYYY-MM-DD"
                value={closureDate}
                onInput={(e) => (editedClosure.current.add("date"), setClosureDate(e.currentTarget.value))}
                aria-label="Closure date"
              />
            </label>
            <FieldMessage id="closure-date" message={fieldMessages["closure-date"]} />
          </div>
          <div class="grow">
            <label class="field">
              <span class="field-label">Closure reason</span>
              <input
                id="closure-reason"
                value={closureReason}
                onInput={(e) => (editedClosure.current.add("reason"), setClosureReason(e.currentTarget.value))}
                aria-label="Closure reason"
              />
            </label>
            <FieldMessage id="closure-reason" message={fieldMessages["closure-reason"]} />
          </div>
          <ActionButton label="Declare closure" pendingLabel="Saving..." pending={pending === "closure"} primary onAct={() => void declareClosure()} />
        </div>
        <table class="ledger closures-table" aria-label="Closures">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(calendar?.closures ?? []).map((c) => (
              <tr key={c.date}>
                <td>
                  <Num>{c.date}</Num>
                </td>
                <td>{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="panel" aria-label="Inventory">
        <h2>Inventory</h2>
        <p class="note">
          <Num>{toolCount}</Num> tools hang on the board. Replacement costs of existing tools change through the inventory API.
        </p>
        <button type="button" class="btn" ref={addToolButton} onClick={() => setToolOpen(true)}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Add tool
        </button>
      </section>

      <section class="panel" aria-labelledby="waiver-heading">
        <h2 id="waiver-heading">Waiver requests</h2>
        <table class="ledger" aria-label="Waiver requests">
          <thead>
            <tr>
              <th scope="col">Fee</th>
              <th scope="col">Loan</th>
              <th scope="col">Total</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {waiting.length === 0 ? (
              <tr>
                <td colSpan={4}>No waiver requests are waiting.</td>
              </tr>
            ) : (
              waiting.map((fee) => (
                <tr key={fee.id}>
                  <td>
                    <a class="row-link" href={`/fees/${fee.id}`}>
                      Fee <Num>{fee.id}</Num>
                    </a>
                  </td>
                  <td>
                    <Num>{fee.loan_ref}</Num>
                  </td>
                  <td>
                    <Num>${dollars(fee.total_cents)}</Num>
                  </td>
                  <td class="clip">{fee.waiver!.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section class="panel" aria-labelledby="fees-heading">
        <h2 id="fees-heading">Fees</h2>
        <table class="ledger" aria-label="Fees">
          <thead>
            <tr>
              <th scope="col">Fee</th>
              <th scope="col">Loan</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {fees.length === 0 ? (
              <tr>
                <td colSpan={4}>No fees raised yet.</td>
              </tr>
            ) : (
              fees.map((fee) => (
                <tr key={fee.id}>
                  <td>
                    <a class="row-link" href={`/fees/${fee.id}`}>
                      Fee <Num>{fee.id}</Num>
                    </a>
                  </td>
                  <td>
                    <Num>{fee.loan_ref}</Num>
                  </td>
                  <td>
                    <Num>${dollars(fee.total_cents)}</Num>
                  </td>
                  <td>
                    <Status word={FEE_WORD[fee.status]} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
        </>
      )}

      {toolOpen && (
        <Dialog
          label="Add tool"
          wide
          onEscape={() => {
            setToolOpen(false);
            focusAfter.current = "add-tool";
          }}
        >
          <h2 class="dialog-title">Add tool</h2>
          <FormProblems problems={toolProblems} summaryRef={summary} />
          <div class="rule-grid">
            <label class="field">
              <span class="field-label">Tag</span>
              <input id="tool-tag" class="num" placeholder="PW- and 3 to 5 digits"value={tool.tag} onInput={(e) => setTool({ ...tool, tag: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="field-label">Name</span>
              <input id="tool-name" value={tool.name} onInput={(e) => setTool({ ...tool, name: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="field-label">Replacement cost</span>
              <input id="tool-cost" inputMode="decimal" value={tool.cost} onInput={(e) => setTool({ ...tool, cost: e.currentTarget.value })} />
            </label>
          </div>
          <h3>Parts</h3>
          {tool.parts.map((part, index) => {
            const update = (change: Partial<NewPart>) => setTool({ ...tool, parts: tool.parts.map((p, i) => (i === index ? { ...p, ...change } : p)) });
            return (
              <div class="part-row" key={index}>
                <label class="field">
                  <span class="field-label">Part {index + 1} name</span>
                  <input id={`tool-part-${index}-name`} value={part.name} onInput={(e) => update({ name: e.currentTarget.value })} />
                </label>
                <label class="field">
                  <span class="field-label">Shape</span>
                  <select value={part.shape} onChange={(e) => update({ shape: e.currentTarget.value })}>
                    {SHAPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Width in holes</span>
                  <input inputMode="numeric" value={part.width} onInput={(e) => update({ width: e.currentTarget.value })} />
                </label>
                <label class="field">
                  <span class="field-label">Height in holes</span>
                  <input inputMode="numeric" value={part.height} onInput={(e) => update({ height: e.currentTarget.value })} />
                </label>
                {tool.parts.length > 1 && (
                  <button type="button" class="btn" onClick={() => setTool({ ...tool, parts: tool.parts.filter((_, i) => i !== index) })}>
                    Remove part {index + 1}
                  </button>
                )}
              </div>
            );
          })}
          <div class="dialog-actions">
            {tool.parts.length < 8 && (
              <button type="button" class="btn" onClick={() => setTool({ ...tool, parts: [...tool.parts, { name: "", shape: "generic", width: "2", height: "2" }] })}>
                Add part
              </button>
            )}
            <ActionButton label="Add tool" pendingLabel="Adding..." pending={pending === "tool"} primary onAct={() => void addTool()} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
