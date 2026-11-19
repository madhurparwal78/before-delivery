import { useApp } from '../app-context.js';
import { useEffect, useState } from 'react';

const countSuffix = (n: number, singular: string): string =>
  n === 0 ? '' : `, ${n} ${singular}${n === 1 ? '' : 's'}`;

export const Header = (): JSX.Element => {
  const { me, navigate, unreadCounts, route } = useApp();
  const [phone, setPhone] = useState(false);
  const [searchText, setSearchText] = useState(route.params.q ?? '');

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = (): void => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (route.path.startsWith('/search')) setSearchText(route.params.q ?? '');
  }, [route]);

  const onSearch = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      navigate(`/search?type=people&q=${encodeURIComponent(searchText)}`);
    }
  };

  const go = (path: string): React.MouseEventHandler => (e) => {
    e.preventDefault();
    navigate(path);
  };

  const networkName = phone
    ? `Network${countSuffix(unreadCounts.invitations, 'invitation')}`
    : `My network${countSuffix(unreadCounts.invitations, 'invitation')}`;
  const messagingName = `Messaging${countSuffix(unreadCounts.messages, 'unread')}`;
  const notificationsName = `Notifications${countSuffix(unreadCounts.notifications, 'unread')}`;

  return (
    <>
      <header className="app-header">
        <a href="/" className="monogram" aria-label="Plainwork" onClick={go('/')}>Pw</a>
        <div className="header-search">
          <input
            type="search"
            className="field"
            aria-label="Search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={onSearch}
          />
        </div>
        <nav className="primary-nav" aria-label="Primary">
          <a href="/feed" onClick={go('/feed')}>Home</a>
          <a href="/network" onClick={go('/network')}>{networkName}</a>
          <a href="/jobs" onClick={go('/jobs')}>Jobs</a>
          <a href="/messaging" onClick={go('/messaging')}>{messagingName}</a>
          <a href="/notifications" onClick={go('/notifications')}>{notificationsName}</a>
          <a href={me ? `/in/${me.handle}` : '/feed'} onClick={go(me ? `/in/${me.handle}` : '/feed')}>Me</a>
        </nav>
        {phone && (
          <nav aria-label="Header actions" className="primary-nav">
            <a href="/notifications" onClick={go('/notifications')}>Notifications</a>
            <a href={me ? `/in/${me.handle}` : '/feed'} onClick={go(me ? `/in/${me.handle}` : '/feed')}>Me</a>
          </nav>
        )}
      </header>
      {phone && (
        <div className="tab-bar">
          <nav aria-label="Tabs">
            <a href="/feed" onClick={go('/feed')}>Home</a>
            <a href="/network" onClick={go('/network')}>Network{countSuffix(unreadCounts.invitations, 'invitation')}</a>
            <a href="/feed#compose" onClick={go('/feed#compose')}>Post</a>
            <a href="/messaging" onClick={go('/messaging')}>Messaging{countSuffix(unreadCounts.messages, 'unread')}</a>
            <a href="/jobs" onClick={go('/jobs')}>Jobs</a>
          </nav>
        </div>
      )}
    </>
  );
};
