import { ProjectLibrary } from "../projects/ProjectLibrary";
import "./pages.css";

export default function PersonalHome() {
  return (
    <div className="column page-body">
      <h1>Your projects</h1>
      <ProjectLibrary />
    </div>
  );
}
