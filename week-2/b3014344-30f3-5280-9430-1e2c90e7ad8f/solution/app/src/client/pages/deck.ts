import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { EntrySummary } from "../../shared/domain";

// The published case studies, kept between visits so returning to the deck shows it at once.

let cache: EntrySummary[] | null = null;

export function useDeck(): { entries: EntrySummary[] | null; failed: boolean } {
  const [entries, setEntries] = useState(cache);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ entries: EntrySummary[] }>("/api/case-studies")
      .then((body) => {
        cache = body.entries;
        if (live) {
          setEntries(body.entries);
          setFailed(false);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return { entries, failed };
}
