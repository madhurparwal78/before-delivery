// Tenants (operator): lifecycle, inspection links and the walk-in storage shelves.
import { Copy, Link2 } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { InspectionLink, Shelf, Tenant } from "../../shared/api";
import { KIND_LABELS, REQUIRED_KINDS, TENANT_STATUS_WORDS } from "../../shared/kitchen";
import { dollars, hmm, kitchenStamp } from "../../shared/time";
import { api, apiNoContent } from "../api";
import { loadTenants, midSentence } from "../data";
import { act, showActivity } from "../feedback";
import { Dialog, useCloseDialog } from "../ui/Dialog";
import { Eyebrow, Field, PendingLine, nextFieldId } from "../ui/parts";

type Open = { kind: "offboard" | "link"; tenant: Tenant; opener: HTMLElement } | null;

export function TenantsScreen() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [open, setOpen] = useState<Open>(null);

  const load = async (mode: "load" | "refresh"): Promise<void> => {
    const outcome = await act({ pending: mode === "load" ? "Loading…" : undefined }, () =>
      Promise.all([loadTenants(), api<{ shelves: Shelf[] }>("GET", "/api/shelves")]),
    );
    if (!outcome.ok) return;
    setTenants(outcome.value[0]);
    setShelves(outcome.value[1].shelves);
  };
  const refresh = (): void => void load("refresh");
  useEffect(() => void load("load"), []);

  const activate = async (t: Tenant): Promise<void> => {
    const outcome = await act(
      {
        pending: "Activating…",
        success: () => `${t.business_name} is active.`,
        error: (f) => {
          if (f.code !== "documents_incomplete") return null;
          const missing = Array.isArray(f.details.missing) ? f.details.missing : [];
          const labels = missing
            .filter((k): k is keyof typeof KIND_LABELS => typeof k === "string" && k in KIND_LABELS)
            .map((k) => midSentence(KIND_LABELS[k]));
          return `${t.business_name} is missing an approved, valid ${labels.join(" and ")}.`;
        },
      },
      () => api<Tenant>("POST", `/api/tenants/${encodeURIComponent(t.id)}/activate`, { body: {} }),
    );
    if (outcome.ok) refresh();
  };

  const assign = async (shelf: Shelf, tenantId: string): Promise<void> => {
    const tenant = tenants?.find((t) => t.id === tenantId) ?? null;
    await act(
      {
        pending: "Saving shelf…",
        success: () => (tenant ? `${shelf.name} assigned to ${tenant.business_name}.` : `${shelf.name} is unassigned.`),
        error: (f) => (f.code === "tenant_not_active" ? "Only active tenants can rent a shelf." : null),
      },
      () => api<Shelf>("PUT", `/api/shelves/${encodeURIComponent(shelf.id)}`, { body: { tenant_id: tenant ? tenant.id : null } }),
    );
    refresh();
  };

  return (
    <div class="sheet">
      <PendingLine />
      <header class="screen-head">
        <h1 class="screen-title">Tenants</h1>
      </header>
      <Eyebrow n={1} label="Tenants" />
      <div class="table-wrap">
        <table class="data cards" role="table" aria-label="Tenants">
          <thead>
            <tr role="row">
              <th role="columnheader">Business</th>
              <th role="columnheader">Owner</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">Required documents</th>
              <th role="columnheader" class="num">
                Hour pack
              </th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants?.map((t) => (
              <tr role="row" key={t.id}>
                <td role="cell" data-label="Business" class="strong">
                  {t.business_name}
                </td>
                <td role="cell" data-label="Owner">
                  {t.owner_name}
                  <span class="cell-note">{t.owner_email}</span>
                </td>
                <td role="cell" data-label="Status">
                  <span class={`badge mono badge-${t.status}`}>{TENANT_STATUS_WORDS[t.status]}</span>
                </td>
                <td role="cell" data-label="Required documents">
                  <ul class="validity">
                    {REQUIRED_KINDS.map((kind) => {
                      const doc = t.required_documents[kind];
                      return (
                        <li key={kind} class={doc.valid ? "valid" : "invalid"}>
                          <span>{KIND_LABELS[kind]}</span>{" "}
                          <span class="mono">
                            {doc.valid ? `valid to ${doc.expires_on}` : doc.expires_on ? `expired ${doc.expires_on}` : "missing"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </td>
                <td role="cell" data-label="Hour pack" class="mono num">
                  {hmm(t.hour_balance_minutes)}
                </td>
                <td role="cell" data-label="Actions" class="row-actions">
                  {t.status === "documents_review" && (
                    <button type="button" class="btn btn-small" aria-label={`Activate ${t.business_name}`} onClick={() => void activate(t)}>
                      Activate
                    </button>
                  )}
                  {(t.status === "active" || t.status === "suspended") && (
                    <button
                      type="button"
                      class="btn btn-small"
                      aria-label={`Offboard ${t.business_name}`}
                      onClick={(e) => setOpen({ kind: "offboard", tenant: t, opener: e.currentTarget })}
                    >
                      Offboard
                    </button>
                  )}
                  {t.status !== "offboarded" && (
                    <button
                      type="button"
                      class="btn btn-small"
                      aria-label={`Inspection link for ${t.business_name}`}
                      onClick={(e) => setOpen({ kind: "link", tenant: t, opener: e.currentTarget })}
                    >
                      <Link2 size={16} aria-hidden="true" />
                      Inspection link
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Eyebrow n={2} label="Storage shelves" />
      <h2 class="section-title">Storage shelves</h2>
      <div class="table-wrap">
        <table class="data cards" role="table" aria-label="Storage shelves">
          <thead>
            <tr role="row">
              <th role="columnheader">Shelf</th>
              <th role="columnheader" class="num">
                Monthly rate
              </th>
              <th role="columnheader">Tenant</th>
            </tr>
          </thead>
          <tbody>
            {shelves?.map((shelf) => (
              <ShelfRow key={shelf.id} shelf={shelf} tenants={tenants ?? []} onAssign={(id) => void assign(shelf, id)} />
            ))}
          </tbody>
        </table>
      </div>
      {open?.kind === "offboard" && (
        <Dialog title={`Offboard ${open.tenant.business_name}`} opener={open.opener} onClose={() => setOpen(null)}>
          <OffboardBody tenant={open.tenant} onDone={refresh} />
        </Dialog>
      )}
      {open?.kind === "link" && (
        <Dialog title={`Inspection link for ${open.tenant.business_name}`} opener={open.opener} onClose={() => setOpen(null)} wide>
          <LinkBody tenant={open.tenant} />
        </Dialog>
      )}
    </div>
  );
}

function ShelfRow({ shelf, tenants, onAssign }: { shelf: Shelf; tenants: Tenant[]; onAssign: (tenantId: string) => void }) {
  const id = useRef(nextFieldId("shelf")).current;
  const choices = tenants.filter((t) => t.status === "active" || t.id === shelf.tenant_id);
  return (
    <tr role="row">
      <td role="cell" data-label="Shelf" class="strong">
        {shelf.name}
      </td>
      <td role="cell" data-label="Monthly rate" class="mono num">
        {dollars(shelf.monthly_rate_cents)}
      </td>
      <td role="cell" data-label="Tenant">
        <label class="sr-only" for={id}>
          Tenant for {shelf.name}
        </label>
        <select id={id} value={shelf.tenant_id ?? ""} onChange={(e) => onAssign(e.currentTarget.value)}>
          <option value="">Unassigned</option>
          {choices.map((t) => (
            <option key={t.id} value={t.id}>
              {t.business_name}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function OffboardBody({ tenant, onDone }: { tenant: Tenant; onDone: () => void }) {
  const close = useCloseDialog();
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    const outcome = await act(
      {
        pending: "Offboarding…",
        success: () => `${tenant.business_name} is offboarded.`,
        error: (f) => (f.code === "open_bookings" ? `${tenant.business_name} still has open bookings. Cancel or complete them first.` : null),
      },
      () => api<Tenant>("POST", `/api/tenants/${encodeURIComponent(tenant.id)}/offboard`, { body: {} }),
    );
    setBusy(false);
    if (outcome.ok) {
      onDone();
      close();
    }
  };
  return (
    <div class="dialog-form">
      <p class="dialog-lede">
        {tenant.business_name}'s people will no longer be able to sign in. Their records stay on file.
      </p>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={close}>
          Keep tenant
        </button>
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          Offboard
        </button>
      </div>
    </div>
  );
}

const DURATIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
];

function LinkBody({ tenant }: { tenant: Tenant }) {
  const close = useCloseDialog();
  const [seconds, setSeconds] = useState(86_400);
  const [link, setLink] = useState<InspectionLink | null>(null);
  const ids = useRef({ lasts: nextFieldId("link-lasts"), link: nextFieldId("link-url") }).current;
  const base = `/api/tenants/${encodeURIComponent(tenant.id)}/inspection-link`;

  useEffect(() => {
    void act({ error: () => false }, () => api<InspectionLink>("GET", base)).then((outcome) => {
      if (outcome.ok) setLink(outcome.value);
    });
  }, [base]);

  const issue = async (): Promise<void> => {
    const outcome = await act(
      {
        pending: "Issuing link…",
        success: (l: InspectionLink) =>
          `Link issued. It expires ${kitchenStamp(Date.parse(l.expires_at))} kitchen time. Any earlier link for this tenant no longer works.`,
      },
      () => api<InspectionLink>("POST", base, { body: { expires_in_seconds: seconds } }),
    );
    if (outcome.ok) setLink(outcome.value);
  };

  const revoke = async (): Promise<void> => {
    const outcome = await act(
      {
        pending: "Revoking…",
        success: () => "Link revoked.",
        error: (f) => (f.status === 404 ? "There is no live link to revoke." : null),
      },
      () => apiNoContent("DELETE", base),
    );
    if (outcome.ok || outcome.failure.status === 404) setLink(null);
  };

  const absolute = link ? `${location.origin}${link.url}` : "";

  const copy = async (): Promise<void> => {
    if (!absolute) return;
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      const field = document.getElementById(ids.link);
      if (field instanceof HTMLInputElement) field.select();
      document.execCommand("copy");
    }
    showActivity("Link copied.");
  };

  return (
    <div class="dialog-form">
      <div class="field-row">
        <Field id={ids.lasts} label="Link lasts">
          <select id={ids.lasts} value={String(seconds)} onChange={(e) => setSeconds(Number(e.currentTarget.value))}>
            {DURATIONS.map((d) => (
              <option key={d.seconds} value={String(d.seconds)}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" class="btn btn-primary align-end" onClick={() => void issue()}>
          Issue link
        </button>
      </div>
      <Field id={ids.link} label="Link" hint={link ? `Expires ${kitchenStamp(Date.parse(link.expires_at))} kitchen time.` : "No live link."}>
        <input id={ids.link} type="text" class="mono" readOnly value={absolute} aria-describedby={`${ids.link}-hint`} />
      </Field>
      <div class="dialog-actions">
        <button type="button" class="btn" disabled={!link} onClick={() => void copy()}>
          <Copy size={16} aria-hidden="true" />
          Copy link
        </button>
        <button type="button" class="btn" onClick={() => void revoke()}>
          Revoke link
        </button>
        <button type="button" class="btn btn-quiet" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
