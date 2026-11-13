import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, describe, get, send } from "./api";
import { ThreeClocks } from "./clocks";
import { adjustedSentence, warningSentence } from "./calendar";
import { EventFields, ErrorSummary, editableCalendars, submitEdit, valuesFromItem, type FormValues } from "./form";
import { duplicateEvent } from "./eventsvc";
import { navigate, useLocation, withQuery } from "./router";
import { announce } from "./status";
import { bump, calendars$, dataVersion$, me$, people$ } from "./state";
import { useStore } from "./store";
import { CITY_OF, dateOf, dayLabel, parseDate, parseWall, wallInZone, typedWall } from "./time";
import { Modal, WarningMark, anyDialogOpen } from "./ui";
import type { ReplyStatus, Item, Me, Proposal } from "./types";

const REPLY_TEXT: Record<ReplyStatus, string> = { yes: "Yes", no: "No", maybe: "Maybe", invited: "Waiting" };

type SwitchName = "modify_event" | "invite_others" | "see_guest_list";

interface Conflict {
  event_id: string;
  occurrence_id: string;
  title: string;
  start_local: string;
  answer: ReplyStatus;
}

function whenLine(item: Item): string {
  if (item.all_day) return item.start_local === item.end_local ? dayLabel(item.start_local) : `${dayLabel(item.start_local)} to ${dayLabel(item.end_local)}`;
  return `${dayLabel(item.start_local.slice(0, 10))} ${item.start_local.slice(11)} to ${item.end_local.slice(11)} ${CITY_OF[item.zone]}`;
}

export function EventPage({ id }: { id: string }) {
  const me = useStore(me$) as Me;
  const loc = useLocation();
  const occurrence = loc.query.get("occurrence");
  const version = useStore(dataVersion$);
  const people = useStore(people$);
  const calendars = useStore(calendars$);
  const [item, setItem] = useState<Item | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<FormValues | null>(null);
  const before = useRef<FormValues | null>(null);
  const base = useRef(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [proposing, setProposing] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [guestToAdd, setGuestToAdd] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [replyScope, setReplyScope] = useState<"occurrence" | "series">(occurrence ? "occurrence" : "series");
  // A toggled guest switch shows the person's choice until the loaded event carries it, so a reply loaded before the save never flips it back.
  const [chosenSwitches, setChosenSwitches] = useState<Partial<Record<SwitchName, boolean>>>({});
  const loaded = useRef(false);

  const query = occurrence ? `?occurrence_id=${encodeURIComponent(occurrence)}` : "";
  const reload = async (resetForm: boolean) => {
    try {
      const fresh = await get<Item>(`/api/events/${id}${query}`);
      setItem(fresh);
      if (resetForm || !loaded.current) {
        const values = valuesFromItem(fresh);
        setForm(values);
        before.current = values;
        base.current = fresh.version ?? 0;
        loaded.current = true;
      }
    } catch (e) {
      if (e instanceof ApiError) setMissing(true);
    }
  };
  useEffect(() => {
    loaded.current = false;
    void reload(true);
  }, [id, occurrence]);
  useEffect(() => {
    if (loaded.current) void reload(false);
  }, [version]);
  useEffect(() => {
    if (!item || item.kind !== "out_of_office" || item.access !== "full") return;
    get<{ conflicts: Conflict[] }>(`/api/events/${id}/conflicts`).then((b) => setConflicts(b.conflicts)).catch(() => undefined);
  }, [item?.version, version]);
  useEffect(() => {
    setChosenSwitches((chosen) => {
      const left = Object.fromEntries(Object.entries(chosen).filter(([name, value]) => item?.switches?.[name as SwitchName] !== value));
      return Object.keys(left).length === Object.keys(chosen).length ? chosen : left;
    });
  }, [item]);

  const canEdit = item && (item.access === "full" || (item.access === "guest" && item.switches?.modify_event));
  const save = async (event?: Event) => {
    event?.preventDefault();
    if (!item || !form || !before.current) return;
    const ok = await submitEdit(item, occurrence ?? undefined, form, before.current, setErrors, base.current);
    if (ok) {
      setErrors({});
      await reload(true);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event: KeyboardEvent) => {
      if (event.key === "s" && event.ctrlKey) {
        event.preventDefault();
        if (canEdit) void saveRef.current();
        return;
      }
      if (event.key === "Escape" && !anyDialogOpen() && item) {
        const start = item.start_local.slice(0, 10);
        const date = item.access === "busy" ? start : dateOf(wallInZone(Date.parse(item.start_utc ?? item.start_local + "Z"), me.zone));
        const day = item.all_day ? start : date;
        navigate(withQuery("/calendar", { date: day, focus: occurrence ?? id, calendars: item.calendar_id === "cal-holidays" ? "cal-holidays" : null }));
      }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandler.current(event);
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  if (missing) {
    return (
      <main class="column">
        <h1>That event is not available.</h1>
        <p><a class="textlink" href="/calendar" onClick={(e) => { e.preventDefault(); navigate("/calendar"); }}>Back to the calendar</a></p>
      </main>
    );
  }
  if (!item || !form) return <main class="column"><p class="quiet">Loading the event.</p></main>;

  const sentence = warningSentence(item);
  const adjusted = adjustedSentence({ ...item, occurrence_id: occurrence ?? id });
  const eventId = id;
  const mutate = async (print: () => Promise<unknown>, pending: string, done: string) => {
    if (pending) announce(pending);
    try {
      await print();
      if (done) announce(done);
      bump();
      await reload(false);
    } catch (e) {
      announce(describe(e));
    }
  };
  const setSwitch = async (name: SwitchName, value: boolean) => {
    setChosenSwitches((chosen) => ({ ...chosen, [name]: value }));
    const switches = { ...(item.switches as NonNullable<Item["switches"]>), ...chosenSwitches, [name]: value };
    const hadLink = Boolean(item.share_link);
    announce(`Saving ${item.title}...`);
    try {
      const fresh = await get<Item>(`/api/events/${id}${query}`);
      await send("PATCH", `/api/events/${id}`, { switches, scope: item.rrule ? "all" : undefined }, fresh.version ?? null);
      if (name === "see_guest_list" && !value && hadLink) announce("Guest list hidden. The shared link no longer works.");
      else announce(`Saved ${item.title}.`);
      bump();
      await reload(false);
    } catch (e) {
      setChosenSwitches((chosen) => Object.fromEntries(Object.entries(chosen).filter(([key]) => key !== name)));
      announce(describe(e));
    }
  };
  const saveReply = async (value: ReplyStatus) => {
    announce("Saving your answer...");
    try {
      await send("PUT", `/api/events/${id}/replies/me`, {
        scope: item.rrule ? replyScope : "series", occurrence_id: item.rrule && replyScope === "occurrence" ? occurrence ?? undefined : undefined, answer: value,
      });
      announce(`Your answer is saved: ${REPLY_TEXT[value]}.`);
      bump();
      await reload(false);
    } catch (e) {
      announce(describe(e));
    }
  };
  const proposals: Proposal[] = (item.access === "full" ? item.proposals : item.my_proposals) ?? [];
  const openProposals = proposals.filter((p) => p.status === "proposed");
  const guestIds = new Set((item.guests ?? []).map((g) => g.person_id));
  const invitable = people.filter((p) => !guestIds.has(p.id) && p.id !== item.organiser?.id);
  const myStatus = item.my_reply?.answer;
  const link = item.share_link;
  const canInvite = people.length > 0 && (item.access === "full" || (item.access === "guest" && item.switches?.invite_others));
  const editable = editableCalendars(calendars).filter((c) => c.id !== item.calendar_id);

  return (
    <main class="column event-page">
      <h1>{item.title}</h1>
      {item.clocks.length > 0 && <ThreeClocks clocks={item.clocks} baseDate={item.access === "busy" ? undefined : item.start_local.slice(0, 10)} />}
      {item.access !== "busy" && <p class="when">{whenLine(item)}</p>}
      {!!item.location && <p class="muted">{item.location}</p>}
      {adjusted && <p>{adjusted}</p>}
      {sentence && (
        <section role="region" aria-label="Zone rule warning" class="warning">
          <WarningMark /> <span>{sentence}</span>
          {item.access === "full" && (
            <button type="button" onClick={() => void mutate(async () => {
              const w = item.zone_warnings?.[0];
              const fresh = await get<Item>(`/api/events/${id}${query}`);
              const reply = await send<{ event: Item; split: { later_id: string } | null }>("POST", `/api/events/${id}/zone-moves`, { rule_id: w?.rule_id }, fresh.version ?? null);
              if (reply.data.split) navigate(withQuery(`/events/${reply.data.split.later_id}`, { occurrence: occurrence?.replace(id, reply.data.split.later_id) }), true);
            }, `Moving ${item.title}...`, `Moved ${item.title} back to ${item.zone_warnings?.[0]?.saved_time} ${item.zone_warnings?.[0]?.city}.`)}>Move</button>
          )}
        </section>
      )}

      {item.access === "busy" && <p class="quiet">This time is busy.</p>}

      {canEdit && (
        <form onSubmit={save} noValidate class="edit-form">
          <h2>Details</h2>
          <ErrorSummary errors={errors} prefix="ep" />
          <EventFields values={form} onChange={setForm} errors={errors} prefix="ep" me={me} />
          <div class="actions"><button type="submit" class="primary">Save</button></div>
        </form>
      )}

      {item.rsvp && item.guests && (
        <>
          <h2>Guests</h2>
          <section role="region" aria-label="Answers" class="answers">{`${item.rsvp.yes} yes, ${item.rsvp.no} no, ${item.rsvp.maybe} maybe, ${item.rsvp.invited} waiting`}</section>
          <ul aria-label="Guests" class="rows">
            {item.guests.map((g) => (
              <li key={g.person_id}>
                <span class="row-title">{`${g.name}: ${REPLY_TEXT[g.answer]}`}</span>
                {!!g.message && <span class="muted second-line">{g.message}</span>}
                {item.access === "full" && (
                  <button type="button" aria-label={`Remove ${g.name}`} onClick={() => void mutate(() => send("DELETE", `/api/events/${id}/guests/${g.person_id}`), `Saving ${item.title}...`, `Saved ${item.title}.`)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {canInvite && (
        <div class="invite">
          <div class="field">
            <label for="ep-invite">Invite person</label>
            <select id="ep-invite" value={guestToAdd} onChange={(e) => setGuestToAdd(e.currentTarget.value)}>
              <option value="">Choose a person</option>
              {invitable.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button type="button" disabled={!guestToAdd} onClick={() => void mutate(async () => { await send("POST", `/api/events/${id}/guests`, { person_ids: [guestToAdd] }); setGuestToAdd(""); }, `Inviting...`, `Invited.`)}>Invite</button>
        </div>
      )}

      {item.my_reply && (
        <>
          <h2>Your answer</h2>
          {item.rrule && (
            <div role="radiogroup" aria-label="Answer for" class="choice">
              {([["occurrence", "This event"], ["series", "All events"]] as const).map(([value, text]) => (
                <label class="radio" key={value}>
                  <input type="radio" name="answer-for" checked={replyScope === value} onChange={() => setReplyScope(value)} disabled={value === "occurrence" && !occurrence} />
                  {text}
                </label>
              ))}
            </div>
          )}
          <div role="radiogroup" aria-label="Your answer" class="choice">
            {(["yes", "no", "maybe"] as const).map((a) => (
              <label class="radio" key={a}>
                <input type="radio" name="your-answer" checked={myStatus === a} onChange={() => void saveReply(a)} />
                {REPLY_TEXT[a]}
              </label>
            ))}
          </div>
          {!!item.my_reply.message && <p class="muted">{item.my_reply.message}</p>}
          <button type="button" onClick={() => setProposing(true)}>Propose a new time</button>
        </>
      )}

      {openProposals.length > 0 && (
        <>
          <h2>Proposed times</h2>
          <ul aria-label="Proposed times" class="rows">
            {openProposals.map((p) => (
              <li key={p.id}>
                <span class="row-title">{`${p.proposer.name}: ${p.start_local.replace("T", " ")} to ${p.end_local.slice(11) || p.end_local}`}</span>
                {!!p.note && <span class="muted">{p.note}</span>}
                {item.access === "full" && (
                  <>
                    <button type="button" onClick={() => void mutate(() => send("POST", `/api/proposals/${p.id}/accept`), "", "")}>Accept</button>
                    <button type="button" onClick={() => void mutate(() => send("POST", `/api/proposals/${p.id}/decline`), "", "")}>Decline</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {item.access === "full" && item.switches && (
        <div role="group" aria-label="Guest switches" class="switches">
          <h2>Guest switches</h2>
          {([["modify_event", "Modify event"], ["invite_others", "Invite others"], ["see_guest_list", "See guest list"]] as const).map(([name, text]) => (
            <label class="check" key={name}>
              <input type="checkbox" checked={chosenSwitches[name] ?? item.switches?.[name] ?? false} onChange={(e) => void setSwitch(name, e.currentTarget.checked)} />
              {text}
            </label>
          ))}
        </div>
      )}

      {item.access === "full" && (
        <div class="link-box">
          <h2>Shared link</h2>
          {link && <p class="muted">{`${location.origin}${link.url}`}</p>}
          <div class="actions">
            <button type="button" onClick={async () => {
              if (link) {
                await navigator.clipboard?.writeText(`${location.origin}${link.url}`).catch(() => undefined);
                announce("Shared link copied.");
              } else await mutate(async () => {
                const made = await send<{ url: string }>("POST", `/api/events/${id}/share-link`);
                await navigator.clipboard?.writeText(`${location.origin}${made.data.url}`).catch(() => undefined);
              }, "Creating the shared link...", "Shared link copied.");
            }}>Copy shared link</button>
            <button type="button" onClick={() => void mutate(() => send("POST", `/api/events/${id}/share-link`), "Creating the shared link...", "New shared link created.")}>New shared link</button>
            <button type="button" disabled={!link} onClick={() => void mutate(() => send("DELETE", `/api/events/${id}/share-link`), "Turning off the shared link...", "Shared link turned off.")}>Turn off shared link</button>
          </div>
        </div>
      )}

      {item.kind === "out_of_office" && item.access === "full" && conflicts.length > 0 && (
        <>
          <h2>Meetings to answer</h2>
          <ul aria-label="Conflicts" class="rows">
            {conflicts.map((c) => (
              <li key={c.occurrence_id}>
                <div role="radiogroup" aria-label={`${c.title} on ${dayLabel(c.start_local.slice(0, 10))}`} class="choice">
                  {(["yes", "no", "maybe"] as const).map((a) => (
                    <label class="radio" key={a}>
                      <input type="radio" name={`conflict-${c.occurrence_id}`} checked={c.answer === a} onChange={async () => {
                        announce("Saving your answer...");
                        try {
                          await send("PUT", `/api/events/${c.event_id}/replies/me`, { scope: "occurrence", occurrence_id: c.occurrence_id, answer: a });
                          setConflicts(conflicts.map((x) => (x.occurrence_id === c.occurrence_id ? { ...x, answer: a } : x)));
                          announce(`Your answer is saved: ${REPLY_TEXT[a]}.`);
                        } catch (e) {
                          announce(describe(e));
                        }
                      }} />
                      {REPLY_TEXT[a]}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {item.access !== "busy" && (
        <div class="actions page-actions">
          {item.calendar_id !== "cal-holidays" && <button type="button" onClick={() => void duplicateEvent({ ...item, event_id: eventId })}>Duplicate</button>}
          {item.access === "full" && editable.length > 0 && (
            <>
              <div class="field inline">
                <label for="ep-move">Move to calendar</label>
                <select id="ep-move" value={moveTo || editable[0].id} onChange={(e) => setMoveTo(e.currentTarget.value)}>
                  {editable.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
                </select>
              </div>
              <button type="button" onClick={async () => {
                const target = editable.find((c) => c.id === (moveTo || editable[0].id));
                if (!target) return;
                announce(`Moving ${item.title}...`);
                try {
                  const fresh = await get<Item>(`/api/events/${id}${query}`);
                  await send("POST", `/api/events/${id}/move`, { calendar_id: target.id }, fresh.version ?? null);
                  announce(`Moved ${item.title} to ${target.name}.`);
                  bump();
                  await reload(false);
                } catch (e) {
                  announce(describe(e));
                }
              }}>Move to calendar</button>
            </>
          )}
        </div>
      )}

      {proposing && <ProposeDialog item={item} id={id} occurrence={occurrence} onClose={() => setProposing(false)} onSent={() => { setProposing(false); bump(); void reload(false); }} />}
    </main>
  );
}

function ProposeDialog({ item, id, occurrence, onClose, onSent }: { item: Item; id: string; occurrence: string | null; onClose: () => void; onSent: () => void }) {
  const start = parseWall(item.start_local);
  const [starts, setStarts] = useState(item.all_day ? item.start_local : start === null ? "" : typedWall(start));
  const [ends, setEnds] = useState(item.all_day ? item.end_local : (() => { const e = parseWall(item.end_local); return e === null ? "" : typedWall(e); })());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send1 = async (event: Event) => {
    event.preventDefault();
    const e: Record<string, string> = {};
    const copy = item.all_day ? "Use YYYY-MM-DD." : "Use YYYY-MM-DD HH:MM.";
    const ok = (s: string) => (item.all_day ? parseDate(s.trim()) !== null : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.trim()) && parseWall(s) !== null);
    if (!ok(starts)) e.starts = copy;
    if (!ok(ends)) e.ends = copy;
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    announce("Sending your proposal...");
    const key = occurrence ?? (item.rrule ? `${id}@${item.start_local.replace(/[-:]/g, "").slice(0, 13)}` : undefined);
    try {
      await send("POST", `/api/events/${id}/proposals`, {
        occurrence_id: item.rrule ? key : undefined, start_local: item.all_day ? starts.trim() : starts.trim().replace(" ", "T"),
        end_local: item.all_day ? ends.trim() : ends.trim().replace(" ", "T"), note,
      });
      announce(`Your proposal for ${item.title} is sent.`);
      onSent();
    } catch (error) {
      const text = describe(error);
      setErrors({ form: text });
      announce(text);
    }
  };
  return (
    <Modal label="Propose a new time" onClose={onClose}>
      <form onSubmit={send1} noValidate class="dialog-form">
        <h2>Propose a new time</h2>
        <div class="field">
          <label for="pp-starts">Starts</label>
          <input id="pp-starts" type="text" value={starts} data-autofocus onInput={(e) => setStarts(e.currentTarget.value)} />
          {errors.starts && <p class="field-error">{errors.starts}</p>}
        </div>
        <div class="field">
          <label for="pp-ends">Ends</label>
          <input id="pp-ends" type="text" value={ends} onInput={(e) => setEnds(e.currentTarget.value)} />
          {errors.ends && <p class="field-error">{errors.ends}</p>}
        </div>
        <div class="field">
          <label for="pp-note">Note</label>
          <input id="pp-note" type="text" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        {errors.form && <p class="field-error">{errors.form}</p>}
        <div class="actions">
          <button type="submit" class="primary">Send proposal</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

