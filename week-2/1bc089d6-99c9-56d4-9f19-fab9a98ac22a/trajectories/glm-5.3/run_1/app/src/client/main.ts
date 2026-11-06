// One bundle, one path: each page runs its own boot.
import { bootStory } from './story.js';
import { bootManage } from './manage.js';
import { bootSignin } from './signin.js';
import { bootPartner } from './partner.js';

const path = window.location.pathname;

if (path === '/' || path === '') {
  bootStory();
} else if (path === '/manage') {
  bootManage();
} else if (path === '/signin') {
  bootSignin();
} else if (path.startsWith('/p/')) {
  bootPartner();
}
