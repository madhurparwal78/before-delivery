import { useEffect, useState, type ReactNode } from "react";
import type { Project, ProjectDetail } from "../../shared/types";
import { rateOf } from "../../shared/rational";
import { timecode } from "../../shared/timecode";
import { SheetFrame } from "../components/SheetFrame";
import { NewProjectDialog } from "../dialogs/NewProject";
import { api } from "../lib/api";
import { Link } from "../lib/router";
import { refreshProjects, projectsStore, useShell } from "../lib/session";
import { useStore } from "../lib/store";
import { Allowance, Notices, SignOut, useCanOpenLibrary, useDialogState } from "../ui";

/** The band names the first few open projects; the sheet below shows every one. */
const BAND_PROJECTS = 8;

export function ProjectList(): ReactNode {
  const projects = useStore(projectsStore);
  const [details, setDetails] = useState<Record<string, ProjectDetail>>({});
  const [availability, setAvailability] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const dialog = useDialogState();
  const library = useCanOpenLibrary();
  const { socket } = useShell();

  useEffect(() => {
    void api
      .get<{ availability: string }>("/api/profile")
      .then((profile) => setAvailability(profile.availability))
      .catch(() => setAvailability(""));
  }, []);

  useEffect(() => {
    if (!projects) return;
    let alive = true;
    void Promise.all(projects.map((project) => api.get<ProjectDetail>(`/api/projects/${project.id}`))).then((all) => {
      if (alive) setDetails(Object.fromEntries(all.map((detail) => [detail.project.id, detail])));
    });
    return () => {
      alive = false;
    };
  }, [projects]);

  useEffect(() => socket.onMessage((message) => message.type === "role_changed" && void refreshProjects()), [socket]);

  const agencies = [...new Set((projects ?? []).map((project) => project.agency).filter(Boolean))];
  const preview = projects?.find((project) => project.id === hovered);

  if (availability === null) return <div className="boot" aria-busy="true" />;

  return (
    <>
      <header className="band hero-band">
        <div className="hero-brand">
          <Link to="/" className="brand title">
            Gatecut
          </Link>
          <nav aria-label="Main" className="nav">
            <Link to="/">Projects</Link>
            {library ? <Link to="/library">Library</Link> : null}
          </nav>
          <Allowance />
        </div>
        <p className="hero-availability muted">{availability}</p>
        <ul className="hero-projects" aria-label="Open projects">
          {(projects ?? []).slice(0, BAND_PROJECTS).map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`}>{project.title}</Link>
            </li>
          ))}
        </ul>
        <ul className="hero-agencies muted" aria-label="Agencies">
          {agencies.map((agency) => (
            <li key={agency}>{agency}</li>
          ))}
        </ul>
        <div className="hero-actions">
          <Link to="/profile">Profile</Link>
          <SignOut />
          <Link
            to="/"
            className="gold new-project"
            onClick={(event) => {
              event.preventDefault();
              dialog.show(event.currentTarget);
            }}
          >
            New project
          </Link>
        </div>
      </header>
      <Notices />
      <main className="hero-ground">
        <div className="index-preview" data-index-preview="" hidden={!preview}>
          {preview ? <PreviewText project={preview} /> : null}
        </div>
        {projects && projects.length === 0 ? <p className="empty">No projects yet. Start one with New project.</p> : null}
        <section role="region" aria-label="Projects" className={`sheet${hovered ? " dimming" : ""}`}>
          {(projects ?? placeholderRuns()).map((project) => (
            <Run key={project.id} project={project} detail={details[project.id]} hovered={hovered} onHover={setHovered} />
          ))}
        </section>
      </main>
      {dialog.open ? <NewProjectDialog opener={dialog.opener} onClose={dialog.hide} /> : null}
    </>
  );
}

function PreviewText({ project }: { project: Project }): ReactNode {
  const last = project.last_cut ? `Last cut ${timecode(rateOf(project.frame_rate), project.last_cut.total_frames)}` : "No cut yet";
  return (
    <p>
      {project.description} <span className="muted tnum">{last}</span>
    </p>
  );
}

function placeholderRuns(): Project[] {
  return [];
}

interface RunProps {
  project: Project;
  detail: ProjectDetail | undefined;
  hovered: string | null;
  onHover: (id: string | null) => void;
}

function Run({ project, detail, hovered, onHover }: RunProps): ReactNode {
  const markers = project.markers.length ? project.markers : [{ frame: 0, label: "" }];
  const rate = rateOf(project.frame_rate);
  const span = Math.min(markers.length, 4);
  return (
    <div
      role="group"
      aria-labelledby={`run-${project.id}`}
      data-role={project.role}
      className={`run${hovered && hovered !== project.id ? " dim" : ""}`}
      style={{ ["--span" as string]: span }}
      onMouseEnter={() => onHover(project.id)}
      onMouseLeave={() => onHover(null)}
    >
      <p className="run-title">
        <Link to={`/projects/${project.id}`} id={`run-${project.id}`} onFocus={() => onHover(project.id)} onBlur={() => onHover(null)}>
          {project.title}
        </Link>{" "}
        <span className="muted">{project.role}</span>
      </p>
      <div className="run-frames">
        {markers.map((marker) =>
          detail ? (
            <SheetFrame
              key={marker.frame}
              projectId={project.id}
              title={project.title}
              aspect={project.aspect_ratio}
              frame={marker.frame}
              timecode={timecode(rate, marker.frame)}
              rows={detail.rows}
              clips={detail.clips}
              media={detail.media}
            />
          ) : (
            <div key={marker.frame} className="sheet-frame loading" style={{ aspectRatio: `${project.width} / ${project.height}` }} />
          ),
        )}
      </div>
    </div>
  );
}
