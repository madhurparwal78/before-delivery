// Browser entry: registers every page, then renders the router inside the page kind's layout.

import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterView, type PageDef } from "./router.js";
import { AccountLayout, PublicLayout } from "./layouts.js";
import { WorkspaceGuard } from "./workspace/shell.js";
import { loadMember } from "./session.js";
import { Heading } from "./ui/heading.js";
import "./pages/boards.js";
import "./pages/profile.js";
import "./pages/tray.js";
import "./pages/cast-request.js";
import "./pages/package.js";
import "./pages/apply.js";
import "./pages/consent.js";
import "./pages/account.js";
import "./pages/workspace/index.js";

function layout(page: PageDef, content: ReactNode) {
  if (page.kind === "workspace") return <WorkspaceGuard roles={page.roles}>{content}</WorkspaceGuard>;
  if (page.kind === "account") return <AccountLayout>{content}</AccountLayout>;
  return <PublicLayout>{content}</PublicLayout>;
}

function NotFound() {
  return (
    <PublicLayout>
      <section className="panel">
        <Heading lines={["Page not found"]} />
        <p className="muted">That address is not part of Vesper &amp; Rowe Talent. The boards are a good place to start.</p>
      </section>
    </PublicLayout>
  );
}

void loadMember();
const root = document.getElementById("root");
if (root) createRoot(root).render(<RouterView layout={layout} notFound={() => <NotFound />} />);
