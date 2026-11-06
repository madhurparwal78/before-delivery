import { useCallback, useEffect, useState } from 'react';
import { api, hasStatus, type AccessData, type ProjectRole } from '../api';
import { COPY, ROLE_LABELS } from '../copy';
import { navigate } from '../router';

type Choice = 'none' | ProjectRole;

export function AccessPage(): React.ReactElement {
  const [data, setData] = useState<AccessData | null>(null);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.access());
    } catch (error) {
      if (hasStatus(error, 401)) navigate('/signin');
      else navigate('/projects');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (data === null) {
    return (
      <div className="app-shell">
        <p>Loading access.</p>
      </div>
    );
  }

  const roleOf = (personId: string, slug: string): Choice =>
    data.grants.find((grant) => grant.person_id === personId && grant.project === slug)?.role ??
    'none';

  const change = async (
    personId: string,
    personName: string,
    slug: string,
    projectName: string,
    choice: Choice,
  ): Promise<void> => {
    setFailed(false);
    try {
      if (choice === 'none') await api.removeGrant(slug, personId);
      else await api.setGrant(slug, personId, choice);
      await load();
      setStatus(COPY.grantSaved(personName, projectName, ROLE_LABELS[choice]));
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="app-shell">
      <h1>Access</h1>
      <div role="status" aria-live="polite" aria-label="Access status" className="status-line">
        {status}
      </div>
      {failed ? (
        <div role="alert" className="alert">
          {COPY.grantFailed}
        </div>
      ) : null}
      <div className="access-grid">
        <table aria-label="Access">
          <caption>Access</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              {data.projects.map((project) => (
                <th scope="col" key={project.slug}>
                  {project.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.people.map((person) => (
              <tr key={person.id}>
                <th scope="row">
                  {person.name}
                  <br />
                  <span style={{ fontWeight: 400, textTransform: 'none' }}>{person.org_role}</span>
                </th>
                {data.projects.map((project) => (
                  <td key={project.slug}>
                    <select
                      aria-label={`${person.name} on ${project.name}`}
                      value={roleOf(person.id, project.slug)}
                      onChange={(event) =>
                        void change(
                          person.id,
                          person.name,
                          project.slug,
                          project.name,
                          event.target.value as Choice,
                        )
                      }
                    >
                      <option value="none">{ROLE_LABELS.none}</option>
                      <option value="viewer">{ROLE_LABELS.viewer}</option>
                      <option value="analyst">{ROLE_LABELS.analyst}</option>
                      <option value="sealer">{ROLE_LABELS.sealer}</option>
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
