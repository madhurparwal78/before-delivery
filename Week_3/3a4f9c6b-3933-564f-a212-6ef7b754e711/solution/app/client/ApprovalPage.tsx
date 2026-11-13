// The approval link page: works without signing in while the request is pending.
import { useEffect, useState, type MouseEvent } from "react";
import type { ApprovalLink } from "../shared/api";
import { clusterTime } from "../shared/zone";
import { call } from "./api";
import { DiffList } from "./Evidence";
import { FeedbackRegions, generalError, problem, useFeedback } from "./feedback";
import { navigate } from "./hooks";

type Page = { kind: "loading" } | { kind: "open"; link: ApprovalLink } | { kind: "expired" } | { kind: "unknown" } | { kind: "failed" };

export function ApprovalPage({ token }: { token: string }) {
  const say = useFeedback();
  const [page, setPage] = useState<Page>({ kind: "loading" });
  useEffect(() => {
    void call<ApprovalLink>("GET", `/api/approval-links/${encodeURIComponent(token)}`, { guest: true }).then((result) => {
      if (result.ok) setPage({ kind: "open", link: result.data });
      else if (result.status === 410) setPage({ kind: "expired" });
      else if (result.status === 404) setPage({ kind: "unknown" });
      else {
        setPage({ kind: "failed" });
        say(problem(generalError(result)));
      }
    });
  }, [token]);

  let content;
  if (page.kind === "loading") content = <p className="loading">Loading…</p>;
  else if (page.kind === "expired") content = <h1 className="page-title">This approval link has expired.</h1>;
  else if (page.kind === "unknown") content = <><h1 className="page-title">Approval link not found</h1><p>Check the link in your message.</p></>;
  else if (page.kind === "failed") content = <h1 className="page-title">Approval link</h1>;
  else {
    const { link } = page;
    const target = `/projects/${link.project}?stage=${encodeURIComponent(link.stage)}&promotion=${link.promotion_id}`;
    const open = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      navigate(target);
    };
    content = (
      <>
        <h1 className="page-title">Approval requested</h1>
        <dl className="facts">
          <div><dt>Project</dt><dd>{link.project}</dd></div>
          <div><dt>Stage</dt><dd>{link.stage}</dd></div>
          <div><dt>Version</dt><dd className="mono">{link.bundle.version}</dd></div>
          <div><dt>Digest</dt><dd className="mono">{link.bundle.short_digest}</dd></div>
          <div><dt>Requester</dt><dd>{`${link.requested_by.name} (${link.requested_by.email})`}</dd></div>
          <div className="fact-time"><dt>Request expires</dt><dd className="mono">{clusterTime(link.request_expires_at, link.time_zone)}</dd></div>
        </dl>
        <h2 className="section-title">Diff</h2>
        <DiffList diff={link.diff} />
        <a className="button primary link-button" href={target} onClick={open}>Open in Keelson</a>
      </>
    );
  }
  return (
    <main className="approval-page">
      {page.kind !== "expired" && <p className="brand"><span className="brand-name">Keelson</span><span className="brand-maker">Tideline Works</span></p>}
      {content}
      <FeedbackRegions />
    </main>
  );
}
