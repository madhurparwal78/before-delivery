import { flushSync } from "react-dom";
import { useState, useEffect } from "react";
import { linkClick } from "../../router";
import { NOT_FOUND } from "../copy";
import { isStudio, useOffice } from "../context";
import { useResource } from "../resource";
import { OfficeShell } from "../shell";
import {
  BidForm, StudioTenderView, TenderStatusBlock, TenderTitle, useProjectCurrency, useTenderClock, type ContractorTender, type StudioTender,
} from "../tenderkit";

// /office/tenders/<tender id>: the studio's setup, bidder list and actions, or the contractor's summary and bid form.

export function TenderPage({ id }: { id: string }) {
  const office = useOffice();
  const resource = useResource<{ tender: StudioTender | ContractorTender }>(office.member ? `/api/tenders/${id}` : null);
  const [studio, setStudio] = useState<StudioTender | null>(null);
  const studioRole = isStudio(office.member);
  const tender = resource.data?.tender ?? null;
  useEffect(() => {
    if (studioRole && tender) setStudio(tender as StudioTender);
  }, [studioRole, tender]);
  useTenderClock(tender?.closesAt ?? null, resource.reload);
  const currency = useProjectCurrency(tender && !studioRole ? tender.project.id : null);

  let body;
  if (resource.failure) body = <section className="panel panel-body"><h1>Not found</h1><p>{NOT_FOUND}</p></section>;
  else if (!tender) body = <p className="loading-line">Loading tender…</p>;
  else {
    body = (
      <>
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <a href={`/office/projects/${tender.project.id}/tenders`} onClick={(event) => linkClick(event, `/office/projects/${tender.project.id}/tenders`)}>
                {tender.project.reference} {tender.project.name}
              </a>
            </p>
            <h1>{tender.title}</h1>
          </div>
        </div>
        <section className="panel">
          <TenderTitle projectId={tender.project.id} />
          <div className="panel-body">
            {studioRole && studio ? (
              <StudioTenderView projectId={tender.project.id} timeZone={tender.timeZone} tender={studio}
                onChanged={(next) => flushSync(() => setStudio(next))} />
            ) : (
              <div className="tender-view">
                <TenderStatusBlock status={tender.status} />
                <p className="tender-scope">{tender.scope}</p>
                <BidForm key={tender.id} tender={tender as ContractorTender} currency={currency} reload={resource.reload} />
              </div>
            )}
          </div>
        </section>
      </>
    );
  }
  return <OfficeShell title="Tender">{body}</OfficeShell>;
}
