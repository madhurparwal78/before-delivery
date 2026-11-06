import { useCallback, useEffect, useState } from 'react';
import { api, hasStatus, type ProjectListEntry } from '../api';
import { signedTonnes } from '../format';
import { useRefresh } from '../hooks';
import { takeNotice } from '../notice';
import { Link, navigate } from '../router';

export function Projects(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [notice] = useState<string | null>(() => takeNotice());

  const load = useCallback(() => {
    void api
      .projects()
      .then((result) => setProjects(result.projects))
      .catch((error: unknown) => {
        if (hasStatus(error, 401)) navigate('/signin');
      });
  }, []);

  useEffect(load, [load]);
  useRefresh(load, false);

  return (
    <div className="app-shell">
      <h1>Projects</h1>
      {notice === null ? null : (
        <div role="alert" className="alert">
          {notice}
        </div>
      )}
      <table aria-label="Projects" className="stacked">
        <caption>Projects</caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Kind</th>
            <th scope="col">Sealed net tCO2e</th>
            <th scope="col">Buffer tCO2e</th>
            <th scope="col">Intact</th>
            <th scope="col">Broken</th>
            <th scope="col">Superseded</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.slug}>
              <td data-label="Project">
                <Link to={`/projects/${project.slug}`}>{project.name}</Link>
              </td>
              <td data-label="Kind">{project.kind}</td>
              <td data-label="Sealed net tCO2e" className="num">
                {signedTonnes(project.summary.sealed_net_tco2e)}
              </td>
              <td data-label="Buffer tCO2e" className="num">
                {project.summary.buffer_tco2e}
              </td>
              <td data-label="Intact" className="num">
                {project.summary.intact_count}
              </td>
              <td data-label="Broken" className="num">
                {project.summary.broken_count}
              </td>
              <td data-label="Superseded" className="num">
                {project.summary.superseded_count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
