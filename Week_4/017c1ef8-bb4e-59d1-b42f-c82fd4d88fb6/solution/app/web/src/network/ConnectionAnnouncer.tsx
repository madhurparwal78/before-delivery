import { useLocation } from 'react-router-dom';
import { announce } from '../announce';
import { useLive } from '../live';

/**
 * Announces a connection made by the other member on any page except that member's profile, which announces
 * it itself with the degree.
 */
export function ConnectionAnnouncer() {
  const { pathname } = useLocation();
  useLive('connected', (event) => {
    const { member } = event;
    if (pathname !== `/in/${member.handle}`) announce('Network announcements', `You are now connected with ${member.name}.`);
  });
  return null;
}
