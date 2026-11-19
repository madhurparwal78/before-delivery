import { useCallback, useEffect, useState } from "react";
import { get } from "../lib/api.ts";
import type { ChapterData } from "./Tiles.tsx";

/** Chapter versions and rule counts for the tile lines; `reload` refetches after a live chapter change. */
export function useChapters(): { data: ChapterData | null; reload: () => void } {
  const [data, setData] = useState<ChapterData | null>(null);
  const reload = useCallback(() => void get<ChapterData>("/api/chapters").then(setData), []);
  useEffect(reload, [reload]);
  return { data, reload };
}
