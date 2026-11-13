import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useSession } from "../state.tsx";
import type { Position } from "../types.ts";

/**
 * The asset a shock ruler is drawn for. Until the member picks one, it is the first listed asset that has open
 * positions collateralised in it, read once, because that is where the ruler has something to show.
 */
export function useChosenAsset(): [string, (asset: string) => void, boolean] {
  const { market, member } = useSession();
  const [picked, setPicked] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  useEffect(() => {
    if (!member) return;
    api<{ positions: Position[] }>("GET", "/api/positions").then(
      (body) => {
        setFallback(market?.pools.find((p) => body.positions.some((pos) => pos.collateral_asset === p.asset))?.asset ?? null);
        setRead(true);
      },
      () => setRead(true),
    );
  }, [member, market === null]);
  // The third value is false until the first listed asset with positions is known, so a view can wait rather than
  // draw one asset's ruler and then another's.
  return [picked ?? fallback ?? market?.pools[0]?.asset ?? "", setPicked, picked !== null || read];
}
