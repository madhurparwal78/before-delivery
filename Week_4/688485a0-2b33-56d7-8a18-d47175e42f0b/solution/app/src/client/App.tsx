import { type ReactNode } from "react";
import { Page, RequireSession } from "./components/Page.js";
import { Confirm, SignIn, SignUp } from "./screens/Account.js";
import { Indexes } from "./screens/Indexes.js";
import { Invites } from "./screens/Invites.js";
import { Landing } from "./screens/Landing.js";
import { Members } from "./screens/Members.js";
import { NotFound } from "./screens/NotFound.js";
import { ProjectHome } from "./screens/ProjectHome.js";
import { Projects } from "./screens/Projects.js";
import { Rules } from "./screens/Rules.js";
import { SavedQueries } from "./screens/SavedQueries.js";
import { Schema } from "./screens/Schema.js";
import { Workspace } from "./screens/Workspace.js";
import { type Route, parseRoute, useLocation } from "./router.js";
import { ProjectShell } from "./shell/ProjectShell.js";

function CollectionScreen({ route }: { route: Extract<Route, { name: "collection" }> }): ReactNode {
  switch (route.section) {
    case "documents":
    case "pipeline":
      return <Workspace route={route} />;
    case "queries":
      return <SavedQueries />;
    case "indexes":
      return <Indexes />;
    case "schema":
      return <Schema />;
    case "rules":
      return <Rules />;
  }
}

export function App(): ReactNode {
  const { path } = useLocation();
  const route = parseRoute(path);
  switch (route.name) {
    case "landing":
      return <Landing />;
    case "signup":
      return <SignUp />;
    case "confirm":
      return <Confirm />;
    case "signin":
      return <SignIn />;
    case "projects":
      return (
        <RequireSession path={path}>
          <Projects />
        </RequireSession>
      );
    case "invites":
      return (
        <RequireSession path={path}>
          <Page>
            <Invites />
          </Page>
        </RequireSession>
      );
    case "notfound":
      return <NotFound />;
    case "project":
    case "members":
    case "collection":
      return (
        <RequireSession path={path}>
          <ProjectRoutes route={route} />
        </RequireSession>
      );
  }
}

function ProjectRoutes({ route }: { route: Extract<Route, { name: "project" | "members" | "collection" }> }): ReactNode {
  return (
    <ProjectShell key={route.pid} route={route}>
      {(shell) => {
        if (route.name === "project") return <ProjectHome />;
        if (route.name === "members") return <Members />;
        return shell.collection ? <CollectionScreen key={route.cid} route={route} /> : <div className="skeleton-block" aria-busy="true" style={{ minHeight: 240 }} />;
      }}
    </ProjectShell>
  );
}
