import { render } from 'preact';
import type { EditorBoot } from '../../shared/types';
import { Analytics } from './Analytics';
import { Editor } from './Editor';
import { Invite, SignIn } from './Entry';
import { Home } from './Home';
import { Redirects } from './Redirects';
import { Team } from './Team';

const boot = JSON.parse(document.getElementById('boot')?.textContent ?? '{}') as EditorBoot;

const mount = document.getElementById('root') as HTMLElement;

switch (boot.route) {
  case 'signin':
    render(<SignIn next={boot.next} />, mount);
    break;
  case 'invite':
    render(<Invite invite={boot.invite} />, mount);
    break;
  case 'home':
    render(<Home boot={boot} />, mount);
    break;
  case 'team':
    render(<Team boot={boot} />, mount);
    break;
  case 'analytics':
    render(<Analytics boot={boot} />, mount);
    break;
  case 'editor':
    render(<Editor boot={boot} />, mount);
    break;
  case 'redirects':
    render(<Redirects boot={boot} />, mount);
    break;
}
