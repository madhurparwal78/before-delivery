import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface AnnouncerValue {
  readonly message: string;
  readonly announce: (message: string) => void;
}

const AnnouncerContext = createContext<AnnouncerValue | undefined>(undefined);

export function Announcer({ children }: { readonly children: ReactNode }): ReactNode {
  const [message, announce] = useState('');
  const value = useMemo(() => ({ message, announce }), [message]);
  return <AnnouncerContext.Provider value={value}>{children}</AnnouncerContext.Provider>;
}

export function useAnnouncer(): AnnouncerValue {
  const value = useContext(AnnouncerContext);
  if (value === undefined) throw new Error('useAnnouncer needs an Announcer');
  return value;
}
