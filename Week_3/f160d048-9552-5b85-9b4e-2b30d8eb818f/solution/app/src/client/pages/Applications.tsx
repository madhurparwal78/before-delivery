import { useRef } from "react";
import { announce } from "../announce";
import { get } from "../api";
import { useLoad } from "../hooks";
import { useLive, useLiveReload } from "../live";
import { Link } from "../router";
import { Loading, NotFound, Screen } from "../shell/Page";
import { monthYear, nameOf, STAGES } from "../../shared/reference";
import type { MyApplication, MyApplicationDetail } from "../../shared/api";

export function Applications() {
  const applications = useLoad(() => get<{ applications: MyApplication[] }>("/api/me/applications"), []);
  const current = useRef<MyApplication[]>([]);
  current.current = applications.data?.applications ?? [];
  useLive("application.stage", (event) => {
    const known = current.current.find((entry) => entry.id === event.application_id);
    if (!known) return;
    announce(`Your application for ${known.job_title} is now at ${nameOf(STAGES, event.stage)}.`);
    applications.patch((data) => ({ applications: data.applications.map((entry) => (entry.id === event.application_id ? { ...entry, stage: event.stage } : entry)) }));
  });
  useLiveReload(applications.reload);

  const list = applications.data?.applications;
  return (
    <Screen title="My applications">
      <h1 className="page-title">My applications</h1>
      {list && list.length === 0 ? (
        <div className="empty">
          <p>You have not applied for any jobs yet.</p>
          <Link to="/jobs" className="btn">Search lab jobs</Link>
        </div>
      ) : null}
      <ul className="items" aria-label="My applications">
        {(list ?? []).map((application) => (
          <li key={application.id} data-id={application.id}>
            <Link className="item-title" to={`/applications/${application.id}`}>{`${application.job_title} at ${application.company_name}`}</Link>
            <p className="meta">
              <span className="status">{nameOf(STAGES, application.stage)}</span> · applied {application.applied_on}
            </p>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

export function ApplicationDetail({ id }: { id: string }) {
  const application = useLoad(() => get<MyApplicationDetail>(`/api/applications/${id}`), [id]);
  useLive("application.stage", (event) => {
    if (event.application_id === id) application.patch((data) => ({ ...data, stage: event.stage }));
  });
  useLiveReload(application.reload);
  if (application.failure?.status === 404) return <NotFound />;
  const data = application.data;
  if (!data) return <Loading />;
  return (
    <Screen title={data.job_title}>
      <h1 className="page-title">{`${data.job_title} at ${data.company_name}`}</h1>
      <dl className="summary-list">
        <dt>Stage</dt>
        <dd>{nameOf(STAGES, data.stage)}</dd>
        <dt>Applied</dt>
        <dd>{monthYear(data.applied_on.slice(0, 7))}</dd>
        <dt>Name</dt>
        <dd>{data.candidate_name}</dd>
        <dt>Contact email</dt>
        <dd>{data.contact_email}</dd>
      </dl>
      <a className="btn-quiet" href={`/api/files/${data.resume_file_id}`}>Download resume</a>
    </Screen>
  );
}
