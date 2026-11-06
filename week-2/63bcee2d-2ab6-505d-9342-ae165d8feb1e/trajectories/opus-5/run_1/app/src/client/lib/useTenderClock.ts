/**
 * The open Tender and Shop drawings screens refresh at least once a minute, and
 * a tender also refreshes at its close instant.
 */

import { useEffect } from 'react';

const MINUTE = 60_000;

export function useTenderClock(closesAt: string | null, onTick: () => void): void {
  useEffect(() => {
    const interval = window.setInterval(onTick, MINUTE);
    let atClose = 0;
    if (closesAt !== null) {
      const delay = new Date(closesAt).getTime() - Date.now();
      if (delay > 0) atClose = window.setTimeout(onTick, delay + 50);
    }
    return () => {
      window.clearInterval(interval);
      if (atClose !== 0) window.clearTimeout(atClose);
    };
  }, [closesAt, onTick]);
}

export function useMinuteClock(onTick: () => void): void {
  useEffect(() => {
    const interval = window.setInterval(onTick, MINUTE);
    return () => window.clearInterval(interval);
  }, [onTick]);
}
