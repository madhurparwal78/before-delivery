import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "./api";
import { onLive, watch } from "./live";
import type { LiveMessage, Pin } from "../../shared/types";

/** Runs `handler` for every live message, always with the latest closure. */
export function useLive(handler: (message: LiveMessage) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onLive((message) => latest.current(message)), []);
}

let handedOver: Pin | null = null;
/** A card passes the pin it already holds to the exhibit so the print can be carried at once. */
export const handOverPin = (pin: Pin): void => {
  handedOver = pin;
};

export function usePin(id: number): { pin: Pin | null; setPin: (pin: Pin) => void; missing: boolean; reload: () => Promise<void> } {
  const [pin, setPin] = useState<Pin | null>(() => {
    const held = handedOver;
    handedOver = null;
    return held?.id === id ? held : null;
  });
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setPin(await api.get<Pin>(`/api/pins/${id}`));
      setMissing(false);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => watch({ pin: id }), [id]);

  useLive((message) => {
    if (message.type === "counts" && message.pin_id === id) {
      setPin((held) => (held ? { ...held, saves: message.saves, comments: message.comments, reactions: message.reactions } : held));
    }
    if (message.type === "pin_changed" && message.pin_id === id) void reload();
  });
  return { pin, setPin, missing, reload };
}
