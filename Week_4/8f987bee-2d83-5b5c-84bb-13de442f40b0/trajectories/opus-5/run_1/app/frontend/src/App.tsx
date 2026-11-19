import { Route, Routes } from "react-router-dom";
import { Home } from "./marketing/Home";
import { Connectors } from "./marketing/Connectors";
import { Pricing } from "./marketing/Pricing";
import {
  ComparePage,
  ConnectorBuilderPage,
  ContextLayerPage,
  DataReplicationPage,
  HybridPage,
  McpPage,
  NotFound,
  ResourcesPage,
  SignInChooser,
  WhyOpenSourcePage,
} from "./marketing/Pages";
import { AcceptInvite, Login } from "./auth/Login";
import { ConsoleShell } from "./console/Shell";
import { Dashboard } from "./console/Dashboard";
import { Wizard } from "./console/Wizard";
import { ConnectionPage } from "./console/ConnectionPage";
import { Sources } from "./console/Sources";
import { Destinations, TablePage } from "./console/Warehouse";
import { Builder } from "./console/Builder";
import { Audit, Members, Settings } from "./console/Admin";
import { SessionProvider } from "./lib/session";

function Console({ children }: { children: JSX.Element }): JSX.Element {
  return <ConsoleShell>{children}</ConsoleShell>;
}

export function App(): JSX.Element {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/connector-builder" element={<ConnectorBuilderPage />} />
        <Route path="/data-replication" element={<DataReplicationPage />} />
        <Route path="/hybrid" element={<HybridPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/context-layer" element={<ContextLayerPage />} />
        <Route path="/why-open-source" element={<WhyOpenSourcePage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/data-engineering-resources" element={<ResourcesPage />} />
        <Route path="/signin" element={<SignInChooser />} />
        <Route path="/login" element={<Login />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/app" element={<Console><Dashboard /></Console>} />
        <Route path="/app/connections/new" element={<Console><Wizard /></Console>} />
        <Route path="/app/connections/:connectionId" element={<Console><ConnectionPage /></Console>} />
        <Route path="/app/sources" element={<Console><Sources /></Console>} />
        <Route path="/app/destinations" element={<Console><Destinations /></Console>} />
        <Route
          path="/app/destinations/:destinationId/tables/:table"
          element={<Console><TablePage /></Console>}
        />
        <Route path="/app/builder" element={<Console><Builder /></Console>} />
        <Route path="/app/members" element={<Console><Members /></Console>} />
        <Route path="/app/audit" element={<Console><Audit /></Console>} />
        <Route path="/app/settings" element={<Console><Settings /></Console>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SessionProvider>
  );
}
