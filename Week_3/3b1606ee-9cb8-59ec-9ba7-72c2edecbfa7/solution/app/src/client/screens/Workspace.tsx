import { useEffect } from 'react';
import { useSize } from '../lib/hooks';
import { navigate, type Route } from '../store/router';
import { useStore } from '../store/state';
import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';
import { ConversationScreen } from './ConversationScreen';
import { ChatsList, ContactsList, RequestsList } from './Lists';
import { SettingsScreen } from './Settings';

function TabBar({ route }: { route: Route }) {
  const unread = useStore((state) => Object.values(state.conversations).reduce((sum, conversation) => sum + (conversation.status === 'accepted' ? conversation.unread : 0), 0));
  const current = (name: string): 'page' | undefined => (route.name === name || (name === 'letters' && (route.name === 'conversation' || route.name === 'requests')) ? 'page' : undefined);
  return (
    <nav className="tabbar" aria-label="Main">
      <Link to="/letters" aria-current={current('letters')}>
        Chats
        {unread > 0 && (
          <span className="badge" data-testid="tab-unread-badge">
            {unread}
          </span>
        )}
      </Link>
      <Link to="/contacts" aria-current={current('contacts')}>
        Contacts
      </Link>
      <Link to="/settings" aria-current={current('settings')}>
        Settings
      </Link>
    </nav>
  );
}

function ListColumn({ route }: { route: Route }) {
  switch (route.name) {
    case 'requests':
      return <RequestsList />;
    case 'contacts':
      return <ContactsList />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <ChatsList />;
  }
}

/** The signed-in app: one pane under 768 px, two from 768, three from 1200. */
export function Workspace({ route }: { route: Route }) {
  const size = useSize();
  const open = route.name === 'conversation';
  useEffect(() => {
    if (route.name === 'unknown') navigate('/letters', true);
  }, [route.name]);
  if (route.name === 'unknown') return null;
  return (
    <>
      <div className={`workspace workspace--${size}${open ? ' workspace--open' : ''}`}>
        {(size !== 'phone' || !open) && (
          <section className="column column--list">
            {size !== 'phone' && <TabBar route={route} />}
            <ListColumn route={route} />
          </section>
        )}
        {open && <ConversationScreen key={route.id} id={route.id} />}
        {!open && size !== 'phone' && (
          <div className="pane pane--conversation">
            <Sheet className="sheet--conversation sheet--blank">
              <p className="blank-note">Choose a letter to read, or find someone by their exact username.</p>
            </Sheet>
          </div>
        )}
      </div>
      {size === 'phone' && <TabBar route={route} />}
    </>
  );
}
