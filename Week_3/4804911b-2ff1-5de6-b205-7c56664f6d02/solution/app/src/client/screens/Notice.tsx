import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, formatDate, rupees } from "../../shared/copy";
import type { NoticeDetail, NoticeVersion } from "../../shared/types";
import { linkKey, linkPath, PdfSlot } from "../home/Notices";
import { DataTable } from "../lib/DataTable";
import { useEvery, useWide } from "../lib/hooks";
import { Icon } from "../lib/icons";
import { useSignedLinks } from "../lib/links";
import { ApiFailure, get } from "../lib/net";
import { followLink } from "../lib/router";
import { Slide } from "../lib/Slide";

const stateWord: Record<NoticeVersion["state"], string> = { scheduled: "Scheduled", in_effect: "In effect", superseded: "Superseded" };
const printWord: Record<NoticeVersion["printState"], string> = { pending: "Print pending", printable: "Printable", failed: "Print failed" };

export function Notice({ number }: { number: string }) {
  const wide = useWide();
  const [detail, setDetail] = useState<NoticeDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [lines, setLines] = useState<string[]>([]);
  const seen = useRef(new Map<number, NoticeVersion["printState"]>());

  const load = () =>
    get<NoticeDetail>(`/api/notices/${encodeURIComponent(number)}`)
      .then((d) => {
        const said: string[] = [];
        for (const v of d.versions) {
          const before = seen.current.get(v.version);
          if (before === "pending" && v.printState !== "pending") said.push(`Notice ${d.number} version ${v.version} is now ${v.printState === "failed" ? "Print failed" : "Printable"}.`);
          seen.current.set(v.version, v.printState);
        }
        if (said.length) setLines(said);
        setDetail((old) => (old && JSON.stringify(old) === JSON.stringify(d) ? old : d));
      })
      .catch((error) => {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      });

  useEffect(() => {
    void load();
  }, [number]);
  useEvery(detail?.versions.some((v) => v.printState === "pending") ? 5000 : null, () => void load());

  const targets = (detail?.versions ?? []).filter((v) => v.printState === "printable").map((v) => ({ key: linkKey(detail!.number, v.version), path: linkPath(detail!.number, v.version) }));
  const links = useSignedLinks(targets);
  const failed = detail?.versions.some((v) => v.printState === "failed");
  const sentence = links.sentence || (failed ? COPY.printOutage : "");

  if (missing) return <main><Slide line="REEL MISSING" sentence="This page isn't in the programme." /></main>;
  if (!detail) return <main><Slide line="REEL CHANGE" sentence="One moment while the next reel is threaded." /></main>;

  const toggle = (v: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    <main class="notice-page">
      <header class="notice-head">
        <a class="text-link" href="/" onClick={(e) => followLink(e, "/")}>
          Back to the hoarding
        </a>
        <h1>{detail.number}</h1>
      </header>
      <div role="status" aria-label="Print status" class="status print-status focus-target" tabIndex={-1} ref={links.registerStatus}>
        {sentence && <div>{sentence}</div>}
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div class="versions">
        {detail.versions.map((v, index) => {
          const isOpen = index === 0 || open.has(v.version);
          const body = (
            <div class="version-body" hidden={!isOpen} id={`version-${v.version}`}>
              <p class="version-meta">
                {stateWord[v.state]} · effective {formatDate(v.effectiveDate)}
                {v.runOutUntil ? ` · old wrappers allowed until ${formatDate(v.runOutUntil)}` : ""}
              </p>
              {v.reason && <p class="reason">{v.reason}</p>}
              <DataTable
                label={`Rows of notice ${detail.number} version ${v.version}`}
                wide={wide}
                columns={[{ head: "Pack", lead: true }, { head: "Old MRP" }, { head: "Revised MRP" }, { head: "Kind" }]}
                rows={v.rows.map((r) => ({ key: r.skuCode, cells: [r.name, `Rs ${rupees(r.oldMrpPaise)}`, `Rs ${rupees(r.revisedMrpPaise)}`, r.kind === "sticker" ? "Sticker" : "New print"] }))}
              />
              <p class="print-state">{printWord[v.printState]}</p>
              <PdfSlot number={detail.number} version={v.version} printState={v.printState} links={links} />
            </div>
          );
          return (
            <article class="version" key={v.version}>
              {index === 0 ? (
                <h2 class="version-title">
                  Version {v.version}: {v.title}
                </h2>
              ) : (
                <button type="button" class="version-toggle" aria-expanded={isOpen ? "true" : "false"} aria-controls={`version-${v.version}`} onClick={() => toggle(v.version)}>
                  <span>Version {v.version}</span>
                  <Icon name="caret" size={20} style={{ transform: isOpen ? "rotate(180deg)" : undefined }} />
                </button>
              )}
              {index > 0 && (
                <p class="version-line">
                  {v.title} · {stateWord[v.state]}
                  {v.supersededBy !== null && <> · Superseded by version {v.supersededBy}</>}
                </p>
              )}
              {body}
            </article>
          );
        })}
      </div>
    </main>
  );
}
