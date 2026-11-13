import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProviders, useStageScene } from './lib/app-context.js';
import { AppShell } from './components/AppShell.js';
import { Landing } from './routes/Landing.js';
import { Brief } from './routes/Brief.js';
import { Commission, Commissions } from './routes/ClientScreens.js';
import { Files, Preview } from './routes/FilesPreview.js';
import { Configure } from './routes/Configure.js';
import { Checkout, InstallDay } from './routes/DayCheckout.js';
import {
  CrmSettings,
  Deliveries,
  Invite,
  Maintenance,
  SponsorShare,
} from './routes/SponsorCrm.js';
import { CrewDaySheet, CrewDays, Jobs, Studio } from './routes/ProducerCrew.js';
import { SIGN_IN_ERROR_PAGE, OUTAGE_BANNERS } from '../shared/copy.js';
import './styles/app.css';

declare global {
  interface Window {
    __SPINDRIFT_PAGE__?: 'signin_error' | 'signin_unavailable';
  }
}

/** A page the server decided on, shown with the product's own look. */
function ServerPage({ page }: { page: 'signin_error' | 'signin_unavailable' }): JSX.Element {
  useStageScene({ scene: 'working', silhouette: 'none' });
  if (page === 'signin_unavailable') {
    return (
      <main className="column">
        <h1>Sign-in is paused</h1>
        <p>{OUTAGE_BANNERS.keycloak}</p>
      </main>
    );
  }
  return (
    <main className="column">
      <h1>{SIGN_IN_ERROR_PAGE.heading}</h1>
      <p>{SIGN_IN_ERROR_PAGE.text}</p>
      <a href="/auth/login">Sign in</a>
    </main>
  );
}

function App(): JSX.Element {
  const serverPage = window.__SPINDRIFT_PAGE__;
  if (serverPage) {
    return (
      <AppShell>
        <ServerPage page={serverPage} />
      </AppShell>
    );
  }
  return (
    <Routes>
      <Route
        path="/"
        element={
          <AppShell>
            <Landing />
          </AppShell>
        }
      />
      <Route path="/brief/new" element={<BriefScreen />} />
      <Route path="/briefs/:briefId" element={<BriefScreen />} />
      <Route
        path="/commissions"
        element={
          <AppShell>
            <Commissions />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId"
        element={
          <AppShell>
            <Commission />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/files"
        element={
          <AppShell>
            <Files />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/preview"
        element={
          <AppShell>
            <Preview />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/configure"
        element={
          <AppShell>
            <Configure />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/day"
        element={
          <AppShell>
            <InstallDay />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/checkout"
        element={
          <AppShell>
            <Checkout />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/share"
        element={
          <AppShell>
            <SponsorShare />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/webhooks"
        element={
          <AppShell>
            <Deliveries />
          </AppShell>
        }
      />
      <Route
        path="/c/:commissionId/maintenance"
        element={
          <AppShell>
            <Maintenance />
          </AppShell>
        }
      />
      <Route
        path="/i/:token"
        element={
          <AppShell>
            <Invite />
          </AppShell>
        }
      />
      <Route
        path="/studio"
        element={
          <AppShell>
            <Studio />
          </AppShell>
        }
      />
      <Route
        path="/studio/jobs"
        element={
          <AppShell>
            <Jobs />
          </AppShell>
        }
      />
      <Route
        path="/crew"
        element={
          <AppShell>
            <CrewDays />
          </AppShell>
        }
      />
      <Route
        path="/crew/days/:installDayId"
        element={
          <AppShell>
            <CrewDaySheet />
          </AppShell>
        }
      />
      <Route
        path="/settings/crm"
        element={
          <AppShell>
            <CrmSettings />
          </AppShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** The brief runs over the full stage with no top bar of its own. */
function BriefScreen(): JSX.Element {
  return (
    <AppShell>
      <Brief />
    </AppShell>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <AppProviders>
          <App />
        </AppProviders>
      </BrowserRouter>
    </StrictMode>,
  );
}
