import { createRoot } from "react-dom/client";
import { EditorScreen } from "./editor/Editor";
import { LabScreen, ViewProjectScreen, ViewSceneScreen } from "./lab/Lab";
import { NoticesRegion } from "./notices";
import { ActivityScreen, InviteScreen, NotFoundPage, ProjectScreen, SettingsScreen, WorkspaceScreen } from "./pages/screens";
import { Landing } from "./pages/Landing";
import { NewWorkspace, SignIn, SignUp } from "./pages/forms";
import { useRoute } from "./router";
import "./styles.css";

function App(): JSX.Element {
  const route = useRoute();
  let screen: JSX.Element;
  switch (route.name) {
    case "landing":
      screen = <Landing />;
      break;
    case "sign-in":
      screen = <SignIn />;
      break;
    case "sign-up":
      screen = <SignUp />;
      break;
    case "new-workspace":
      screen = <NewWorkspace />;
      break;
    case "workspace":
      screen = <WorkspaceScreen key={route.wid} wid={route.wid} />;
      break;
    case "project":
      screen = <ProjectScreen key={route.pid} wid={route.wid} pid={route.pid} />;
      break;
    case "editor":
      screen = <EditorScreen key={route.sid} wid={route.wid} sid={route.sid} />;
      break;
    case "settings":
      screen = <SettingsScreen key={route.wid} wid={route.wid} />;
      break;
    case "activity":
      screen = <ActivityScreen key={route.wid} wid={route.wid} />;
      break;
    case "invite":
      screen = <InviteScreen key={route.token} token={route.token} />;
      break;
    case "lab":
      screen = <LabScreen key={route.token} token={route.token} />;
      break;
    case "view-project":
      screen = <ViewProjectScreen key={route.token} token={route.token} />;
      break;
    case "view-scene":
      screen = <ViewSceneScreen key={route.sid} token={route.token} sid={route.sid} />;
      break;
    default:
      screen = <NotFoundPage />;
  }
  return (
    <>
      {screen}
      <NoticesRegion />
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
