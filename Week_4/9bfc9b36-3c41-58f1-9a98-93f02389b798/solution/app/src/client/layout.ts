import { useEffect, useState } from "react";

type Layout = "desktop" | "tablet" | "phone";

/** Exactly three layouts, decided by the viewport width alone: 1024 and wider, 600 to 1023, 599 and narrower. */
function current(): Layout {
  if (window.matchMedia("(min-width: 1024px)").matches) return "desktop";
  return window.matchMedia("(min-width: 600px)").matches ? "tablet" : "phone";
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const queries = [window.matchMedia("(min-width: 1024px)"), window.matchMedia("(min-width: 600px)")];
    const update = () => setLayout(current());
    for (const query of queries) query.addEventListener("change", update);
    update();
    return () => {
      for (const query of queries) query.removeEventListener("change", update);
    };
  }, []);
  return layout;
}
