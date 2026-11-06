import { Copy, Check, Link2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { request } from "../api";
import { brokenBanner, COPY, linkIssued, supersededBy } from "../copy";
import { dayOf, epochOf, minuteDisplay, secondDisplay, stamp } from "../format";
import { useAnnouncer, useRefresh } from "../hooks";
import { Link, navigate } from "../router";
import type { AuditTrail, Project, RederivedFigure, RegulatorLink } from "../types";
import { FigureFacts } from "../ui/FigureFacts";
import { Cell, DataTable, Num, StatusWord } from "../ui/tables";
import { LINK_WORD } from "../format";

/** Readings moved by the breaking batch: the distinct readings of the first batch in the figure's trail. */
function movedByBreak(trail: AuditTrail): number {
  const first = trail.moved[0]?.batch_id;
  return new Set(trail.moved.filter((m) => m.batch_id === first).map((m) => `${m.sensor_id}@${m.interval_start}`)).size;
}

function workspaceHref(slug: string, figure: { start: string; end: string; sensor_ids: string[] }): string {
  const start = epochOf(figure.start), end = epochOf(figure.end);
  const query = `from=${dayOf(start)}&to=${dayOf(end - 1)}&start=${stamp(start)}&end=${stamp(end)}&sensors=${figure.sensor_ids.join(",")}`;
  return `/projects/${slug}?${query}`;
}

const LINK_COLUMNS = [{ label: "Link" }, { label: "Status" }, { label: "Issued" }, { label: "Expires" }, { label: "Action" }];

function RegulatorLinks({ figureId, announce }: { figureId: string; announce: (text: string) => void }) {
  const [links, setLinks] = useState<RegulatorLink[]>([]);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyButton = useRef<HTMLButtonElement>(null);
  const linkBox = useRef<HTMLInputElement>(null);
  const focusCopy = useRef(false);

  const load = useCallback(async () => {
    const r = await request<{ links: RegulatorLink[] }>("GET", `/api/figures/${figureId}/links`);
    if (r.status === 200) setLinks(r.data.links);
  }, [figureId]);
  useEffect(() => void load(), [load]);
  useRefresh(() => void load(), () => false);

  useLayoutEffect(() => {
    if (focusCopy.current && issued) {
      focusCopy.current = false;
      copyButton.current?.focus();
    }
  }, [issued]);

  const issue = async () => {
    const r = await request<RegulatorLink>("POST", `/api/figures/${figureId}/links`, {});
    if (r.status === 201) {
      focusCopy.current = true;
      setCopied(false);
      setIssued(r.data.url);
      announce(linkIssued(minuteDisplay(r.data.expires_at)));
    } else if (r.status === 409) announce(COPY.linkNotIssuable);
    await load();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued!);
      setCopied(true);
    } catch {
      linkBox.current?.select();
    }
  };

  const revoke = async (link: RegulatorLink) => {
    const r = await request<{ error?: string }>("POST", `/api/figures/${figureId}/links/${link.id}/revoke`, {});
    if (r.status === 200) announce(COPY.linkRevoked);
    else if (r.data?.error === "link_expired") announce(COPY.linkAlreadyExpired);
    await load();
  };

  return (
    <div className="links-section">
      <h2>Regulator links</h2>
      <div className="issue-row">
        <button type="button" className="btn" onClick={() => void issue()}>
          <Link2 size={16} aria-hidden="true" /> Issue regulator link
        </button>
      </div>
      {issued && (
        <div className="issued-link">
          <label className="field field-inline">
            <span>Regulator link</span>
            <input ref={linkBox} type="text" readOnly value={issued} className="num" onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="btn" ref={copyButton} onClick={() => void copy()}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} Copy link
          </button>
        </div>
      )}
      <DataTable name="Regulator links" columns={LINK_COLUMNS} className="links-table">
        {links.map((link) => (
          <tr role="row" key={link.id}>
            <Cell label="Link"><Num>…{link.token.slice(-6)}</Num></Cell>
            <Cell label="Status"><span className={`status status-link-${link.status}`}>{LINK_WORD[link.status]}</span></Cell>
            <Cell label="Issued" className="mono-cell"><Num>{minuteDisplay(link.issued_at)}</Num></Cell>
            <Cell label="Expires" className="mono-cell"><Num>{minuteDisplay(link.expires_at)}</Num></Cell>
            <Cell label="Action">
              {link.status === "live" && (
                <button type="button" className="btn btn-small" aria-label={`Revoke link ending ${link.token.slice(-6)}`} onClick={() => void revoke(link)}>
                  Revoke
                </button>
              )}
            </Cell>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export function FigurePage({ slug, figureId }: { slug: string; figureId: string }) {
  const [figure, setFigure] = useState<RederivedFigure | null>(null);
  const [role, setRole] = useState<Project["role"] | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const { region, announce } = useAnnouncer();
  const previous = useRef<RederivedFigure | null>(null);

  const load = useCallback(async () => {
    const [f, p] = await Promise.all([
      request<RederivedFigure>("GET", `/api/figures/${figureId}`),
      request<Project>("GET", `/api/projects/${slug}`),
    ]);
    if (f.status === 404 || p.status === 404) return navigate("/projects", { state: { lostAccess: true } });
    if (f.status !== 200 || p.status !== 200) return;
    const before = previous.current;
    previous.current = f.data;
    if (before && before.status !== "superseded" && f.data.status === "superseded") announce(supersededBy(f.data.superseded_by!));
    if (f.data.status === "broken") {
      const trail = await request<AuditTrail>("GET", `/api/figures/${figureId}/audit`);
      if (trail.status === 200) setMoved(movedByBreak(trail.data));
    }
    setFigure(f.data);
    setRole(p.data.role);
  }, [figureId, slug, announce]);
  useEffect(() => void load(), [load]);
  useRefresh(() => void load(), () => false);

  return (
    <main className="page page-reading">
      {figure && figure.status === "broken" && moved !== null && (
        <p role="alert" className="broken-banner">{brokenBanner(moved)}</p>
      )}
      <header className="page-header">
        <h1>Figure {figureId}</h1>
        {figure && (
          <p className="figure-status-line">
            <StatusWord status={figure.status} />
            {figure.superseded_by && <> by <Link href={`/projects/${slug}/figures/${figure.superseded_by}`} className="num">{figure.superseded_by}</Link></>}
            {figure.supersedes && <span className="muted-note"> · replaces <Link href={`/projects/${slug}/figures/${figure.supersedes}`} className="num">{figure.supersedes}</Link></span>}
            <span className="checked">Checked at <Num>{secondDisplay(figure.checked_at)}</Num></span>
          </p>
        )}
        <div role="status" aria-label="Figure status" className="status-line num" ref={region} />
      </header>
      {figure ? (
        <>
          <div className="figure-actions">
            <Link href={workspaceHref(slug, figure)} className="btn">Open interval in workspace</Link>
            <Link href={`/projects/${slug}/figures/${figureId}/audit`} className="btn">Readings audit trail</Link>
          </div>
          <FigureFacts figure={figure} />
          {role === "sealer" && <RegulatorLinks figureId={figureId} announce={announce} />}
        </>
      ) : (
        <p className="loading num">Loading…</p>
      )}
    </main>
  );
}
