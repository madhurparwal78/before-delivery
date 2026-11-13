import { Trash2 } from 'lucide-react';
import { counts, layerCount } from '../../../shared/messages';
import type { ProjectSummary } from '../../../shared/types';
import { Link } from '../../router';
import { Cover } from './Cover';

interface ProjectCardProps {
  project: ProjectSummary;
  onTrash: (project: ProjectSummary) => void;
}

export function ProjectCard({ project, onTrash }: ProjectCardProps) {
  const headingId = `project-${project.id}`;
  return (
    <article
      className="project-card"
      aria-labelledby={headingId}
      data-project-id={project.id}
      data-layer-count={project.layerCount}
      data-live-version={project.liveVersion ?? ''}
      data-editor-count={project.editorCount}
      data-viewer-count={project.viewerCount}
    >
      <div className="cover-frame">
        <Cover projectId={project.id} name={project.name} liveVersion={project.liveVersion} />
      </div>
      <div className="card-body">
        <h2 id={headingId}>{project.name}</h2>
        <p className="num">{layerCount(project.layerCount)}</p>
        <p className="num">{project.liveVersion === null ? 'Not published' : `Live version ${project.liveVersion}`}</p>
        <p className="num muted">{counts(project.editorCount, project.viewerCount)}</p>
        <div className="card-actions">
          <Link href={`/projects/${project.id}`} className="btn" aria-label={`Open ${project.name}`}>
            Open
          </Link>
          {project.role === 'Owner' && (
            <button type="button" className="btn btn-quiet icon-only" aria-label={`Move ${project.name} to trash`} onClick={() => onTrash(project)}>
              <Trash2 size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
