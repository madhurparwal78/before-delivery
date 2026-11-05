import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NOT_FOUND_HEADING } from '../shared/copy.js';
import { AccountPage } from './AccountPage.js';
import { CheckinPage } from './CheckinPage.js';
import { ContentDeskPage } from './ContentDeskPage.js';
import { DeskPage } from './DeskPage.js';
import { PublicSite } from './PublicSite.js';
import { LabProvider } from './store.js';

function NotFound(): ReactNode {
  return (
    <main className="staff">
      <h1>{NOT_FOUND_HEADING}</h1>
      <p>
        <a href="/">Back to the programme</a>
      </p>
    </main>
  );
}

function Route(): ReactNode {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return <PublicSite />;
  if (path === '/account') return <AccountPage />;
  if (path === '/desk') return <DeskPage />;
  if (path === '/desk/content') return <ContentDeskPage />;
  if (path === '/checkin') return <CheckinPage />;
  return <NotFound />;
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <LabProvider>
        <Route />
      </LabProvider>
    </StrictMode>,
  );
}
