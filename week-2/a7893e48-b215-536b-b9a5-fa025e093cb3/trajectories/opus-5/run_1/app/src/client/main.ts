import { registerScreen, start } from './app.js';
import { boardScreen } from './screens/board.js';
import { counterScreen } from './screens/counter.js';
import { documentsScreen } from './screens/documents.js';
import { manageScreen } from './screens/manage.js';
import { packScreen } from './screens/pack.js';
import { signInScreen } from './screens/signin.js';
import { ticketsScreen } from './screens/tickets.js';

registerScreen('/', signInScreen);
registerScreen('/board', boardScreen);
registerScreen('/tickets', ticketsScreen);
registerScreen('/pack', packScreen);
registerScreen('/documents', documentsScreen);
registerScreen('/counter', counterScreen);
registerScreen('/manage', manageScreen);

void start();
