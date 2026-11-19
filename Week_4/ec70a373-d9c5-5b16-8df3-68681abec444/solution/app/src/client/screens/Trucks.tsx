// Trucks: find a member, record arrivals and departures, read the visit log and manage inspector links.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link2, Truck } from "lucide-react";
import { SERVICE_LABELS, type InspectorLink, type Me, type MemberMatch, type Service, type TruckLog, type Visit } from "../../shared/api.ts";
import { siteDateTime, siteTime } from "../../shared/format.ts";
import { api, errorCopy } from "../api.ts";
import { MemberSearch } from "../MemberSearch.tsx";
import { OverdueNotice, VisitTable } from "../VisitTable.tsx";
import { reloadsPaused } from "../session.ts";
import { useSites } from "../useSites.ts";
import { ActionButton, Dialog, EmptyState, Status, useFieldErrors, useLatestRequest, useStatusRegion, type Say } from "../ui.tsx";

const SERVICES = Object.keys(SERVICE_LABELS) as Service[];
const LINK_STATES = { live: "Live", expired: "Expired", revoked: "Revoked" } as const;
const NOT_LIVE = "This link is no longer live.";
const STORAGE_DOWN = "Document storage is unreachable, so no link was issued.";
const EMAIL_COPY = "Enter a valid email address.";
const VISITS_REFRESH_MS = 60_000;

export function Trucks({ me }: { me: Me }): ReactNode {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<MemberMatch | null>(null);
  const [log, setLog] = useState<TruckLog | null>(null);
  const [links, setLinks] = useState<InspectorLink[]>([]);
  const zone = useSites().find((site) => site.id === me.user.site_id)?.time_zone ?? "UTC";
  const [status, say] = useStatusRegion();
  const [departing, setDeparting] = useState<Visit | null>(null);
  const [inspectorEmail, setInspectorEmail] = useState("");
  const errors = useFieldErrors();
  const [pending, setPending] = useState<string | null>(null);
  const truckId = picked?.truck?.id ?? null;
  const beginVisits = useLatestRequest();
  const beginLinks = useLatestRequest();

  /** The visits request: the only source of the visit table and of the Overdue notice. */
  const loadVisits = useCallback(async () => {
    if (!truckId) return;
    const isLatest = beginVisits();
    const visits = await api<TruckLog>(`/api/trucks/${truckId}/visits`);
    if (isLatest() && visits.ok) setLog(visits.data);
  }, [truckId, beginVisits]);

  const loadLinks = useCallback(async () => {
    if (!truckId) return;
    const isLatest = beginLinks();
    const linkList = await api<{ links: InspectorLink[] }>(`/api/trucks/${truckId}/inspector-links`);
    if (isLatest() && linkList.ok) setLinks(linkList.data.links);
  }, [truckId, beginLinks]);

  useEffect(() => {
    setLog(null);
    setLinks([]);
    void loadVisits();
    void loadLinks();
    if (!truckId) return undefined;
    const id = setInterval(() => {
      if (!reloadsPaused()) void loadVisits();
    }, VISITS_REFRESH_MS);
    return () => clearInterval(id);
  }, [truckId, loadVisits, loadLinks]);

  const open = log?.visits.find((v) => v.departed_at === null) ?? null;

  const arrive = async (): Promise<void> => {
    if (!truckId) return;
    say("Saving…");
    setPending("arrive");
    const result = await api<{ visit: Visit }>(`/api/trucks/${truckId}/visits`, { method: "POST", body: {} });
    setPending(null);
    if (result.ok) say(`Truck arrived at ${siteTime(result.data.visit.arrived_at, zone)}.`);
    else say(errorCopy(result, { visit_open: "This truck is already checked in. Record its departure first." }), "error");
    await loadVisits();
  };

  const linkAction = async (link: InspectorLink, action: "revoke" | "reissue"): Promise<void> => {
    say(action === "revoke" ? "Revoking…" : "Reissuing…");
    setPending(`${action}-${link.id}`);
    const result = await api<{ link: InspectorLink }>(`/api/inspector-links/${link.id}/${action}`, { method: "POST" });
    setPending(null);
    if (result.ok) say(action === "revoke" ? "Link revoked. It stops working now." : `New link sent to ${result.data.link.inspector_email}. The old link no longer works.`);
    else say(errorCopy(result, { invalid_transition: NOT_LIVE, storage_unavailable: STORAGE_DOWN }), "error");
    void loadLinks();
  };

  return (
    <div className="screen trucks">
      <h1 className="screen-title">Trucks</h1>
      <Status name="Visit log status" message={status} />
      <div className="split">
        <div className="split-main">
          <MemberSearch
            label="Find a member"
            value={text}
            onText={setText}
            onPick={(member) => {
              setText(member.business_name);
              setPicked(member);
            }}
          />
          {picked && !picked.truck && <p className="lede">{picked.business_name} has no truck on file.</p>}
          {picked?.truck && (
            <section aria-labelledby="truck-title" className="truck-panel">
              <h2 id="truck-title">
                <Truck aria-hidden="true" size={20} /> {picked.truck.name} · {picked.business_name}
              </h2>
              <div className="button-row">
                <ActionButton pending={pending === "arrive" || !log || open !== null} className={`button button-primary${!log || open !== null ? " button-unready" : ""}`} onPress={() => void arrive()}>
                  Truck arrived
                </ActionButton>
                <button type="button" className={`button${open === null ? " button-unready" : ""}`} aria-disabled={open === null} onClick={() => { if (open) setDeparting(open); }}>
                  Truck departed
                </button>
              </div>
            </section>
          )}
          {!picked && <EmptyState drawing="clipboard">Search for a member to open their truck's visit log.</EmptyState>}
        </div>
        {picked?.truck && (
          <section className="split-side" aria-labelledby="links-title">
            <h2 id="links-title">
              <Link2 aria-hidden="true" size={18} /> Inspector access
            </h2>
            <form
              className="form"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                if (!truckId || pending === "issue") return;
                errors.clearAll();
                say("Issuing link…");
                setPending("issue");
                const result = await api<{ link: InspectorLink }>(`/api/trucks/${truckId}/inspector-links`, {
                  method: "POST",
                  body: { inspector_email: inspectorEmail },
                });
                setPending(null);
                if (result.ok) {
                  say(`Link sent to ${result.data.link.inspector_email}. It works until ${siteDateTime(result.data.link.expires_at, zone)} site time.`);
                  setInspectorEmail("");
                } else if (result.error?.code === "validation") {
                  errors.set("inspector_email", EMAIL_COPY);
                  say(EMAIL_COPY, "error");
                } else say(errorCopy(result, { storage_unavailable: STORAGE_DOWN }), "error");
                void loadLinks();
              }}
            >
              <div className="field">
                <label htmlFor="inspector-email">Inspector email</label>
                <input
                  id="inspector-email"
                  type="text"
                  inputMode="email"
                  value={inspectorEmail}
                  {...errors.attrs("inspector_email")}
                  onChange={(e) => {
                    setInspectorEmail(e.target.value);
                    errors.clear("inspector_email");
                  }}
                />
                {errors.node("inspector_email")}
              </div>
              <button type="submit" className="button button-primary" aria-disabled={pending === "issue"}>
                Issue inspector link
              </button>
            </form>
            <ul role="list" aria-label="Inspector links" className="links">
              {links.map((link) => (
                <li key={link.id} className={`link-item link-${link.state}`}>
                  <span className="link-email">{link.inspector_email}</span>
                  <span className="mono">Until {siteDateTime(link.expires_at, zone)}</span>
                  <span className="stamp-word">{LINK_STATES[link.state]}</span>
                  {link.state === "live" && (
                    <span className="button-row">
                      <ActionButton pending={pending === `revoke-${link.id}`} className="button button-small" onPress={() => void linkAction(link, "revoke")}>
                        Revoke
                      </ActionButton>
                      <ActionButton pending={pending === `reissue-${link.id}`} className="button button-small" onPress={() => void linkAction(link, "reissue")}>
                        Reissue
                      </ActionButton>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {picked?.truck && (
        <div className="visit-log">
          {log && <OverdueNotice overdue={log.overdue} lastDepartedAt={log.last_departed_at} timeZone={zone} />}
          <VisitTable name="Visit log" visits={log?.visits ?? []} timeZone={zone} />
        </div>
      )}
      {departing && (
        <DepartureDialog
          visit={departing}
          onClose={() => setDeparting(null)}
          say={say}
          onDone={() => void loadVisits()}
          zone={zone}
        />
      )}
    </div>
  );
}

function DepartureDialog({
  visit,
  onClose,
  say,
  onDone,
  zone,
}: {
  visit: Visit;
  onClose: () => void;
  say: Say;
  onDone: () => void;
  zone: string;
}): ReactNode {
  const [services, setServices] = useState<Service[]>([]);
  const [signature, setSignature] = useState("");
  const errors = useFieldErrors();
  const [busy, setBusy] = useState(false);
  const copy: Record<string, string> = { services: "Choose at least one service.", operator_signature: "Type the operator's name to sign." };
  return (
    <Dialog title="Record departure" onClose={onClose}>
      {(close) => (
        <>
          <fieldset role="group" aria-labelledby="services-legend" className="services" {...errors.attrs("services")}>
            <legend id="services-legend">Services</legend>
            {SERVICES.map((s) => (
              <label key={s} className="check">
                <input
                  type="checkbox"
                  checked={services.includes(s)}
                  onChange={(e) => {
                    setServices((list) => (e.target.checked ? [...list, s] : list.filter((x) => x !== s)));
                    errors.clear("services");
                  }}
                />
                <span>{SERVICE_LABELS[s]}</span>
              </label>
            ))}
          </fieldset>
          {errors.node("services")}
          <div className="field">
            <label htmlFor="operator-signature">Operator signature</label>
            <input
              id="operator-signature"
              type="text"
              value={signature}
              {...errors.attrs("operator_signature")}
              onChange={(e) => {
                setSignature(e.target.value);
                errors.clear("operator_signature");
              }}
            />
            {errors.node("operator_signature")}
          </div>
          <div className="dialog-actions">
            <ActionButton
              pending={busy}
              className="button button-primary"
              onPress={async () => {
                setBusy(true);
                errors.clearAll();
                say("Saving…");
                const result = await api<{ visit: Visit }>(`/api/visits/${visit.id}/depart`, {
                  method: "POST",
                  body: { services, operator_signature: signature },
                });
                setBusy(false);
                if (result.ok && result.data.visit.departed_at) {
                  say(`Departure recorded at ${siteTime(result.data.visit.departed_at, zone)}.`);
                  onDone();
                  close();
                  return;
                }
                if (!result.ok && result.error?.code === "validation") {
                  const named = Object.keys(copy).filter((f) => !result.ok && f in (result.error?.fields ?? {}));
                  for (const f of named) errors.set(f, copy[f] ?? "");
                  const first = named[0];
                  say(first ? (copy[first] ?? "") : errorCopy(result, {}), "error");
                  return;
                }
                if (!result.ok) say(errorCopy(result, { invalid_transition: "This visit already has a departure." }), "error");
              }}
            >
              Save departure
            </ActionButton>
            <button type="button" className="button" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
