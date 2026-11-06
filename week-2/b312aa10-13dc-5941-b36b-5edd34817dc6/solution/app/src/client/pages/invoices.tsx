import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ApiFailure, get, post, postOnce } from "../api.js";
import { navigate, useAddress, withQuery } from "../router.js";
import { context, showError, useStore } from "../store.js";
import { useBankMonth } from "../shell.js";
import { Dialog } from "../dialog.js";
import { Button, Empty, MonthField, errorCopy, useAction, useId } from "../ui.js";
import { labelFor } from "./dialogs.js";
import type { Booking, Invoice, Member } from "../types.js";
import { hoursText, money, quartersOf } from "../../shared/format.js";
import { isMonth, monthName } from "../../shared/time.js";
import { MEMBER_NOT_FOUND_COPY } from "../../shared/copy.js";

const KIND: Record<string, string> = { booking: "Booking", penalty: "Late fee", credit: "Credit" };

export function InvoicesScreen() {
  const ctx = useStore(context)!;
  const operator = ctx.session.user.role === "operator";
  const address = useAddress();
  const rawMonth = address.query.get("month");
  const month = rawMonth ?? ctx.kitchen.currentMonth;
  const memberId = operator ? address.query.get("member") : ctx.session.user.memberId;
  const [draftMonth, setDraftMonth] = useState(month);
  const [picked, setPicked] = useState<Member | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [monthError, setMonthError] = useState<string | undefined>();
  const [closing, setClosing] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const [missing, setMissing] = useState(false);
  /** The address's member, as last read (the picker may hold an uncommitted choice). */
  const [shownMember, setShownMember] = useState<Member | null>(null);
  const { run } = useAction();
  useBankMonth(isMonth(month) ? month : null);

  useEffect(() => {
    if (rawMonth === null) navigate(withQuery("/invoices", { ...Object.fromEntries(address.query), month: ctx.kitchen.currentMonth }), true);
  }, [rawMonth]);
  useEffect(() => setDraftMonth(month), [month]);

  // Latest view wins: every read carries a number; an answer is drawn only while it is the newest
  // read begun for this address and no close result arrived after it was sent.
  const reqSeq = useRef(0);
  const drawnSeq = useRef(0);
  const viewKey = useRef("");
  const epoch = useRef(0);
  const shownInvoice = useRef<Invoice | null>(null);
  shownInvoice.current = invoice;
  /** Waivers pressed on this screen: pending ones keep their busy button; answered ones never show it again. */
  const [waivers, setWaivers] = useState<Map<string, "pending" | "done">>(new Map());
  const setWaiver = (id: string, state: "pending" | "done" | null): void =>
    setWaivers((current) => {
      const next = new Map(current);
      if (state) next.set(id, state);
      else next.delete(id);
      return next;
    });

  /**
   * Reads the address's invoice. A fresh view clears the region first; a refresh redraws in place
   * and never touches the Month field, the member picker, a dialog or focus.
   */
  const load = async (refresh = false): Promise<void> => {
    const key = `${month}|${memberId ?? ""}`;
    if (!refresh) {
      viewKey.current = key;
      epoch.current++;
      setInvoice(null);
      setBookings([]);
      setMissing(false);
    }
    if (!isMonth(month)) {
      setMonthError("Use a month in the form YYYY-MM.");
      return;
    }
    if (!refresh) setMonthError(undefined);
    if (!memberId) {
      if (!refresh) setPicked(null);
      return;
    }
    const mine = ++reqSeq.current;
    const sentEpoch = epoch.current;
    const current = (): boolean => viewKey.current === key && epoch.current === sentEpoch && mine > drawnSeq.current;
    try {
      if (operator && !refresh) {
        const { data } = await get<{ member: Member }>(`/api/members/${encodeURIComponent(memberId)}`);
        if (!current()) return;
        setPicked(data.member);
        setShownMember(data.member);
      }
      const { data } = await get<Invoice>(`/api/members/${encodeURIComponent(memberId)}/invoices/${month}`);
      const list = operator ? (await get<{ bookings: Booking[] }>(`/api/bookings?month=${month}&memberId=${encodeURIComponent(memberId)}`)).data.bookings : null;
      if (!current() || data.month !== month || data.memberId !== memberId) return;
      // A month never reopens: once "Invoice closed" is shown it stays.
      const held = shownInvoice.current;
      if (held && held.status === "closed" && data.status === "open" && held.month === data.month && held.memberId === data.memberId) return;
      drawnSeq.current = mine;
      setInvoice(data);
      if (list) setBookings(list);
    } catch (error) {
      if (refresh || !current()) return;
      if (error instanceof ApiFailure && error.code === "not_found") {
        setPicked(null);
        setMissing(true);
        showError(MEMBER_NOT_FOUND_COPY);
      } else if (error instanceof ApiFailure && error.fieldErrors.month) setMonthError(error.fieldErrors.month);
    }
  };
  useEffect(() => void load(), [month, memberId]);

  // Invoice refresh: while the invoice shown is open, re-read it (and the Bookings list) every 10 s.
  const loadRef = useRef(load);
  loadRef.current = load;
  const refreshing = invoice !== null && invoice.status === "open";
  useEffect(() => {
    if (!refreshing) return undefined;
    const timer = setInterval(() => void loadRef.current(true), 10_000);
    return () => clearInterval(timer);
  }, [refreshing, month, memberId]);

  /** A close result arrived: every read sent before it is discarded when it answers. */
  const closeResult = (): void => {
    epoch.current++;
  };

  const show = (m = draftMonth): void => {
    const params: Record<string, string> = { month: m };
    if (operator && picked) params.member = picked.id;
    navigate(withQuery("/invoices", params));
  };

  const waive = (b: Booking): void => {
    setWaiver(b.id, "pending");
    void run(`waive-${b.id}`, "Waiving…", async () => {
      const { data } = await postOnce<{ booking: Booking; creditMonth: string }>(`/api/bookings/${b.id}/waive-penalty`, {});
      setWaiver(b.id, "done");
      await load(true);
      return data.creditMonth === b.localDate.slice(0, 7)
        ? `Fee waived for ${labelFor(b)}.`
        : `Fee waived for ${labelFor(b)}. The credit appears on the ${monthName(data.creditMonth)} invoice.`;
    }, () => {
      setWaiver(b.id, null);
      void load(true);
      return false;
    });
  };

  const focusInvoice = (): void => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".invoice-lines")?.focus());
  };

  const close = (): void => {
    setClosing(false);
    setClosePending(true);
    void run("close", `Closing ${monthName(month)}…`, async () => {
      const { data } = await post<{ invoices: unknown[] }>(`/api/months/${month}/close`);
      closeResult();
      setInvoice((current) => (current ? { ...current, status: "closed" } : current));
      await load(true);
      focusInvoice();
      return `${monthName(month)} closed. ${data.invoices.length} invoices committed.`;
    }, (error) => {
      if (error instanceof ApiFailure && error.code === "month_closed") {
        closeResult();
        setInvoice((current) => (current ? { ...current, status: "closed" } : current));
        showError(errorCopy(error));
        void load(true).then(focusInvoice);
        return true;
      }
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".close-month")?.focus());
      return false;
    }).finally(() => setClosePending(false));
  };

  const byId = new Map(bookings.map((b) => [b.id, b]));
  return (
    <div class="screen">
      <h1>Invoices</h1>
      <section class="panel">
        <div class="toolbar">
          {operator && <MemberPicker key={`${month}|${memberId ?? ""}`} selected={picked} onSelect={setPicked} />}
          <MonthField label="Month" value={draftMonth} error={monthError} onCommit={setDraftMonth} />
          <Button variant="primary" onClick={() => show()}>Show invoice</Button>
        </div>
      </section>
      {memberId && !monthError && !missing && (
        <section class="panel" role="region" aria-label="Invoice" aria-busy={invoice ? "false" : "true"}>
          {!invoice && <p class="loading">Loading…</p>}
          {invoice && <>
          <div class="invoice-head">
            <h2>{operator && shownMember ? `${shownMember.businessName}, ` : ""}{monthName(invoice.month)}</h2>
            <p class={`badge badge-${invoice.status}`}>{invoice.status === "open" ? "Invoice open" : "Invoice closed"}</p>
            <p class="invoice-bank">{hoursText(quartersOf(invoice.hourBank.balanceHours))} h left in {monthName(invoice.month)} of {invoice.hourBank.allowanceHours} h</p>
          </div>
          {invoice.lines.length === 0 ? <Empty>No charges or credits in {monthName(invoice.month)}.</Empty> : null}
          <table class="table invoice-lines" aria-label="Invoice lines" tabIndex={-1}>
            <thead><tr><th scope="col">Line</th><th scope="col">Kind</th><th scope="col">Billing</th><th scope="col" class="num">Amount</th>{operator && <th scope="col">Action</th>}</tr></thead>
            <tbody>
              {invoice.lines.map((l, i) => {
                const b = byId.get(l.bookingId);
                const waiver = waivers.get(l.bookingId);
                const firstPenalty = invoice.lines.findIndex((x) => x.kind === "penalty" && x.bookingId === l.bookingId) === i;
                const waivable = operator && l.kind === "penalty" && b && firstPenalty && waiver !== "done"
                  && (waiver === "pending" || b.actions.includes("waive_penalty"));
                return (
                  <tr>
                    <td data-label="Line" class="wrap">{l.description}{" "}</td>
                    <td data-label="Kind">{KIND[l.kind]}</td>
                    <td data-label="Billing">{l.billingStatus === "billed" ? <span class="billed">Billed</span> : "Pending billing"}</td>
                    <td data-label="Amount" class="num">{money(l.amountCents)}</td>
                    {operator && <td data-label="Action">{waivable && <Button busy={waiver === "pending"} aria-label={`Waive fee for ${labelFor(b)} (${b.id})`} onClick={() => waive(b)}>Waive fee</Button>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="total">Total {money(invoice.totalCents)}</p>
          {operator && invoice.status === "open" && <div class="actions"><Button class="close-month" busy={closePending} onClick={() => setClosing(true)}>Close month</Button></div>}
          </>}
        </section>
      )}
      {closing && (
        <Dialog title="Close month" onClose={() => setClosing(false)}>
          <p class="dialog-lede">Close {monthName(month)}? Bookings in this month can no longer change.</p>
          <div class="actions">
            <Button variant="primary" onClick={close}>Close {monthName(month)}</Button>
            <Button class="btn-quiet" onClick={() => setClosing(false)}>Keep open</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const PICKER_PAUSE_MS = 200;
const optionName = (m: Member): string => `${m.businessName} · ${m.name}`;

/**
 * The member picker (Interactions › Member picker): an editable combobox whose `listbox "Members"`
 * draws only the answer for the text now in the field, opens on any change of that text, and is
 * driven by ArrowDown, ArrowUp, Enter, Escape and Tab with focus kept in the field. Choosing a
 * member never touches the address; Show invoice does.
 */
function MemberPicker({ selected, onSelect }: { selected: Member | null; onSelect: (m: Member | null) => void }) {
  const id = useId("member");
  const [text, setText] = useState(selected ? optionName(selected) : "");
  /** The latest answer drawn, with the text it answers. */
  const [held, setHeld] = useState<{ q: string; members: Member[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const current = useRef(text);
  current.current = text;
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ArrowDown asked for the first option before the current text's options were drawn. */
  const wantFirst = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) setText(optionName(selected));
  }, [selected]);

  const query = (q: string): void => {
    get<{ members: Member[] }>(`/api/members?q=${encodeURIComponent(q)}`).then(({ data }) => {
      if (q !== current.current) return;
      setHeld({ q, members: data.members });
      if (wantFirst.current && data.members.length) setActive(0);
      wantFirst.current = false;
    }, () => undefined);
  };
  const drawn = held && held.q === text ? held.members : null;

  const choose = (m: Member): void => {
    if (pause.current) clearTimeout(pause.current);
    const name = optionName(m);
    current.current = name;
    setText(name);
    setHeld({ q: name, members: [m] });
    setOpen(false);
    setActive(-1);
    onSelect(m);
  };

  // The open list sits in the top layer, below the field (or above it when there is no room),
  // always wholly inside the viewport.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return undefined;
    if (open && !el.matches(":popover-open")) el.showPopover();
    if (!open) {
      if (el.matches(":popover-open")) el.hidePopover();
      return undefined;
    }
    const place = (): void => {
      const field = input.current!.getBoundingClientRect();
      const width = Math.min(Math.max(field.width, 280), window.innerWidth - 16);
      el.style.width = `${width}px`;
      el.style.left = `${Math.max(8, Math.min(field.left, window.innerWidth - width - 8))}px`;
      const height = el.offsetHeight;
      const below = field.bottom + 2;
      el.style.top = `${below + height <= window.innerHeight - 8 ? below : Math.max(8, field.top - height - 2)}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, drawn]);

  const onKeyDown = (e: KeyboardEvent): void => {
    const options = drawn ?? [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        if (drawn) setActive(drawn.length ? 0 : -1);
        else {
          wantFirst.current = true;
          if (pause.current) clearTimeout(pause.current);
          query(text);
        }
      } else if (active < 0) {
        if (options.length) setActive(0);
        else wantFirst.current = true;
      } else setActive(Math.min(options.length - 1, active + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open && active > 0) setActive(active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = open ? options[active] : undefined;
      if (m) choose(m);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div class="field picker">
      <label for={id}>Member</label>
      <input
        ref={input}
        id={id}
        class="input"
        role="combobox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && drawn && active >= 0 ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        value={text}
        placeholder="Name or business"
        onInput={(e) => {
          const q = e.currentTarget.value;
          current.current = q;
          setText(q);
          if (selected) onSelect(null);
          setOpen(true);
          setActive(-1);
          wantFirst.current = false;
          if (pause.current) clearTimeout(pause.current);
          pause.current = setTimeout(() => query(q), PICKER_PAUSE_MS);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
      />
      <div ref={list} id={`${id}-list`} role="listbox" class="listbox" aria-label="Members" popover="manual"
        aria-busy={drawn ? "false" : "true"}>
        {drawn && drawn.length === 0 && <p class="listbox-empty">No members match.</p>}
        {drawn && drawn.map((m, i) => (
          <div id={`${id}-opt-${i}`} role="option" class={i === active ? "option active" : "option"} aria-selected={i === active ? "true" : "false"}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(m);
            }}>
            {optionName(m)}
          </div>
        ))}
      </div>
    </div>
  );
}
