import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import MarketingLayout from "./components/MarketingLayout.jsx";
import { useReveal } from "./components/Reveal.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";
import Connectors from "./pages/Connectors.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import {
  ComparePage, ConnectorBuilderPage, ContextLayerPage, DataReplicationPage, HybridPage, McpPage, ResourcesPage,
  WhyOpenSourcePage,
} from "./pages/MarketingPages.jsx";
import NotFound from "./pages/NotFound.jsx";
import Pricing from "./pages/Pricing.jsx";
import Signin from "./pages/Signin.jsx";
import "./styles/base.css";
import "./styles/marketing.css";
import "./styles/console.css";

const Console = lazy(() => import("./console/Console.jsx"));

export default function App() {
  useReveal();
  return (
    <Routes>
      <Route element={<MarketingLayout />}>
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
        <Route path="/signin" element={<Signin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/app/*" element={<Suspense fallback={null}><Console /></Suspense>} />
    </Routes>
  );
}
