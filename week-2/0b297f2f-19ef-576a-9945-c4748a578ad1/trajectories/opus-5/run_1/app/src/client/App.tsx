import { type ReactElement } from 'react';
import { useApp } from './state/store';
import { ServiceBanners } from './components/common';
import { LoanRegister, RecordPage } from './components/pages';
import { Workspace } from './components/Workspace';

export function App(): ReactElement {
  const app = useApp();
  const databaseDown = app.status.services.database === 'down';
  const recordMatch = /^\/records\/(.+)$/.exec(app.path);

  let page: ReactElement;
  if (recordMatch) page = <RecordPage objectId={decodeURIComponent(recordMatch[1] as string)} />;
  else if (app.path === '/records') page = <LoanRegister />;
  else page = <Workspace />;

  return (
    <>
      <ServiceBanners />
      <div className="page-body" inert={databaseDown || undefined}>
        {page}
      </div>
    </>
  );
}
