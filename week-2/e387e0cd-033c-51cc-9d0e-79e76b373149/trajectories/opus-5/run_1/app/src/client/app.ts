import { fallbackRoute, route, start } from './router';
import { filesScreen, listingScreen, membersScreen, partnerKeysScreen } from './screens/admin';
import { casesScreen } from './screens/cases';
import { caseDetailScreen } from './screens/casedetail';
import {
  counterpartiesScreen,
  counterpartyDetailScreen,
  importScreen,
} from './screens/counterparties';
import { messageDetailScreen, messagesScreen } from './screens/messages';
import { monthDetailScreen, monthsScreen } from './screens/months';
import { publicHome } from './screens/publichome';
import { exchangeScreen, jurisdictionScreen, notFoundScreen } from './screens/publicpages';
import { requestPageScreen } from './screens/requestpage';
import { reviewScreen } from './screens/review';
import { dailyReportScreen, jurisdictionRulesScreen, rulesScreen } from './screens/rules';
import { signInScreen } from './screens/signin';

route('/', publicHome);
route('/sign-in', signInScreen);
route('/jurisdictions/:code', jurisdictionScreen);
route('/exchanges/:listingSlug', exchangeScreen);
route('/r/:token', requestPageScreen);
route('/w/:slug/cases', casesScreen);
route('/w/:slug/cases/:caseId', caseDetailScreen);
route('/w/:slug/review', reviewScreen);
route('/w/:slug/messages', messagesScreen);
route('/w/:slug/messages/:messageId', messageDetailScreen);
route('/w/:slug/counterparties', counterpartiesScreen);
route('/w/:slug/counterparties/import', importScreen);
route('/w/:slug/counterparties/:counterpartyId', counterpartyDetailScreen);
route('/w/:slug/rules', rulesScreen);
route('/w/:slug/rules/:code', jurisdictionRulesScreen);
route('/w/:slug/reports/daily', dailyReportScreen);
route('/w/:slug/months', monthsScreen);
route('/w/:slug/months/:month', monthDetailScreen);
route('/w/:slug/files', filesScreen);
route('/w/:slug/partner-keys', partnerKeysScreen);
route('/w/:slug/members', membersScreen);
route('/w/:slug/listing', listingScreen);
fallbackRoute(notFoundScreen);

const root = document.getElementById('root');
if (root !== null) start(root);
