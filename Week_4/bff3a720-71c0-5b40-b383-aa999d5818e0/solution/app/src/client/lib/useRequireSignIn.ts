import { useEffect } from "react";
import type { Member } from "../../shared/api";
import { navigate, useLocation } from "./router";
import { useSession } from "./session";

/** The signed-in member, or null while the visitor is sent to sign in (and back afterwards). */
export function useRequireMember(): Member | null {
  const { member } = useSession();
  const { path, search } = useLocation();
  useEffect(() => {
    if (!member) navigate(`/sign-in?next=${encodeURIComponent(path + (search.size ? `?${search}` : ""))}`, true);
  }, [member, path, search]);
  return member;
}
