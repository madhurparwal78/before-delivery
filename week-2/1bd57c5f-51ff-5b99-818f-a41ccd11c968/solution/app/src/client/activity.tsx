import { createContext, useContext } from "react";

/** Announces an async result in `status "Activity"`, replacing the previous message. */
export const AnnounceContext = createContext<(message: string) => void>(() => undefined);

/** Clears a field-error announcement once its form is gone, so no stale error outlives its fields. */
export const RetractErrorContext = createContext<() => void>(() => undefined);

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext);
}

export function useRetractError(): () => void {
  return useContext(RetractErrorContext);
}
