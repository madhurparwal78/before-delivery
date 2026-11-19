// Whether object storage answers, read on load and every three seconds, shared by the controls it pauses.
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./lib/api";
import { useInterval } from "./lib/hooks";

export const PAUSE_COPY = {
  placeOrder: "Placing orders is paused until order documents can be stored.",
  document: "Order documents are unavailable until storage returns.",
  label: "Return labels are paused until storage returns.",
} as const;

export const STORAGE_NOTICE = "Order storage is unreachable. Placing orders, order documents and return labels are paused.";

const StorageContext = createContext(false);

/** True while storage is down. */
export function useStorageDown(): boolean {
  return useContext(StorageContext);
}

export function StorageProvider({ children }: { children: React.ReactNode }) {
  const [down, setDown] = useState(false);
  const read = () => {
    api<{ storage: "up" | "down" }>("GET", "/api/status").then((answer) => setDown(answer.storage === "down"), () => undefined);
  };
  useEffect(read, []);
  useInterval(read, 3000);
  return <StorageContext.Provider value={down}>{children}</StorageContext.Provider>;
}
