import { useState } from "react";
import { flushSync } from "react-dom";
import { formatTime } from "../../../../shared/format";
import { get } from "../../api";
import { linkClick } from "../../router";
import { isStudio, useOffice } from "../context";
import { focusId } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import { STATUS_LABEL, StudioTenderView, useTenderClock, type StudioTender, type TenderStatus } from "../tenderkit";

// PL-03 Tenders: the project's tenders, and a new tender set up, published and managed in place.

interface TenderSummary {
  id: string;
  title: string;
  closesAt: string | null;
  timeZone: StudioTender["timeZone"];
  status: TenderStatus;
}

export function TendersPanel() {
  const office = useOffice();
  const { project } = useProject();
  const list = useResource<{ tenders: TenderSummary[] }>(`/api/projects/${project.id}/tenders`);
  const [active, setActive] = useState<StudioTender | null | "new">(null);
  const canCreate = office.member?.role === "director" || office.member?.role === "project_lead";
  const current = active && active !== "new" ? active : null;
  useTenderClock(current?.closesAt ?? null, async () => {
    await list.reload();
    if (!current) return;
    const fresh = await get<{ tender: StudioTender }>(`/api/tenders/${current.id}`);
    if (fresh.ok) setActive(fresh.data.tender);
  });

  return (
    <>
      <PanelTitle section="tenders" />
      <div className="panel-heading">
        <div>
          <h2>Tenders</h2>
          <p className="muted">Sealed tenders: bids stay hidden from everyone but their bidder until opened after close.</p>
        </div>
        {canCreate && (
          <button type="button" className="button button-primary" onClick={() => {
            flushSync(() => setActive("new"));
            focusId("new-tender");
            document.querySelector<HTMLInputElement>("#new-tender input")?.focus();
          }}>New tender</button>
        )}
      </div>
      <div className="panel-body">
        {active !== null && (
          <section id="new-tender" className="tender-workspace" aria-label="Tender setup">
            <StudioTenderView projectId={project.id} timeZone={project.timeZone} tender={current}
              onChanged={(tender) => {
                setActive(tender);
                void list.reload();
              }} />
          </section>
        )}
        {list.data && !list.data.tenders.length && <p className="empty-line">No tenders on this project yet.</p>}
        {!!list.data?.tenders.length && (
          <ul className="tender-list" aria-label="Project tenders">
            {list.data.tenders.map((tender) => (
              <li key={tender.id}>
                <a href={`/office/tenders/${tender.id}`} onClick={(event) => linkClick(event, `/office/tenders/${tender.id}`)}>{tender.title}</a>
                <span className={`tender-state tender-state-${tender.status}`}>{STATUS_LABEL[tender.status]}</span>
                <span className="muted">{tender.closesAt ? `Closes ${formatTime(tender.closesAt, tender.timeZone)}` : "No close set"}</span>
              </li>
            ))}
          </ul>
        )}
        {!isStudio(office.member) && list.data && <p className="muted">Open a tender to see its summary.</p>}
      </div>
    </>
  );
}
