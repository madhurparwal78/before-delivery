import { useState } from "react";
import { api, type Certificate } from "../api";
import { monDYyyy } from "../format";
import { Alert } from "../ui/feedback";
import { Empty, Icon } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { ShareDialog } from "./ShareDialog";

const STATUS: Record<Certificate["state"], string> = { sealing: "Pending", sealed: "Sealed", revoked: "Revoked" };

export function Transcript() {
  const { data, failure } = useLoad(() => api<{ certificates: Certificate[]; total_hours: string }>("GET", "/api/me/transcript"));
  const [sharing, setSharing] = useState<string | null>(null);
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Continuing education record</p>
        <PageHeading>Transcript</PageHeading>
        <p className="lede">Every certificate you've earned with Sorrel &amp; Pike Learning. Share any sealed certificate with a licensing board or employer.</p>
      </div>
      {failure && <Alert>{failure}</Alert>}
      <table className="data stacks" aria-label="Certificates">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Serial</th>
            <th scope="col">Issued</th>
            <th scope="col" className="fig">
              Hours
            </th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data?.certificates.map((c) => (
            <tr key={c.id}>
              <td className="course" data-label="Course">
                {c.course_title}
              </td>
              <td data-label="Serial" className="tabular">
                {c.serial}
              </td>
              <td data-label="Issued">{c.issued_on ? monDYyyy(c.issued_on) : "Pending"}</td>
              <td data-label="Hours" className="fig">
                {c.contact_hours}
              </td>
              <td data-label="Status">
                {STATUS[c.state]}
                {c.reissue_pending && <span className="muted"> (reissue being stored)</span>}
              </td>
              <td className="actions">
                <div className="row-actions">
                  {c.state === "sealed" && (
                    <button type="button" className="btn secondary" onClick={() => setSharing(c.id)}>
                      <Icon name="link" />
                      Share
                    </button>
                  )}
                  <Link to={`/learn/${c.enrolment_id}/seal`} className="btn secondary">
                    View seal
                  </Link>
                </div>
              </td>
            </tr>
          ))}
          {data && (
            <tr className="total">
              <td colSpan={3}>Total earned hours</td>
              <td className="fig" data-label="Total earned hours">
                {data.total_hours}
              </td>
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>
      {data?.certificates.length === 0 && <Empty>No certificates yet. Finish a course and its post-evaluation to earn your first seal.</Empty>}
      {sharing && <ShareDialog certificateId={sharing} onClosed={() => setSharing(null)} />}
    </>
  );
}
