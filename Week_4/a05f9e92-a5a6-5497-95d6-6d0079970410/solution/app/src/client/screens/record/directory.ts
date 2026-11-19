import { useEffect, useState } from "react";
import type { ReferenceTarget } from "../../../shared/fields.js";
import { get } from "../../lib/api.js";
import type { Choice } from "./Combobox.js";

interface UserRow {
  username: string;
  display_name: string;
  active: boolean;
}

type Directories = Partial<Record<ReferenceTarget, Choice[]>>;

/**
 * The choices of the reference fields a person may read: users and groups for the desk roles, items for the desk roles
 * and managers. A target the role may not read stays absent, and its field is a plain text input.
 */
export function useDirectories(wanted: ReferenceTarget[], desk: boolean, manager: boolean): Directories {
  const [found, setFound] = useState<Directories>({});
  const key = wanted.join("|");
  useEffect(() => {
    let current = true;
    const keep = (target: ReferenceTarget) => (choices: Choice[]) => {
      if (current) setFound((previous) => ({ ...previous, [target]: choices }));
    };
    const ignore = (): void => undefined;
    if (wanted.includes("user") && desk) {
      void get<{ users: UserRow[] }>("/api/users").then((r) => keep("user")(r.users.filter((u) => u.active).map((u) => ({ value: u.username, label: u.display_name }))), ignore);
    }
    if (wanted.includes("ci") && (desk || manager)) {
      void get<{ cis: Array<{ name: string }> }>("/api/cis").then((r) => keep("ci")(r.cis.map((c) => ({ value: c.name, label: c.name }))), ignore);
    }
    if (wanted.includes("group") && desk) {
      void get<{ groups: Array<{ name: string }> }>("/api/groups").then((r) => keep("group")(r.groups.map((g) => ({ value: g.name, label: g.name }))), ignore);
    }
    return () => {
      current = false;
    };
  }, [key, desk, manager]);
  return found;
}

/** The names of the business-critical items, which bump the priority of a record that names one. */
export function useCriticalItems(enabled: boolean): ReadonlySet<string> {
  const [names, setNames] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    get<{ cis: Array<{ name: string; business_critical: boolean }> }>("/api/cis").then(
      (r) => current && setNames(new Set(r.cis.filter((c) => c.business_critical).map((c) => c.name))),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [enabled]);
  return names;
}
