import { useSettling } from "../lib/settling";
import { Doodle } from "./Doodle";
import { ExportsList } from "./ExportsList";
import { LaunchPills } from "./LaunchPills";
import { ProjectCards } from "./ProjectCards";
import { useLibrary } from "./useLibrary";
import "./projects.css";

/** The launch pills, `My projects` and `My exports` that the Educator, Student and Personal homes share. */
export function ProjectLibrary({ zone }: { zone?: string }) {
  const { projects, exports } = useLibrary();
  useSettling(projects === null || exports === null);
  return (
    <>
      {projects === null ? null : (
        <section className="home-section" aria-labelledby="start-heading">
          <h2 id="start-heading">Start building</h2>
          {/* An empty library moves its primary action, `New 3D design`, into the empty state (one pill there). */}
          <LaunchPills kinds={projects.length > 0 ? undefined : ["circuit", "blocks"]} />
        </section>
      )}
      <section className="home-section" aria-labelledby="projects-heading">
        <h2 id="projects-heading">My projects</h2>
        {projects === null ? null : projects.length > 0 ? (
          <ProjectCards projects={projects} zone={zone} />
        ) : (
          <div className="empty-state">
            <Doodle />
            <p>No projects yet. Pick an editor and start something you can hold.</p>
            <LaunchPills centered kinds={["3d"]} />
          </div>
        )}
      </section>
      <section className="home-section" aria-labelledby="exports-heading">
        <h2 id="exports-heading">My exports</h2>
        {exports === null ? null : exports.length > 0 ? (
          <ExportsList exports={exports} zone={zone} />
        ) : (
          <p className="hint">Files you export from an editor are kept here for download.</p>
        )}
      </section>
    </>
  );
}
