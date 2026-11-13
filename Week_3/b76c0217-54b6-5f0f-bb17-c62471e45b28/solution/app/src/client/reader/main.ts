import type { ReaderBoot } from '../../shared/types';
import { must } from '../shared/dom';
import { initChrome } from './chrome';
import { enhanceContent, initDelegates } from './components';
import { initFeedback } from './feedback';
import { initSearch } from './search';

const boot = JSON.parse(must<HTMLElement>('#reader-boot').textContent ?? '{}') as ReaderBoot;

initChrome(boot);
initDelegates();
enhanceContent(document, boot);
initSearch(boot);
initFeedback(boot);
