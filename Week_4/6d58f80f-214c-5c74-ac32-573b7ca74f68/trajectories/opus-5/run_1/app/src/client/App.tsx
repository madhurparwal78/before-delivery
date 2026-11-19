import { useEffect, useState } from 'react';
import type { Person } from '../shared/types.js';
import { api } from './lib/api.js';
import { navigate, readAddress, writeAddress } from './lib/address.js';
import { useAddress } from './lib/hooks.js';
import { connectEvents, disconnectEvents } from './lib/events.js';
import { setState, useGlobal } from './lib/store.js';
import { SignIn } from './screens/SignIn.js';
import { Workspace } from './Workspace.js';

export const App = (): JSX.Element | null => {
  const address = useAddress();
  const person = useGlobal((state) => state.person);
  const booted = useGlobal((state) => state.booted);
  const [wanted, setWanted] = useState<string | null>(null);

  useEffect(() => {
    const boot = async (): Promise<void> => {
      try {
        const session = await api.session();
        setState({ person: session.person, booted: true });
      } catch {
        setState({ person: null, booted: true });
      }
      try {
        const [status, clock] = await Promise.all([api.status(), api.clock()]);
        setState({ status, clock });
      } catch {
        /* the status banner stays as it is until the next probe */
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (!booted) return;
    if (person === null) {
      if (address.screen !== 'sign-in') {
        setWanted(writeAddress(readAddress()));
        navigate({ ...address, screen: 'sign-in' }, 'replace');
      }
      return;
    }
    connectEvents();
    if (address.screen === 'sign-in') {
      const target = wanted;
      setWanted(null);
      if (target !== null && !target.startsWith('/sign-in')) {
        window.history.replaceState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        navigate(
          {
            screen: person.kind === 'staff' ? 'drive' : 'shared',
            folder: null,
            view: 'list',
            sort: 'name-asc',
            q: '',
          },
          'replace',
        );
      }
    }
  }, [booted, person, address, wanted]);

  if (!booted) return null;
  if (person === null) {
    return (
      <SignIn
        onSignedIn={(signedIn: Person) => {
          setState({ person: signedIn });
        }}
      />
    );
  }
  return (
    <Workspace
      person={person}
      onSignedOut={() => {
        disconnectEvents();
        setState({ person: null, folders: [], storage: null, notices: [], uploads: [] });
        navigate(
          { screen: 'sign-in', folder: null, view: 'list', sort: 'name-asc', q: '' },
          'replace',
        );
      }}
    />
  );
};
