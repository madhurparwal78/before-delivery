import type { User } from '../../shared/wire.js';
import { createStore } from './store.js';

const boot = JSON.parse(document.getElementById('boot')?.textContent ?? '{"user":null}') as { user: User | null };

/** The signed-in user, from the page's boot payload until the person signs in or out. */
export const userStore = createStore<User | null>(boot.user);
