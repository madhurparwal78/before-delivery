// The studio: sign-in, the batch board, pack today, finance, reconciliation, audit, notices.
import { useEffect, useState } from "preact/hooks";
import type { PageProps } from "../app.js";
import { t } from "../state/i18n.js";
import { api, ApiError, DROP_SCENTS, scentName, newIdempotencyKey } from "../state/api.js";
import type { Batch, PackingOrder, Order, Refund, Credit, Subscription } from "../state/api.js";
import { formatMoney, formatLongDate, formatDropTime } from "../state/format.js";
import { Dialog } from "../components/controls.js";

interface StaffMember { email: string; name: string; role: string; }

const STAFF_PAGES = [
  { path: "/studio/batches", key: "studioBatches", roles: ["maker"] },
  { path: "/studio/packing", key: "studioPacking", roles: ["maker", "packing"] },
  { path: "/studio/finance", key: "studioFinance", roles: ["maker", "finance"] },
  { path: "/studio/reconciliation", key: "studioReconciliation", roles: ["maker", "finance"] },
  { path: "/studio/audit", key: "studioAudit", roles: ["maker", "finance"] },
  { path: "/studio/notices", key: "studioNotices", roles: ["maker", "finance"] }
];

export function StudioPage(props: PageProps) {
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signInError, setSignInError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const rest = props.params.rest || "";

  useEffect(() => {
    void api<{ staff: StaffMember }>("/staff/me")
      .then((data) => { setStaff(data.staff); setSignedIn(true); })
      .catch(() => setSignedIn(false));
  }, []);

  const signIn = async (event: Event) => {
    event.preventDefault();
    setSignInError(false);
    try {
      const data = await api<{ staff: StaffMember }>("/staff/sign-in", {
        method: "POST",
        body: { email, password }
      });
      setStaff(data.staff);
      setSignedIn(true);
    } catch {
      setSignInError(true);
    }
  };

  if (!signedIn) {
    return (
      <div class="page studio-signin">
        <h1>{t("studio", props.locale)}</h1>
        <form onSubmit={signIn}>
          {signInError && (
            <div role="alert" class="alert">
              <p>{props.locale === "fr-CA" ? "Courriel ou mot de passe incorrect." : "Email or password is incorrect."}</p>
            </div>
          )}
          <div class="field">
            <label for="field-staff-email">{t("email", props.locale)}</label>
            <input id="field-staff-email" value={email} onInput={(event) => setEmail((event.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="field-staff-password">{t("password", props.locale)}</label>
            <input id="field-staff-password" type="password" value={password} onInput={(event) => setPassword((event.target as HTMLInputElement).value)} />
          </div>
          <button type="submit" class="button primary">{t("studioSignIn", props.locale)}</button>
        </form>
      </div>
    );
  }

  const role = staff?.role ?? "";
  const visiblePages = STAFF_PAGES.filter((page) => page.roles.includes(role));
  const active = rest === "" ? null : rest;

  return (
    <div class="page studio-page">
      <h1>{t("studio", props.locale)}</h1>
      <nav aria-label={t("studio", props.locale)} class="studio-nav">
        {visiblePages.map((page) => (
          <a key={page.path} href={page.path} aria-current={active === page.path.slice("/studio".length) ? "page" : undefined}>
            {t(page.key, props.locale)}
          </a>
        ))}
      </nav>
      <div role="status" class="studio-updates" aria-live="polite" aria-label={t("studioUpdates", props.locale)}>
        </div>
      {active === "/batches" && <BatchesBoard locale={props.locale} />}
      {active === "/packing" && <PackToday locale={props.locale} />}
      {active === "/finance" && <FinancePage locale={props.locale} />}
      {active === "/reconciliation" && <ReconciliationPage locale={props.locale} />}
      {active === "/audit" && <AuditPage locale={props.locale} />}
      {active === "/notices" && <NoticesPage locale={props.locale} />}
      {(active === null || !visiblePages.some((page) => page.path.slice("/studio".length) === active)) && (
        <BatchesBoard locale={props.locale} />
      )}
    </div>
  );
}

export function BatchesBoard({ locale }: { locale: "fr-CA" | "en-CA" }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [notice, setNotice] = useState("");
  const [logScent, setLogScent] = useState(DROP_SCENTS[0].slug);
  const [pourDate, setPourDate] = useState("");
  const [cureDays, setCureDays] = useState(28);
  const [cutDialog, setCutDialog] = useState<string | null>(null);
  const [cutBars, setCutBars] = useState(12);
  const [scheduleDialog, setScheduleDialog] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState("");
  const [withdrawDialog, setWithdrawDialog] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState("14:00");

  const load = async () => {
    try {
      const data = await api<{ batches: Batch[] }>("/staff/batches");
      setBatches(data.batches);
    } catch { /* keep the last board */ }
  };
  useEffect(() => {
    void load();
    void api<{ packing_cutoff_local: string }>("/staff/settings").then((data) => setCutoff(data.packing_cutoff_local));
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const announce = (text: string) => setNotice(text);

  const logLoaf = async () => {
    try {
      const data = await api<{ batch: Batch }>("/staff/batches", {
        method: "POST",
        body: { scent: logScent, poured_on: pourDate, cure_days: cureDays }
      });
      announce(t("logLoaf", locale) && `Loaf ${data.batch.code} logged.`);
      void load();
    } catch { /* the server rejects */ }
  };
  const cut = async (code: string) => {
    try {
      await api(`/staff/batches/${code}/cut`, { method: "POST", body: { bars: cutBars } });
      announce(`${code} cut into ${cutBars} bars.`);
      void load();
    } catch { /* rejected */ }
  };
  const schedule = async (code: string) => {
    try {
      const data = await api<{ batch: Batch }>(`/staff/batches/${code}/schedule`, {
        method: "POST",
        body: { drop_at_local: dropAt }
      });
      announce(`${code} drops ${formatDropTime(data.batch.drop_at_local ?? "", locale)}.`);
      void load();
    } catch { /* rejected */ }
  };
  const open = async (code: string) => {
    try {
      await api(`/staff/batches/${code}/open`, { method: "POST", body: {} });
      announce(`${code} is on sale now.`);
      void load();
    } catch { /* rejected */ }
  };
  const withdraw = async (code: string) => {
    try {
      await api(`/staff/batches/${code}/withdraw`, { method: "POST", body: {} });
      announce(`${code} withdrawn.`);
      void load();
    } catch { /* rejected */ }
  };
  const saveCutoff = async () => {
    try {
      await api("/staff/settings", { method: "PUT", body: { packing_cutoff_local: cutoff } });
      announce(`Packing cutoff is now ${cutoff} Toronto time.`);
    } catch { /* rejected */ }
  };

  return (
    <div class="studio-board">
      <section aria-label={t("logALoaf", locale)} class="log-loaf">
        <h2>{t("logALoaf", locale)}</h2>
        <div class="field">
          <label for="field-log-scent">{t("scentGroup", locale)}</label>
          <select id="field-log-scent" value={logScent} onChange={(event) => setLogScent((event.target as HTMLSelectElement).value)}>
            {DROP_SCENTS.map((scent) => (
              <option key={scent.slug} value={scent.slug}>{scentName(scent.slug, locale)}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="field-pour-date">{t("pourDate", locale)}</label>
          <input id="field-pour-date" type="date" value={pourDate} onInput={(event) => setPourDate((event.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="field-cure-days">{t("cureDays", locale)}</label>
          <input id="field-cure-days" type="number" min={28} max={60} value={cureDays} onInput={(event) => setCureDays(Number((event.target as HTMLInputElement).value))} />
        </div>
        <button type="button" class="button primary" onClick={logLoaf}>{t("logLoaf", locale)}</button>
      </section>
      <table class="studio-table" aria-label={t("batches", locale)}>
        <thead>
          <tr>
            <th scope="col">{t("batchRegion", locale)}</th>
            <th scope="col">{t("scentGroup", locale)}</th>
            <th scope="col">{t("studio", locale)}</th>
            <th scope="col">{t("pourDate", locale)}</th>
            <th scope="col">{t("cureDate", locale)}</th>
            <th scope="col">{t("dropTime", locale)}</th>
            <th scope="col">{t("barList", locale)}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.code}>
              <td>{batch.code}</td>
              <td>{scentName(batch.scent, locale)}</td>
              <td>{batch.state}</td>
              <td>{batch.poured_on ?? ""}</td>
              <td>{formatLongDate(batch.cure_date, locale)}</td>
              <td>{batch.drop_at_local ? formatDropTime(batch.drop_at_local, locale) : "—"}</td>
              <td>
                <ul class={`bar-marks batch-${batch.code}`} aria-label={t("barsOf", locale, { code: batch.code })}>
                  {batch.bars.map((bar) => (
                    <li class={`bar-row bar-${bar.status}`}>
                      {bar.status === "available"
                        ? t("barAvailable", locale, { k: bar.number })
                        : bar.status === "held"
                          ? t("barHeld", locale, { k: bar.number })
                          : t("barSold", locale, { k: bar.number })}
                    </li>
                  ))}
                </ul>
              </td>
              <td>
                {batch.state === "poured" && (
                  <button type="button" class="button" onClick={() => setCutDialog(batch.code)}>{t("cut", locale, { code: batch.code })}</button>
                )}
                {(batch.state === "curing" || batch.state === "scheduled") && (
                  <button type="button" class="button" onClick={() => setScheduleDialog(batch.code)}>{t("schedule", locale, { code: batch.code })}</button>
                )}
                {(batch.state === "curing" || batch.state === "scheduled") && (
                  <button type="button" class="button" onClick={() => open(batch.code)}>{t("openNow", locale, { code: batch.code })}</button>
                )}
                {["poured", "curing", "scheduled", "live"].includes(batch.state) && (
                  <button type="button" class="button" onClick={() => setWithdrawDialog(batch.code)}>{t("withdraw", locale, { code: batch.code })}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="cutoff-setting">
        <label for="field-cutoff">{t("packingCutoff", locale)}</label>
        <input id="field-cutoff" value={cutoff} onInput={(event) => setCutoff((event.target as HTMLInputElement).value)} />
        <button type="button" class="button" onClick={saveCutoff}>{t("saveCutoff", locale)}</button>
      </div>
      <div role="status" class="studio-updates" aria-live="polite">{notice}</div>
      <Dialog
        title={t("cut", locale, { code: cutDialog ?? "" })}
        open={cutDialog !== null}
        onClose={() => setCutDialog(null)}
        onConfirm={() => { if (cutDialog) void cut(cutDialog); setCutDialog(null); }}
        confirmLabel={t("saveCut", locale)}
        closeLabel={t("keepIt", locale)}
      >
        <div class="field">
          <label for="field-cut-bars">{t("barsCutLabel", locale)}</label>
          <input id="field-cut-bars" type="number" min={1} max={24} value={cutBars} onInput={(event) => setCutBars(Number((event.target as HTMLInputElement).value))} />
        </div>
      </Dialog>
      <Dialog
        title={t("schedule", locale, { code: scheduleDialog ?? "" })}
        open={scheduleDialog !== null}
        onClose={() => setScheduleDialog(null)}
        onConfirm={() => { if (scheduleDialog) void schedule(scheduleDialog); setScheduleDialog(null); }}
        confirmLabel={t("saveDropTime", locale)}
        closeLabel={t("keepIt", locale)}
      >
        <div class="field">
          <label for="field-drop-at">{t("dropDateTime", locale)}</label>
          <input id="field-drop-at" value={dropAt} placeholder="2026-11-07T10:00" onInput={(event) => setDropAt((event.target as HTMLInputElement).value)} />
        </div>
      </Dialog>
      <Dialog
        title={t("withdrawDialog", locale, { code: withdrawDialog ?? "" })}
        open={withdrawDialog !== null}
        onClose={() => setWithdrawDialog(null)}
        onConfirm={() => { if (withdrawDialog) void withdraw(withdrawDialog); setWithdrawDialog(null); }}
        confirmLabel={t("yesWithdraw", locale)}
        closeLabel={t("keepIt", locale)}
      />
    </div>
  );
}

export function PackToday({ locale }: { locale: "fr-CA" | "en-CA" }) {
  const [orders, setOrders] = useState<PackingOrder[]>([]);
  const [notice, setNotice] = useState("");
  const [date, setDate] = useState("");
  const load = async () => {
    try {
      const data = await api<{ date: string; orders: PackingOrder[] }>("/staff/packing");
      setOrders(data.orders);
      setDate(data.date);
    } catch { /* keep */ }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const ship = async (orderNumber: string) => {
    try {
      await api(`/staff/orders/${orderNumber}/ship`, { method: "POST", body: {} });
      setNotice(`${orderNumber} marked shipped.`);
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNotice(err.message);
      }
    }
  };
  return (
    <div class="studio-board">
      <h2>{t("packToday", locale)}</h2>
      <table class="studio-table" aria-label={t("ordersToPack", locale)}>
        <thead>
          <tr><th scope="col">{t("batchRegion", locale)}</th><th scope="col">{t("shipsOn", locale)}</th><th scope="col">{t("fullName", locale)}</th><th scope="col">{t("streetAddress", locale)}</th><th scope="col">{t("barList", locale)}</th></tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.number}>
              <td>{order.number}</td>
              <td>{order.ship_on}</td>
              <td>{order.name}</td>
              <td>{order.address.line1}, {order.address.city}, {order.address.province} {order.address.postal_code}</td>
              <td>
                <ul>
                  {order.bars.map((bar) => (
                    <li>{t("holdRow", locale, { k: bar.bar, scent: scentName(bar.scent, locale), batch: bar.batch })}</li>
                  ))}
                </ul>
              </td>
              <td>
                <button type="button" class="button" onClick={() => ship(order.number)}>
                  {t("markShipped", locale, { order: order.number })}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="status" class="studio-updates" aria-live="polite">{notice}</div>
      <p>{date}</p>
    </div>
  );
}

export function FinancePage({ locale }: { locale: "fr-CA" | "en-CA" }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refundBars, setRefundBars] = useState<Record<string, boolean>>({});
  const [restock, setRestock] = useState(false);
  const [reason, setReason] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const search = async () => {
    setNotFound(false);
    try {
      const data = await api<{ orders: { number: string }[]; subscriptions: { number: string }[] }>(`/staff/search?q=${encodeURIComponent(query)}`);
      if (data.orders.length === 1) {
        const detail = await api<Order>(`/staff/orders/${data.orders[0].number}`);
        setOrder(detail);
        setRefundBars({});
      } else if (data.subscriptions.length === 1) {
        const detail = await api<Subscription & Order>(`/staff/subscriptions/${data.subscriptions[0].number}`);
        setOrder(null);
        setNotice(detail.number);
      } else {
        setOrder(null);
      }
    } catch {
      setNotFound(true);
    }
  };

  const issueRefund = async () => {
    if (!order) return;
    setPending(true);
    const bars = Object.entries(refundBars)
      .filter(([, checked]) => checked)
      .map(([key]) => {
        const [batch, bar] = key.split(":");
        return { batch, bar: Number(bar) };
      });
    try {
      const result = await api<{ refund: Refund; order: Order }>(`/staff/orders/${order.number}/refunds`, {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        ifMatch: `"${order.version}"`,
        body: { bars, restock, reason }
      });
      setOrder(result.order);
      setNotice(`Refund ${result.refund.number} issued: ${formatMoney(result.refund.amount.cents, locale)}.`);
      setRefundBars({});
      setReason("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setNotice(err.message);
      } else if (err instanceof ApiError && err.status === 503) {
        setNotice(err.message);
      }
    } finally {
      setPending(false);
    }
  };

  const addCredit = async () => {
    if (!order) return;
    setPending(true);
    try {
      const credit = await api<Credit>("/staff/credits", {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        ifMatch: `"${order.version}"`,
        body: { target: order.number, amount_cents: Math.round(Number(creditAmount) * 100), reason: creditReason }
      });
      setNotice(`Credit ${credit.number} added: ${formatMoney(credit.amount.cents, locale)}.`);
      setCreditAmount("");
      setCreditReason("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fields) {
        setNotice(Object.values(err.fields)[0]);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="studio-board finance">
      <div class="field">
        <label for="field-search">{t("findOrder", locale)}</label>
        <input
          id="field-search"
          type="search"
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
        />
      </div>
      <button type="button" class="button" onClick={search}>{t("findOrder", locale)}</button>
      {notFound && <p>{t("notFoundLine", locale)}</p>}
      {order && (
        <section class="finance-record" aria-label={order.number}>
          <h2>{order.number}</h2>
          <ul class="placed-lines">
            {order.lines.map((line) => (
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={refundBars[`${line.batch}:${line.bar}`] ?? false}
                    onChange={(event) => setRefundBars({ ...refundBars, [`${line.batch}:${line.bar}`]: (event.target as HTMLInputElement).checked })}
                  />
                  {t("refundBar", locale, { k: line.bar })}
                </label>
              </li>
            ))}
          </ul>
          <label>
            <input type="checkbox" checked={restock} onChange={(event) => setRestock((event.target as HTMLInputElement).checked)} />
            {t("returnBars", locale)}
          </label>
          <div class="field">
            <label for="field-refund-reason">{t("refundReason", locale)}</label>
            <input id="field-refund-reason" value={reason} onInput={(event) => setReason((event.target as HTMLInputElement).value)} />
          </div>
          <button type="button" class="button primary" disabled={pending} onClick={issueRefund}>
            {pending ? t("refunding", locale) : t("issueRefund", locale)}
          </button>
          <table class="studio-table" aria-label={t("refundsOf", locale, { order: order.number })}>
            <thead>
              <tr><th scope="col">{t("studio", locale)}</th><th scope="col">{t("barList", locale)}</th><th scope="col">{t("shippingLine", locale)}</th><th scope="col">{t("total", locale)}</th></tr>
            </thead>
            <tbody>
              {(order.refunds ?? []).map((refund) => (
                <tr key={refund.number}>
                  <td>{refund.number}</td>
                  <td>{refund.bars.map((bar) => bar.bar).join(", ")}</td>
                  <td>{formatMoney(refund.allocation.shipping.cents, locale)}</td>
                  <td>{formatMoney(refund.amount.cents, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="field">
            <label for="field-credit-amount">{t("creditAmount", locale)}</label>
            <input id="field-credit-amount" value={creditAmount} placeholder="12.50" onInput={(event) => setCreditAmount((event.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="field-credit-reason">{t("creditReason", locale)}</label>
            <input id="field-credit-reason" value={creditReason} onInput={(event) => setCreditReason((event.target as HTMLInputElement).value)} />
          </div>
          <button type="button" class="button" disabled={pending} onClick={addCredit}>{t("addCredit", locale)}</button>
        </section>
      )}
      <div role="status" class="studio-updates" aria-live="polite">{notice}</div>
    </div>
  );
}

export function ReconciliationPage({ locale }: { locale: "fr-CA" | "en-CA" }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [lines, setLines] = useState<{ key: string; kind: string; shop: { cents: number } | null; killbill: { cents: number } | null; status: string }[]>([]);
  const [stale, setStale] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const load = async () => {
    try {
      const data = await api<{ stale: boolean; checked_at: string | null; lines: typeof lines }>(`/staff/reconciliation?month=${month}`);
      setLines(data.lines);
      setStale(data.stale);
      setCheckedAt(data.checked_at);
    } catch { /* keep */ }
  };
  useEffect(() => {
    void load();
  }, [month]);
  const accept = async (key: string) => {
    try {
      const result = await api<{ line: { killbill: { cents: number } | null } }>("/staff/reconciliation/accept", {
        method: "POST",
        body: { month, key }
      });
      setNotice(`Kill Bill's figure of ${formatMoney(result.line.killbill?.cents ?? 0, locale)} is now the shop record for ${key}.`);
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setNotice(err.message);
      }
    }
  };
  const refundOrphan = async (key: string) => {
    try {
      const result = await api<{ refund: { amount: { cents: number } } }>("/staff/reconciliation/refund-orphan", {
        method: "POST",
        body: { month, key }
      });
      setNotice(`Orphan payment ${key} refunded: ${formatMoney(result.refund.amount.cents, locale)}.`);
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setNotice(err.message);
      }
    }
  };
  const visible = onlyMismatches ? lines.filter((line) => line.status === "mismatch") : lines;
  return (
    <div class="studio-board reconciliation">
      <div class="field">
        <label for="field-month">{t("month", locale)}</label>
        <input id="field-month" type="month" value={month} onInput={(event) => setMonth((event.target as HTMLInputElement).value)} />
      </div>
      <label class="switch">
        <input type="checkbox" role="switch" checked={onlyMismatches} onChange={(event) => setOnlyMismatches((event.target as HTMLInputElement).checked)} />
        {t("onlyMismatches", locale)}
      </label>
      <div role="status" aria-label={t("reconciliationStatus", locale)} class="reconciliation-status">
        {stale
          ? checkedAt
            ? t("staleWithFigures", locale, { checked: formatDropTime(checkedAt.slice(0, 16), locale) })
            : t("staleNoFigures", locale)
          : ""}
      </div>
      <table class="studio-table" aria-label={t("reconciliationLines", locale)}>
        <thead>
          <tr><th scope="col">Key</th><th scope="col">Kind</th><th scope="col">Shop</th><th scope="col">Kill Bill</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {visible.map((line) => (
            <tr key={line.key}>
              <td>{line.key}</td>
              <td>{line.kind}</td>
              <td>{line.shop === null ? "—" : formatMoney(line.shop.cents, locale)}</td>
              <td>{line.killbill === null ? "—" : formatMoney(line.killbill.cents, locale)}</td>
              <td>
                {line.status}
                {line.status === "mismatch" && (
                  <button type="button" class="button" onClick={() => accept(line.key)}>{t("acceptKillbill", locale, { key: line.key })}</button>
                )}
                {line.status === "kb_only" && (
                  <button type="button" class="button" onClick={() => refundOrphan(line.key)}>{t("refundOrphan", locale, { key: line.key })}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="status" class="studio-updates" aria-live="polite">{notice}</div>
    </div>
  );
}

export function AuditPage({ locale }: { locale: "fr-CA" | "en-CA" }) {
  const [entries, setEntries] = useState<{ id: number; at: string; actor: string; role: string; action: string; target: string; reason: string; amount: { cents: number }; killbill_ref: string | null; outcome: string }[]>([]);
  useEffect(() => {
    void api<{ entries: typeof entries }>("/staff/audit").then((data) => setEntries(data.entries));
  }, []);
  return (
    <table class="studio-table" aria-label={t("financeAudit", locale)}>
      <thead>
        <tr><th scope="col">Id</th><th scope="col">At</th><th scope="col">Actor</th><th scope="col">Role</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Reason</th><th scope="col">Amount</th><th scope="col">Kill Bill</th><th scope="col">Outcome</th></tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>{entry.id}</td>
            <td>{entry.at}</td>
            <td>{entry.actor}</td>
            <td>{entry.role}</td>
            <td>{entry.action}</td>
            <td>{entry.target}</td>
            <td>{entry.reason}</td>
            <td>{formatMoney(entry.amount.cents, locale)}</td>
            <td>{entry.killbill_ref ?? "—"}</td>
            <td>{entry.outcome}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NoticesPage({ locale }: { locale: "fr-CA" | "en-CA" }) {
  const [notices, setNotices] = useState<{ number: string; key: string; kind: string; to: string; locale: string; subject: string; status: string; enqueued_at: string; attempts: { at: string; outcome: string }[] }[]>([]);
  const [notice, setNotice] = useState("");
  const load = async () => {
    try {
      const data = await api<{ notices: typeof notices }>("/staff/notices");
      setNotices(data.notices);
    } catch { /* keep */ }
  };
  useEffect(() => {
    void load();
  }, []);
  const resend = async (number: string) => {
    try {
      await api(`/staff/notices/${number}/resend`, { method: "POST", body: {} });
      setNotice(`${number} queued again.`);
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNotice(err.message);
      }
    }
  };
  return (
    <div class="studio-board">
      <table class="studio-table" aria-label={t("notices", locale)}>
        <thead>
          <tr><th scope="col">{t("studio", locale)}</th><th scope="col">Key</th><th scope="col">Kind</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Attempts</th></tr>
        </thead>
        <tbody>
          {notices.map((item) => (
            <tr key={item.number}>
              <td>{item.number}</td>
              <td>{item.key}</td>
              <td>{item.kind}</td>
              <td>{item.to}</td>
              <td>{item.subject}</td>
              <td>{item.status}</td>
              <td>{item.attempts.map((attempt) => `${attempt.at} ${attempt.outcome}`).join("; ")}</td>
              <td>
                {item.status === "failed" && (
                  <button type="button" class="button" onClick={() => resend(item.number)}>{t("resend", locale, { notice: item.number })}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="status" class="studio-updates" aria-live="polite">{notice}</div>
    </div>
  );
}

