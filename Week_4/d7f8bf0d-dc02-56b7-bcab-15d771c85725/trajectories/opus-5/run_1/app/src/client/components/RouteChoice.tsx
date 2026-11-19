import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface RouteChoice {
  destination: string;
  via: string;
  timeLimitMinutes: number;
  setDestination(value: string): void;
  setVia(value: string): void;
  setTimeLimitMinutes(value: number): void;
}

const RouteChoiceContext = createContext<RouteChoice | null>(null);

export function useRouteChoice(): RouteChoice {
  const choice = useContext(RouteChoiceContext);
  if (!choice) throw new Error('The route choice is not mounted');
  return choice;
}

export function RouteChoiceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [destination, setDestination] = useState('');
  const [via, setVia] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(60);
  const value = useMemo<RouteChoice>(
    () => ({
      destination,
      via,
      timeLimitMinutes,
      setDestination,
      setVia,
      setTimeLimitMinutes,
    }),
    [destination, via, timeLimitMinutes],
  );
  return <RouteChoiceContext.Provider value={value}>{children}</RouteChoiceContext.Provider>;
}
