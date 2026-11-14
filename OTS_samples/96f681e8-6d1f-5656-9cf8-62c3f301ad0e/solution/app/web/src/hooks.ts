import { useEffect, useState } from "react";
import { type Club, call } from "./api";

/** The club's settings in force; read once per page. */
export function useClub(): Club | null {
  const [club, setClub] = useState<Club | null>(null);
  useEffect(() => {
    let live = true;
    call<Club>("/api/club")
      .then((value) => live && setClub(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return club;
}
