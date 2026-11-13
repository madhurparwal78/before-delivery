import { useSyncExternalStore } from "react";

type Layout = "phone" | "tablet" | "desktop";

const queries = { phone: matchMedia("(max-width: 767px)"), tablet: matchMedia("(min-width: 768px) and (max-width: 1279px)") };

function subscribe(listener: () => void): () => void {
  for (const query of Object.values(queries)) query.addEventListener("change", listener);
  return () => {
    for (const query of Object.values(queries)) query.removeEventListener("change", listener);
  };
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, () => (queries.phone.matches ? "phone" : queries.tablet.matches ? "tablet" : "desktop"));
}
