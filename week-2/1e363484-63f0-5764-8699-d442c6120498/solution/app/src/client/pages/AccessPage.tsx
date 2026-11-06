import { useEffect, useState } from "react";
import { request } from "../api";
import { COPY, grantSaved } from "../copy";
import { useAnnouncer } from "../hooks";
import type { Person, ProjectRole } from "../types";

interface AccessData {
  people: Person[];
  projects: { slug: string; name: string }[];
  grants: { person_id: string; project: string; role: ProjectRole }[];
}

const OPTIONS: { value: ProjectRole | ""; label: string }[] = [
  { value: "", label: "No access" }, { value: "viewer", label: "Viewer" }, { value: "analyst", label: "Analyst" }, { value: "sealer", label: "Sealer" },
];

export function AccessPage() {
  const [data, setData] = useState<AccessData | null>(null);
  const [failed, setFailed] = useState(false);
  const { region, announce } = useAnnouncer();

  useEffect(() => {
    void request<AccessData>("GET", "/api/access").then((r) => r.status === 200 && setData(r.data));
  }, []);

  const roleOf = (personId: string, slug: string) => data?.grants.find((g) => g.person_id === personId && g.project === slug)?.role ?? "";

  const change = async (person: Person, project: { slug: string; name: string }, value: ProjectRole | "") => {
    const previous = data!.grants;
    const others = previous.filter((g) => !(g.person_id === person.id && g.project === project.slug));
    setData({ ...data!, grants: value ? [...others, { person_id: person.id, project: project.slug, role: value }] : others });
    const path = `/api/projects/${project.slug}/grants/${person.id}`;
    const r = await request(value ? "PUT" : "DELETE", path, value ? { role: value } : undefined).catch(() => null);
    if (r && (r.status === 200 || r.status === 204)) {
      setFailed(false);
      announce(grantSaved(person.name, project.name, OPTIONS.find((o) => o.value === value)!.label));
    } else {
      setData((current) => (current ? { ...current, grants: previous } : current));
      setFailed(true);
    }
  };

  return (
    <main className="page page-wide">
      <header className="page-header">
        <h1>Access</h1>
        <div role="status" aria-label="Access status" className="status-line num" ref={region} />
      </header>
      {failed && <p role="alert" className="alert">{COPY.grantFailed}</p>}
      {data === null ? (
        <p className="loading num">Loading…</p>
      ) : (
        <div className="table-frame access-frame">
          <table role="table" aria-label="Access" className="data-table access-table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Person</th>
                {data.projects.map((p) => <th role="columnheader" scope="col" key={p.slug}>{p.name}</th>)}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data.people.map((person) => (
                <tr role="row" key={person.id}>
                  <th role="rowheader" scope="row" className="person-cell">
                    <span className="person-name">{person.name}</span>
                    <span className="person-meta">{person.email} · {person.org_role}</span>
                  </th>
                  {data.projects.map((project) => (
                    <td role="cell" key={project.slug} data-label={project.name}>
                      <select
                        className="role-picker"
                        aria-label={`${person.name} on ${project.name}`}
                        value={roleOf(person.id, project.slug)}
                        onChange={(e) => void change(person, project, e.target.value as ProjectRole | "")}
                      >
                        {OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
