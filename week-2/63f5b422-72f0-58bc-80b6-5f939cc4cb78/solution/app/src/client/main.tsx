import { createRoot } from "react-dom/client";
import { FONT_FACE_CSS, nodeCss } from "../shared/nodecss.js";
import { AuthPage } from "./auth/AuthPage.js";
import { Editor } from "./editor/Editor.js";
import { WorkspaceList } from "./home/WorkspaceList.js";
import "./styles.css";

const style = document.createElement("style");
style.textContent = `${FONT_FACE_CSS}\n${nodeCss(".pl-surface")}`;
document.head.append(style);

function route() {
  const path = location.pathname;
  if (path === "/signup") return <AuthPage mode="signup" />;
  if (path === "/signin") return <AuthPage mode="signin" />;
  const editor = /^\/w\/([^/]+)\/edit$/.exec(path);
  if (editor) return <Editor workspaceId={decodeURIComponent(editor[1])} />;
  return <WorkspaceList />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(route());
