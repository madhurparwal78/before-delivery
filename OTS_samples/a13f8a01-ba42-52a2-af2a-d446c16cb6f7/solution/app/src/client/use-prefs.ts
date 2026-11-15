import { useCallback, useState } from "react";

export type LayoutName = "side" | "stacked" | "first";

interface Prefs {
  layout: LayoutName;
  stage: number;
  htmlCss: number;
  cssJs: number;
}

const KEY = "ashlar-layout";
const DEFAULTS: Prefs = { layout: "side", stage: 47, htmlCss: 50, cssJs: 50 };

function read(): Prefs {
  const stored = localStorage.getItem(KEY);
  return stored === null ? DEFAULTS : { ...DEFAULTS, ...(JSON.parse(stored) as Partial<Prefs>) };
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(read);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return [prefs, update];
}
