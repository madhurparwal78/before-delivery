import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import HomePage from "./HomePage.jsx";
import ConnectorsPage from "./ConnectorsPage.jsx";
import PricingPage from "./PricingPage.jsx";
import MarketingTextPage from "./MarketingTextPage.jsx";
import { AcceptInvitePage, LoginPage, SignInChooserPage } from "./AuthPages.jsx";
import { ConsoleShell } from "./console.jsx";
import { DashboardPage, ConnectionWizardPage } from "./consolePages1.jsx";
import { DestinationsPage, SourcesPage, TablePage } from "./consolePages2.jsx";
import { AuditPage, BuilderPage, MembersPage, SettingsPage } from "./consolePages3.jsx";
import { ConnectionPage } from "./ConnectionPage.jsx";

function NotFound() {
  return (
    <main className="not-found wrap">
      <h1>Page not found</h1>
      <p>The address you asked for does not exist.</p>
      <a href="/" className="btn btn-primary">Back to home</a>
    </main>
  );
}

function Console() {
  return (
    <ConsoleShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/destinations" element={<DestinationsPage />} />
        <Route path="/connections/new" element={<ConnectionWizardPage />} />
        <Route path="/connections/:connectionId" element={<ConnectionPage />} />
        <Route path="/destinations/:destinationId/tables/:table" element={<TablePage />} />
        <Route path="/builder" element={<BuilderPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </ConsoleShell>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/connectors" element={<ConnectorsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/connector-builder" element={<MarketingTextPage path="/connector-builder" />} />
        <Route path="/data-replication" element={<MarketingTextPage path="/data-replication" />} />
        <Route path="/hybrid" element={<MarketingTextPage path="/hybrid" />} />
        <Route path="/mcp" element={<MarketingTextPage path="/mcp" />} />
        <Route path="/context-layer" element={<MarketingTextPage path="/context-layer" />} />
        <Route path="/why-open-source" element={<MarketingTextPage path="/why-open-source" />} />
        <Route path="/compare" element={<MarketingTextPage path="/compare" />} />
        <Route path="/data-engineering-resources"
          element={<MarketingTextPage path="/data-engineering-resources" />} />
        <Route path="/signin" element={<SignInChooserPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/app/*" element={<Console />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
