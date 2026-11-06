import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

// Who opened the cart drawer, so closing it returns focus there.

interface Drawer {
  open: boolean;
  show: (opener: HTMLElement | null) => void;
  hide: () => void;
  opener: React.RefObject<HTMLElement | null>;
}

const DrawerContext = createContext<Drawer | null>(null);

export function useDrawer(): Drawer {
  const drawer = useContext(DrawerContext);
  if (!drawer) throw new Error("useDrawer outside DrawerProvider");
  return drawer;
}

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((from: HTMLElement | null) => {
    opener.current = from;
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, show, hide, opener }), [open, show, hide]);
  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}
