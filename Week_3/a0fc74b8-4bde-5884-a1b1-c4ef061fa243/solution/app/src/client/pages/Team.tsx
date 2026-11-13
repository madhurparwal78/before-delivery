import { useCallback, useEffect, useState } from "react";
import type { Role, TeamJson } from "../../shared/types";
import { ApiFailure, api } from "../lib/api";
import { ROLE_LABEL, useMe } from "../lib/session";

interface Refusal {
  userId: string;
  copy: string;
}

export function Team() {
  const me = useMe();
  const [team, setTeam] = useState<TeamJson | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const load = useCallback(async () => setTeam(await api.get<TeamJson>("/api/team")), []);
  useEffect(() => {
    void load();
  }, [load]);

  // The combobox keeps the chosen role. A refused choice stays on screen beside its alert, like any
  // invalid entry, until the next change or visit shows the stored role again.
  const change = async (userId: string, role: Role) => {
    setRefusal(null);
    setTeam((previous) => (previous ? { ...previous, members: previous.members.map((m) => (m.id === userId ? { ...m, role } : m)) } : previous));
    try {
      await api.patch(`/api/team/members/${userId}`, { role });
      await load();
    } catch (failure) {
      const lastOwner = failure instanceof ApiFailure && failure.body.error === "last_owner";
      setRefusal({ userId, copy: lastOwner ? "A team needs at least one owner." : "Something went wrong. Try again." });
    }
  };

  return (
    <>
      <h1>Team</h1>
      {refusal ? (
        <p role="alert" id="role-error" className="error">
          {refusal.copy}
        </p>
      ) : null}
      <table aria-label="Members" className="table members-table" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">Name</th>
            <th scope="col" role="columnheader">Email</th>
            <th scope="col" role="columnheader">Role</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {(team?.members ?? []).map((member) => (
            <tr key={member.id} role="row">
              <td role="cell">{member.name}</td>
              <td role="cell">{member.email}</td>
              <td role="cell">
                {me.role === "owner" ? (
                  <select
                    aria-label={`Role for ${member.name}`}
                    aria-invalid={refusal?.userId === member.id || undefined}
                    aria-describedby={refusal?.userId === member.id ? "role-error" : undefined}
                    value={member.role}
                    onChange={(e) => void change(member.id, e.target.value as Role)}
                  >
                    {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  ROLE_LABEL[member.role]
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
