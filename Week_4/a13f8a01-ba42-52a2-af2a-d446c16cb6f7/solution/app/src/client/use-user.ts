import { useEffect } from "react";
import type { User } from "../shared/types.js";
import { useAccount } from "./account.js";
import { navigate } from "./router.js";

/** The signed-in user, or null while the session is being read or after sending a visitor to sign in. */
export function useRequireUser(): User | null {
  const { ready, user } = useAccount();
  useEffect(() => {
    if (ready && user === null) navigate("/signin", { replace: true });
  }, [ready, user]);
  return user;
}
