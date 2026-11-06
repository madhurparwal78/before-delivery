import { createContext, useContext } from 'react';

const DeskContext = createContext(null);

/** The shell and page data the server drew the route with, read the same way on both sides. */
export function DeskProvider({ value, children }) {
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useShell() {
  return useContext(DeskContext).shell;
}

export function usePage() {
  return useContext(DeskContext).page;
}
