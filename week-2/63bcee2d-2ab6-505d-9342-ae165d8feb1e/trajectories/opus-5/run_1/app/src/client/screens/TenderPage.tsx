import { useState } from 'react';
import { isStudioRole } from '../../shared/domain.js';
import { setPageTitle } from '../lib/router.jsx';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { Panel } from '../components/Panel.jsx';
import { TenderSetup, type StudioTender } from '../components/TenderSetup.jsx';
import { ContractorBidForm, type ContractorTender } from '../components/ContractorBidForm.jsx';
import { NotFound } from './NotFound.jsx';
import { useTenderClock } from '../lib/useTenderClock.js';

export function TenderPage({
  tenderId,
  restoreForm,
}: {
  tenderId: string;
  restoreForm: string | null;
}): JSX.Element {
  const { member } = useWorkspace();
  const [tick, setTick] = useState(0);
  const { data, error, reload } = useResource<{ tender: StudioTender | ContractorTender }>(
    `/api/tenders/${tenderId}`,
    [tenderId, tick],
  );

  useTenderClock(
    data?.tender.closesAt ?? null,
    () => setTick((value) => value + 1),
  );

  setPageTitle('Tender · Marrow Hall Interiors');
  if (error) return <NotFound />;

  const tender = data?.tender;
  const studio = member ? isStudioRole(member.role) : false;

  return (
    <Panel
      sheetCode="PL-03"
      revision="T-000"
      name="Tenders"
      heading={<h1>{tender?.title ?? 'Tender'}</h1>}
    >
      {tender && studio ? (
        <TenderSetup
          projectId={tender.project.id}
          projectTimeZone={tender.timeZone}
          tender={tender as StudioTender}
          onCreated={() => reload()}
          onChanged={reload}
          restoreForm={restoreForm}
        />
      ) : null}
      {tender && !studio ? (
        <ContractorBidForm
          tender={tender as ContractorTender}
          onChanged={reload}
          restoreForm={restoreForm}
        />
      ) : null}
    </Panel>
  );
}
