import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PackDetail, Tenant, TenantDetail as TenantRecord } from "../../shared/api.js";
import { dateLabel } from "../../shared/clock.js";
import { api } from "../api.js";
import { Shell, type Session } from "../App.js";
import { usePasswordConfirm } from "../components/PasswordDialog.js";
import { approveCopy, GENERIC, MISSING_RECORD, noticeAnnouncement, refundCopy, statusLabel } from "../copy.js";
import { useRefresh, REFRESH_MS } from "../refresh.js";
import { navigate, type Screen } from "../router.js";
import { announce, focusHeading, Notice, ScreenHeading, tell, type NoticeState } from "../ui.js";
import { DocumentsTable } from "./Documents.js";
import { packHeadingId, PackPanel } from "./Packs.js";


export function Tenants({ session, screen }: { session: Session; screen: Screen }): JSX.Element {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  useEffect(() => {
    void api<{ tenants: Tenant[] }>("GET", "/api/tenants").then((r) => r.ok && setTenants(r.data.tenants));
  }, []);
  return (
    <Shell session={session} screen={screen}>
      <section class="screen">
        <header class="screen__head"><ScreenHeading>Tenants</ScreenHeading><p class="lede">Every business on the books, with the documents that keep them on the floor.</p></header>
        <div class="panel">
          <table class="table" aria-label="Tenants">
            <thead><tr><th scope="col">Business</th><th scope="col">Contact</th><th scope="col">Status</th><th scope="col">Insurance expires</th><th scope="col">Food-handler card expires</th></tr></thead>
            <tbody>
              {(tenants ?? []).map((t) => (
                <tr key={t.id} data-status={t.status}>
                  <td data-label="Business"><a href={`/tenants/${t.id}`} onClick={(e) => { e.preventDefault(); navigate(`/tenants/${t.id}`); }}>{t.businessName}</a></td>
                  <td data-label="Contact">{t.contactName}</td>
                  <td data-label="Status">{statusLabel(t.status, t.suspendedReason)}</td>
                  <td data-label="Insurance expires">{t.insuranceExpiresOn ? dateLabel(t.insuranceExpiresOn) : "—"}</td>
                  <td data-label="Food-handler card expires">{t.foodHandlerExpiresOn ? dateLabel(t.foodHandlerExpiresOn) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

/** Every notice point by document, so a later read can tell which ones just went from queued to sent. */
function noticeStates(tenant: TenantRecord): Map<string, string> {
  return new Map(tenant.documents.flatMap((d) => d.notices.map((n) => [`${d.id}:${n.point}`, n.status] as const)));
}

export function TenantDetail({ session, screen, id }: { session: Session; screen: Screen; id: string }): JSX.Element {
  const [tenant, setTenant] = useState<TenantRecord | null | "missing">(null);
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [packNotice, setPackNotice] = useState<{ packId: string; notice: NoticeState } | null>(null);
  const [focusPack, setFocusPack] = useState<string | null>(null);
  const seen = useRef<Map<string, string> | null>(null);
  const { ask, dialog } = usePasswordConfirm();

  const reload = useRefresh(async (current) => {
    const result = await api<TenantRecord>("GET", `/api/tenants/${id}`);
    if (!current()) return;
    if (!result.ok) {
      if (result.status === 404) setTenant("missing");
      return;
    }
    const now = noticeStates(result.data);
    const before = seen.current;
    seen.current = now;
    if (before) {
      const sent = result.data.documents.flatMap((d) => d.notices
        .filter((n) => n.status === "sent" && before.get(`${d.id}:${n.point}`) === "queued")
        .map((n) => noticeAnnouncement(d.kind, n)));
      if (sent.length > 0) announce(sent.join(" "));
    }
    setTenant((prev) => (prev && prev !== "missing" && JSON.stringify(prev) === JSON.stringify(result.data) ? prev : result.data));
  }, REFRESH_MS, [id]);

  useEffect(() => {
    if (focusPack === null) return;
    document.getElementById(packHeadingId(focusPack))?.focus();
    setFocusPack(null);
  }, [focusPack]);

  if (tenant === "missing") {
    return <Shell session={session} screen={screen}><section class="screen"><p class="missing">{MISSING_RECORD}</p></section></Shell>;
  }
  if (tenant === null) return <Shell session={session} screen={screen}><section class="screen" /></Shell>;

  const approveTenant = async (): Promise<void> => {
    if (approving) return;
    setApproving(true);
    setNotice(tell(approveCopy.pending));
    const result = await api("POST", `/api/tenants/${tenant.id}/approve`);
    setApproving(false);
    if (result.ok) {
      await reload();
      focusHeading();
      setNotice(tell(approveCopy.done(tenant.businessName)));
    } else if (result.status === 409) {
      setNotice(tell(approveCopy.lapsed(tenant.businessName), "conflict"));
      await reload();
    } else if (result.status !== 401) {
      setNotice(tell(GENERIC, "outage"));
    }
  };

  const say = (packId: string, text: string, tone: NoticeState["tone"] = "info"): void => setPackNotice({ packId, notice: tell(text, tone) });

  const refundPack = async (pack: PackDetail, opener: HTMLElement): Promise<void> => {
    if (refunding !== null) return;
    const expected = pack.refundableCents;
    setRefunding(pack.id);
    setPackNotice({ packId: pack.id, notice: tell(refundCopy.pending) });
    const send = (): ReturnType<typeof api<PackDetail>> => api<PackDetail>("POST", `/api/packs/${pack.id}/refund`, { json: { expectedCents: expected } });
    let result = await send();
    if (!result.ok && result.error?.error === "reauth_required") {
      if (!(await ask(opener))) {
        setRefunding(null);
        say(pack.id, refundCopy.dialogClosed);
        return;
      }
      result = await send();
    }
    if (result.ok) {
      say(pack.id, refundCopy.done(result.data.refundedCents ?? 0, tenant.businessName));
      await reload();
      setRefunding(null);
      setFocusPack(pack.id);
      return;
    }
    const code = result.error?.error;
    if (result.status === 401) {
      setRefunding(null);
      return;
    }
    if (result.status === 0 || (result.status !== 412 && result.status !== 409 && result.status !== 503)) {
      setRefunding(null);
      say(pack.id, GENERIC, "outage");
      return;
    }
    const reread = await api<PackDetail>("GET", `/api/packs/${pack.id}`);
    await reload();
    setRefunding(null);
    if (code === "refund_amount_changed" && reread.ok) say(pack.id, refundCopy.changed(reread.data.refundableCents), "conflict");
    else if (code === "billing_unavailable") say(pack.id, refundCopy.billingDown, "outage");
    else if (code === "pack_in_use") say(pack.id, refundCopy.inUse, "conflict");
    else if (code === "pack_empty") say(pack.id, refundCopy.empty, "conflict");
    else say(pack.id, refundCopy.already, "conflict");
    if (code === "pack_empty" || code === "invalid_transition") setFocusPack(pack.id);
  };

  return (
    <Shell session={session} screen={screen}>
      <section class="screen">
        <header class="screen__head">
          <p class="crumb"><a href="/tenants" onClick={(e) => { e.preventDefault(); navigate("/tenants"); }}>Tenants</a></p>
          <ScreenHeading>{tenant.businessName}</ScreenHeading>
          <p class="status-line">Status: {statusLabel(tenant.status, tenant.suspendedReason)}</p>
          <p class="lede">{tenant.contactName} · {tenant.email}</p>
          {tenant.status === "documents_pending" ? (
            <button type="button" class="button button--ink" aria-disabled={approving ? "true" : undefined} onClick={() => void approveTenant()}>Approve {tenant.businessName}</button>
          ) : null}
          <Notice notice={notice} />
        </header>
        <div class="detail">
          <section class="panel" role="region" aria-label="Documents">
            <h2>Documents</h2>
            <DocumentsTable documents={tenant.documents} detail onStorageDown={(text) => setNotice(tell(text, "outage"))} />
          </section>
          <section class="panel" role="region" aria-label="Packs">
            <h2>Packs</h2>
            {tenant.packs.length === 0 ? <p class="muted">No packs bought yet.</p> : <div class="packs">{tenant.packs.map((p, i) => (
              <PackPanel key={p.id} pack={p} number={i + 1} refundable>
                {p.status === "active" && p.balanceMinutes > 0 ? (
                  <button type="button" class="button" aria-disabled={refunding !== null ? "true" : undefined}
                    onMouseDown={(e) => { if (refunding !== null) e.preventDefault(); }}
                    onClick={(e) => void refundPack(p, e.currentTarget)}>Refund {p.hours}-hour pack</button>
                ) : null}
                {packNotice?.packId === p.id ? <Notice notice={packNotice.notice} /> : null}
              </PackPanel>
            ))}</div>}
          </section>
        </div>
      </section>
      {dialog}
    </Shell>
  );
}
