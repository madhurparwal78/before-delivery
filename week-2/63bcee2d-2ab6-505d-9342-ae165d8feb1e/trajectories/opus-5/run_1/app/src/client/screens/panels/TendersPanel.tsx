import { useState } from 'react';
import { TENDER_STATUS_LABELS, isStudioRole } from '../../../shared/domain.js';
import { formatInstant } from '../../../shared/format.js';
import { Link } from '../../lib/router.jsx';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { Panel, TableRegion } from '../../components/Panel.jsx';
import { TenderSetup, type StudioTender } from '../../components/TenderSetup.jsx';
import { ContractorBidForm } from '../../components/ContractorBidForm.jsx';
import type { ContractorTender } from '../../components/ContractorBidForm.jsx';
import type { PanelProps } from '../ProjectPage.jsx';

export function TendersPanel(props: PanelProps): JSX.Element {
  const { project } = props;
  const { member } = useWorkspace();
  const studio = member ? isStudioRole(member.role) : false;
  const tenders = useResource<{ tenders: (StudioTender | ContractorTender)[] }>(
    `/api/projects/${project.id}/tenders`,
    [project.id],
  );
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<StudioTender | null>(null);

  const list = tenders.data?.tenders ?? [];
  const mayCreate = member?.role === 'director' || member?.role === 'project_lead';

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Tenders</h2>}
    >
      {mayCreate ? (
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCreated(null);
              setCreating(true);
            }}
          >
            New tender
          </button>
        </div>
      ) : null}

      {creating ? (
        <TenderSetup
          projectId={project.id}
          projectTimeZone={project.timeZone}
          tender={created}
          onCreated={setCreated}
          onChanged={tenders.reload}
          restoreForm={props.restoreForm}
        />
      ) : null}

      {list.length === 0 ? (
        <p className="meta">This project has no tender yet.</p>
      ) : (
        <TableRegion label="Tenders table">
          <table>
            <caption>Tenders</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Closes</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tender) => (
                <tr key={tender.id}>
                  <th scope="row">
                    <Link to={`/office/tenders/${tender.id}`}>{tender.title}</Link>
                  </th>
                  <td>{TENDER_STATUS_LABELS[tender.status]}</td>
                  <td>
                    {tender.closesAt
                      ? formatInstant(new Date(tender.closesAt), tender.timeZone)
                      : 'Not set'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}

      {!studio && list.length > 0
        ? list.map((tender) => (
            <ContractorBidForm
              key={tender.id}
              tender={tender as ContractorTender}
              onChanged={tenders.reload}
              restoreForm={props.restoreForm}
            />
          ))
        : null}
    </Panel>
  );
}
