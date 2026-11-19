/** State shared between the header and the finder: whether the Filters button shows and whether its sheet is open. */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface Chrome {
  readonly filtersButton: boolean;
  readonly setFiltersButton: (shown: boolean) => void;
  readonly sheetOpen: boolean;
  readonly setSheetOpen: (open: boolean) => void;
}

const ChromeContext = createContext<Chrome | null>(null);

export const useChrome = (): Chrome => {
  const value = useContext(ChromeContext);
  if (!value) throw new Error("ChromeProvider is missing");
  return value;
};

export const ChromeProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [filtersButton, setFiltersButton] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const value = useMemo(() => ({ filtersButton, setFiltersButton, sheetOpen, setSheetOpen }), [filtersButton, sheetOpen]);
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
};
