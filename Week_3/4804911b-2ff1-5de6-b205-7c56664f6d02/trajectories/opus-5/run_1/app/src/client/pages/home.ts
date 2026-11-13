import { failureOf, ok, request } from '../api.js';
import { copy, countsLine, dayReadSentence, newDaySentence, packsFoundSentence, waitMessage, waitTimeSentence } from '../copy.js';
import { announce, focusWithoutScroll, onReducedMotionChange, reducedMotion } from '../dom.js';
import { dayMonthYear, grams, rupees } from '../format.js';
import { LinkKeeper, type LinkState } from '../links.js';
import { PackStage } from '../stage/stage.js';
import type {
  Catalogue,
  NoticeSummary,
  PackFacts,
  SearchAnswer,
  SkuDetail,
} from '../types.js';

const DEFAULT_SKU = 'KP-200-CTN';

const SKELETON = `
<button class="reels-toggle" type="button" aria-expanded="false" data-reels-toggle>Reels</button>
<nav class="reels" aria-label="Reels" data-reels>
  <a href="#now-showing">Now Showing</a>
  <a href="#the-pack">The Pack</a>
  <a href="#the-lineup">The Lineup</a>
  <a href="#price-notices">Price Notices</a>
  <a href="#end-credits">End Credits</a>
</nav>

<div class="day-slip" role="region" aria-label="New day" data-day-slip hidden>
  <p data-day-sentence></p>
  <button type="button" data-day-read>Read today's prices</button>
</div>
<div class="day-status" role="status" aria-label="Day status" data-day-status></div>

<div class="marquee-wrap">
  <div class="marquee" role="marquee" aria-label="Price changes" data-marquee><div class="marquee-track" data-marquee-track></div></div>
  <button class="marquee-toggle" type="button" data-marquee-toggle>Pause price changes</button>
</div>

<section id="now-showing" class="reel hero" role="region" aria-label="Now Showing" data-hero>
  <div class="hero-field">
    <h1 class="shout"><span>COLD DRINK</span> <span>HOUSE FULL</span></h1>
    <div class="arch" data-arch></div>
  </div>
  <div class="hero-band">
    <p class="hero-story">${copy.heroStory}</p>
    <a class="rect-link" href="#the-pack" data-read-your-pack>Read your pack</a>
  </div>
</section>

<section id="the-pack" class="reel pack" role="region" aria-label="The Pack">
  <div class="pack-scroll" data-pack-scroll>
    <div class="pinned" data-pinned>
      <div class="stage" data-stage>
        <canvas role="img" aria-label="Pack stage" aria-describedby="stage-description" data-stage-canvas></canvas>
        <svg role="img" aria-label="Pack declaration panel" aria-describedby="stage-description" data-stage-svg hidden></svg>
      </div>
      <div class="mirror" role="region" aria-label="Pack facts" data-mirror data-mirror-swap="1"></div>
      <div class="turn">
        <label for="turn-slider">Turn the pack</label>
        <input id="turn-slider" type="range" min="0" max="100" step="1" value="0" aria-label="Turn the pack"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Front of the pack" data-turn>
      </div>
      <div class="stills" data-stills hidden>
        <button type="button" data-still="front">Front</button>
        <button type="button" data-still="back">Back</button>
        <button type="button" data-still="sticker">Sticker</button>
      </div>
      <span id="stage-description" class="offscreen" data-stage-description></span>
    </div>
  </div>
  <div class="finder">
    <div class="field">
      <label for="find-a-pack">Find a pack</label>
      <input id="find-a-pack" type="search" role="searchbox" aria-label="Find a pack" maxlength="80" data-search>
    </div>
    <ul class="results" aria-label="Pack results" data-results></ul>
    <div role="status" aria-label="Search status" data-search-status></div>
    <form class="field reader" data-reader>
      <label for="batch-code">Batch code</label>
      <input id="batch-code" type="text" aria-label="Batch code" data-batch-input>
      <button type="submit" data-read-pack>Read pack</button>
    </form>
    <div role="status" aria-label="Pack reader status" data-reader-status></div>
    <div role="timer" aria-label="Wait time" data-wait-timer hidden></div>
  </div>
</section>

<section id="the-lineup" class="reel lineup" role="region" aria-label="The Lineup">
  <h2>The Lineup</h2>
  <div class="lineup-grid">
    <ul class="drinks" aria-label="Drinks" data-drinks></ul>
    <div class="packs" role="radiogroup" aria-label="Packs" data-packs></div>
  </div>
</section>

<section id="price-notices" class="reel notices" role="region" aria-label="Price Notices">
  <h2>Price Notices</h2>
  <div role="status" aria-label="Print status" data-print-status></div>
  <div class="listings" data-listings></div>
  <div class="current-prices" data-current-prices></div>
</section>

<section id="end-credits" class="reel credits" role="region" aria-label="End Credits">
  <p class="counts" data-counts></p>
  <p class="legal">${copy.legalLine}</p>
  <a class="rect-link" href="/sign-in" data-sign-in>Sign in</a>
  <p class="wordmark"><span data-wordmark>VASANT TALKIES</span></p>
</section>
`;

interface HomeState {
  catalogue: Catalogue | null;
  notices: NoticeSummary[];
  skus: Map<string, SkuDetail>;
  drawnDate: string;
  generation: number;
  searchGeneration: number;
  dayGeneration: number;
  selectedDrinkId: string;
  selectedSkuCode: string;
  waitUntil: number | null;
  dayPending: boolean;
}

export function renderHome(root: HTMLElement): void {
  root.innerHTML = SKELETON;
  const pick = <T extends Element>(selector: string): T => root.querySelector(selector) as T;

  const state: HomeState = {
    catalogue: null,
    notices: [],
    skus: new Map(),
    drawnDate: '',
    generation: 0,
    searchGeneration: 0,
    dayGeneration: 0,
    selectedDrinkId: '',
    selectedSkuCode: DEFAULT_SKU,
    waitUntil: null,
    dayPending: false,
  };

  const stageElement = pick<HTMLElement>('[data-stage]');
  const heroElement = pick<HTMLElement>('[data-hero]');
  const archElement = pick<HTMLElement>('[data-arch]');
  const heroCanvas = document.createElement('canvas');
  heroCanvas.className = 'hero-pack';
  heroCanvas.setAttribute('role', 'img');
  heroCanvas.setAttribute('aria-label', 'Pack under the lamp');
  archElement.append(heroCanvas);

  const slider = pick<HTMLInputElement>('[data-turn]');
  const stage = new PackStage({
    stage: stageElement,
    canvas: pick<HTMLCanvasElement>('[data-stage-canvas]'),
    svg: pick<SVGElement>('[data-stage-svg]'),
    scrollContainer: pick<HTMLElement>('[data-pack-scroll]'),
    slider,
    hero: heroElement,
    heroCanvas,
  });

  const readerStatus = pick<HTMLElement>('[data-reader-status]');
  const searchStatus = pick<HTMLElement>('[data-search-status]');
  const dayStatus = pick<HTMLElement>('[data-day-status]');
  const printStatus = pick<HTMLElement>('[data-print-status]');
  const waitTimer = pick<HTMLElement>('[data-wait-timer]');
  const mirror = pick<HTMLElement>('[data-mirror]');
  const resultsList = pick<HTMLUListElement>('[data-results]');
  const searchBox = pick<HTMLInputElement>('[data-search]');
  const batchBox = pick<HTMLInputElement>('[data-batch-input]');
  const readPackButton = pick<HTMLButtonElement>('[data-read-pack]');
  const stageDescription = pick<HTMLElement>('[data-stage-description]');

  setUpReels(root);
  setUpMarquee(root);
  setUpStills(root, stage);
  setUpSlider(slider, stage);

  // ----- mirror -------------------------------------------------------------

  let mirrorSwapTimer: number | null = null;

  function setMirror(facts: PackFacts): void {
    const rows: { term: string; value: string; note: string }[] = [
      { term: 'Batch', value: facts.batchCode, note: 'The code the plant pressed into the carton.' },
      {
        term: 'Printed MRP',
        value: `Rs ${rupees(facts.printedMrpPaise)}`,
        note: 'What the wrapper itself claims, in ink that cannot be argued with.',
      },
      {
        term: 'Revised MRP',
        value: facts.revisedMrpPaise === null ? 'None' : `Rs ${rupees(facts.revisedMrpPaise)}`,
        note: 'The rate change, if one has reached this pack.',
      },
      {
        term: 'Unit sale price',
        value:
          facts.unitSalePrice === null
            ? 'None'
            : `Rs ${facts.unitSalePrice.rupees} per ${facts.unitSalePrice.per}`,
        note: 'The counter arithmetic, done for you.',
      },
      { term: 'Packed', value: dayMonthYear(facts.packedDate), note: 'The morning this run left the line.' },
      {
        term: 'Best before',
        value: dayMonthYear(facts.bestBeforeDate),
        note: 'After this, the house would rather you did not.',
      },
      {
        term: 'Sugar per pack',
        value: grams(facts.sugarMgPerPack),
        note: 'Declared, because the label must say so.',
      },
      {
        term: 'Wrapper',
        value:
          facts.oldWrapper && facts.wrapperNotice !== null
            ? `Old wrapper under ${facts.wrapperNotice.number} v${facts.wrapperNotice.version}`
            : 'Current print',
        note: 'Plants may finish old print for a permitted spell.',
      },
    ];

    const list = document.createElement('dl');
    for (const row of rows) {
      const term = document.createElement('dt');
      term.textContent = row.term;
      const value = document.createElement('dd');
      value.textContent = row.value;
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = row.note;
      value.append(note);
      list.append(term, value);
    }
    mirror.replaceChildren(list);
    if (facts.stickerNote !== null) {
      const note = document.createElement('p');
      note.className = 'mirror-note';
      note.textContent = facts.stickerNote;
      mirror.append(note);
    }
    if (facts.dateNote !== null) {
      const note = document.createElement('p');
      note.className = 'mirror-note';
      note.textContent = facts.dateNote;
      mirror.append(note);
    }
    if (facts.oldWrapper && facts.wrapperNotice !== null) {
      const link = document.createElement('a');
      link.href = `/notices/${facts.wrapperNotice.number}`;
      link.textContent = `Read notice ${facts.wrapperNotice.number}`;
      link.dataset.wrapperLink = 'true';
      mirror.append(link);
    }
    stageDescription.textContent = facts.skuName;

    if (reducedMotion()) {
      mirror.dataset.mirrorSwap = '1';
      return;
    }
    mirror.dataset.mirrorSwap = '0';
    const startedAt = performance.now();
    if (mirrorSwapTimer !== null) window.clearInterval(mirrorSwapTimer);
    mirrorSwapTimer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const value = Math.min(1, elapsed / 180);
      mirror.dataset.mirrorSwap = easeSwap(value).toFixed(3);
      if (value >= 1 && mirrorSwapTimer !== null) {
        window.clearInterval(mirrorSwapTimer);
        mirrorSwapTimer = null;
        mirror.dataset.mirrorSwap = '1';
      }
    }, 16);
  }

  // ----- pack choices -------------------------------------------------------

  function waiting(): boolean {
    return state.waitUntil !== null && performance.now() < state.waitUntil;
  }

  function startWait(seconds: number, status: HTMLElement): void {
    state.waitUntil = performance.now() + seconds * 1000;
    announce(status, waitMessage(seconds));
    readPackButton.setAttribute('aria-disabled', 'true');
    waitTimer.hidden = false;
    let left = seconds;
    waitTimer.textContent = waitTimeSentence(left);
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        waitTimer.hidden = true;
        waitTimer.textContent = '';
        state.waitUntil = null;
        readPackButton.removeAttribute('aria-disabled');
        if (status.textContent === waitMessage(seconds)) status.textContent = '';
        return;
      }
      waitTimer.textContent = waitTimeSentence(left);
    }, 1000);
  }

  async function choosePack(
    target: { kind: 'batch' | 'sku'; code: string },
    options: { history: 'push' | 'none'; pending?: boolean } = { history: 'push' },
  ): Promise<void> {
    state.generation += 1;
    const mine = state.generation;
    if (target.kind === 'batch' && waiting()) {
      announce(readerStatus, waitMessage(Math.ceil((state.waitUntil! - performance.now()) / 1000)));
      return;
    }
    if (options.pending === true) announce(readerStatus, 'Reading your pack.');
    const path =
      target.kind === 'batch'
        ? `/api/batches/${encodeURIComponent(target.code)}`
        : `/api/skus/${encodeURIComponent(target.code)}`;
    let result;
    try {
      result = await request<PackFacts | SkuDetail>('GET', path);
    } catch {
      return;
    }
    if (mine !== state.generation) return;
    if (result.status === 429) {
      startWait(result.retryAfter ?? 60, readerStatus);
      return;
    }
    if (!ok(result)) {
      if (target.kind === 'batch') announce(readerStatus, copy.unknownBatch);
      else {
        announce(readerStatus, copy.unknownPack);
        await choosePack({ kind: 'sku', code: DEFAULT_SKU }, { history: 'none' });
      }
      return;
    }
    const facts =
      target.kind === 'batch'
        ? (result.body as PackFacts)
        : ((result.body as SkuDetail).storyBatch as PackFacts);
    if (target.kind === 'sku') state.skus.set((result.body as SkuDetail).code, result.body as SkuDetail);
    stage.setFacts(facts);
    setMirror(facts);
    state.selectedSkuCode = facts.skuCode;
    const sku = state.skus.get(facts.skuCode);
    if (sku !== undefined) state.selectedDrinkId = sku.drinkId;
    else {
      const drink = state.catalogue?.drinks.find((entry) =>
        entry.skus.some((candidate) => candidate.code === facts.skuCode),
      );
      if (drink !== undefined) state.selectedDrinkId = drink.id;
    }
    renderLineup();
    if (options.history === 'push') {
      const address = target.kind === 'batch' ? `/?batch=${facts.batchCode}` : `/?sku=${facts.skuCode}`;
      window.history.pushState({}, '', address);
    }
    if (target.kind === 'batch') announce(readerStatus, `Batch ${facts.batchCode} read.`);
    else readerStatus.textContent = '';
  }

  // ----- lineup -------------------------------------------------------------

  const drinksList = pick<HTMLUListElement>('[data-drinks]');
  const packsGroup = pick<HTMLElement>('[data-packs]');

  function renderLineup(): void {
    const catalogue = state.catalogue;
    if (catalogue === null) return;
    const selectedIndex = Math.max(
      0,
      catalogue.drinks.findIndex((drink) => drink.id === state.selectedDrinkId),
    );
    drinksList.replaceChildren(
      ...catalogue.drinks.map((drink, index) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = drink.name;
        button.setAttribute('aria-pressed', drink.id === state.selectedDrinkId ? 'true' : 'false');
        button.style.color = brightnessFor(Math.abs(index - selectedIndex));
        button.addEventListener('click', () => {
          const first = drink.skus[0];
          state.selectedDrinkId = drink.id;
          readerStatus.textContent = '';
          void choosePack({ kind: 'sku', code: first.code });
        });
        item.append(button);
        return item;
      }),
    );
    const drink = catalogue.drinks.find((entry) => entry.id === state.selectedDrinkId);
    packsGroup.replaceChildren(
      ...(drink?.skus ?? []).map((sku) => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'lineup-pack';
        radio.value = sku.code;
        radio.setAttribute('aria-label', sku.variant);
        radio.checked = sku.code === state.selectedSkuCode;
        radio.addEventListener('change', () => {
          readerStatus.textContent = '';
          void choosePack({ kind: 'sku', code: sku.code });
        });
        label.append(radio, document.createTextNode(sku.variant));
        return label;
      }),
    );
  }

  function brightnessFor(distance: number): string {
    const levels = [255, 230, 205, 185, 165, 150];
    const level = levels[Math.min(distance, levels.length - 1)];
    return `rgb(${level},${level},${level})`;
  }

  // ----- search -------------------------------------------------------------

  let searchTimer: number | null = null;

  function runSearch(): void {
    const query = searchBox.value;
    if (query.trim() === '') {
      resultsList.replaceChildren();
      searchStatus.textContent = '';
      return;
    }
    state.searchGeneration += 1;
    const mine = state.searchGeneration;
    void request<SearchAnswer>('GET', `/api/search?q=${encodeURIComponent(query)}`)
      .then((result) => {
        if (mine !== state.searchGeneration) return;
        if (result.status === 429) {
          startWait(result.retryAfter ?? 60, searchStatus);
          return;
        }
        if (!ok(result)) return;
        const answer = result.body;
        const hadFocus = resultsList.contains(document.activeElement);
        resultsList.replaceChildren(
          ...answer.results.map((entry) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent =
              entry.kind === 'batch'
                ? `${entry.batchCode} ${entry.name} Rs ${rupees(entry.retailPricePaise)}`
                : `${entry.name} Rs ${rupees(entry.retailPricePaise)}`;
            const source = document.createElement('span');
            source.className = 'result-source';
            source.textContent =
              entry.sourceNotice === null
                ? 'Launch print'
                : `${entry.sourceNotice.number} v${entry.sourceNotice.version}`;
            button.addEventListener('click', () => {
              if (entry.kind === 'batch' && entry.batchCode !== null) {
                void choosePack({ kind: 'batch', code: entry.batchCode });
              } else {
                void choosePack({ kind: 'sku', code: entry.skuCode });
              }
              focusWithoutScroll(button);
            });
            item.append(button, source);
            return item;
          }),
        );
        if (hadFocus) focusWithoutScroll(searchBox);
        const count = answer.results.length;
        const tail =
          answer.searchState === 'behind'
            ? ` ${copy.searchBehind}`
            : answer.searchState === 'down'
              ? ` ${copy.searchDown}`
              : '';
        if (count > 0) announce(searchStatus, `${packsFoundSentence(count)}${tail}`);
        else if (answer.searchState === 'behind') announce(searchStatus, copy.searchBehind);
        else if (answer.searchState === 'down') announce(searchStatus, copy.searchDown);
        else announce(searchStatus, copy.noMatch);
      })
      .catch(() => undefined);
  }

  searchBox.addEventListener('input', () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(runSearch, 250);
  });

  searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      const first = resultsList.querySelector('button');
      if (first !== null) {
        event.preventDefault();
        focusWithoutScroll(first as HTMLElement);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      searchBox.value = '';
      resultsList.replaceChildren();
      searchStatus.textContent = '';
    }
  });

  resultsList.addEventListener('keydown', (event) => {
    const buttons = [...resultsList.querySelectorAll('button')] as HTMLElement[];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' && index >= 0 && index < buttons.length - 1) {
      event.preventDefault();
      focusWithoutScroll(buttons[index + 1]);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      focusWithoutScroll(buttons[index - 1]);
    } else if (event.key === 'ArrowUp' && index === 0) {
      event.preventDefault();
      focusWithoutScroll(searchBox);
      searchBox.setSelectionRange(searchBox.value.length, searchBox.value.length);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      focusWithoutScroll(searchBox);
    }
  });

  // ----- reader -------------------------------------------------------------

  pick<HTMLFormElement>('[data-reader]').addEventListener('submit', (event) => {
    event.preventDefault();
    if (waiting()) return;
    const code = batchBox.value.trim().toUpperCase();
    if (code === '') return;
    void choosePack({ kind: 'batch', code }, { history: 'push', pending: true });
    focusWithoutScroll(batchBox);
  });

  pick<HTMLAnchorElement>('[data-read-your-pack]').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('the-pack')?.scrollIntoView({ block: 'start' });
    focusWithoutScroll(batchBox);
  });

  // ----- listings and current prices ---------------------------------------

  const listings = pick<HTMLElement>('[data-listings]');
  const currentPrices = pick<HTMLElement>('[data-current-prices]');
  const countsNode = pick<HTMLElement>('[data-counts]');
  const keepers: LinkKeeper[] = [];

  function renderListings(): void {
    for (const keeper of keepers.splice(0)) keeper.stop();
    const wide = window.innerWidth >= 768;
    listings.replaceChildren(
      ...state.notices.map((notice) => {
        const version = notice.currentVersion;
        const block = document.createElement('article');
        block.className = 'listing';
        const title = document.createElement('h3');
        title.textContent = version.title;
        const date = document.createElement('p');
        date.className = 'listing-date';
        date.textContent = dayMonthYear(version.effectiveDate);
        block.append(title, date);
        block.append(
          rowsTable(
            `Revised prices ${notice.number}`,
            ['Pack', 'Old MRP', 'Revised MRP', 'Kind'],
            version.rows.map((row) => [
              row.name,
              `Rs ${rupees(row.oldMrpPaise)}`,
              `Rs ${rupees(row.revisedMrpPaise)}`,
              row.kind === 'sticker' ? 'Sticker' : 'New print',
            ]),
            wide,
          ),
        );
        if (version.runOutUntil !== null) {
          const runOut = document.createElement('p');
          runOut.textContent = `Old wrappers allowed until ${dayMonthYear(version.runOutUntil)}`;
          block.append(runOut);
        }
        const linkHolder = document.createElement('p');
        linkHolder.className = 'listing-link';
        block.append(linkHolder);
        if (version.printState === 'pending') {
          linkHolder.textContent = copy.stillBeingPrinted;
        } else {
          const keeper = new LinkKeeper(
            `/api/notices/${notice.number}/versions/${version.version}/link`,
            (linkState) => showLink(linkHolder, linkState, notice.number, version.version),
          );
          keepers.push(keeper);
          keeper.start();
        }
        return block;
      }),
    );

    const skus = [...state.skus.values()];
    currentPrices.replaceChildren(
      rowsTable(
        'Current prices',
        ['Pack', 'Print MRP', 'Source notice'],
        skus.map((sku) => [
          sku.name,
          `Rs ${rupees(sku.currentMrpPaise)}`,
          sku.currentSource === null
            ? 'Launch print'
            : `${sku.currentSource.number} v${sku.currentSource.version}`,
        ]),
        wide,
      ),
    );
  }

  function showLink(holder: HTMLElement, linkState: LinkState, number: string, version: number): void {
    if (linkState.kind === 'link') {
      const link = document.createElement('a');
      link.href = linkState.url;
      link.textContent = `Download notice ${number} version ${version}`;
      holder.replaceChildren(link);
      if (printStatus.textContent === copy.expiredLink) printStatus.textContent = '';
      return;
    }
    if (linkState.kind === 'expired') {
      holder.textContent = '';
      announce(printStatus, copy.expiredLink);
      return;
    }
    if (linkState.kind === 'storage') {
      holder.textContent = copy.storageOutage;
      announce(printStatus, copy.storageOutage);
      return;
    }
    if (linkState.kind === 'print-failed') {
      holder.textContent = copy.printOutage;
      announce(printStatus, copy.printOutage);
      return;
    }
    if (linkState.kind === 'pending') holder.textContent = copy.stillBeingPrinted;
  }

  function rowsTable(name: string, headers: string[], rows: string[][], wide: boolean): HTMLElement {
    if (wide) {
      const table = document.createElement('table');
      table.setAttribute('aria-label', name);
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const header of headers) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = header;
        headRow.append(cell);
      }
      head.append(headRow);
      const body = document.createElement('tbody');
      for (const row of rows) {
        const line = document.createElement('tr');
        for (const value of row) {
          const cell = document.createElement('td');
          cell.textContent = value;
          line.append(cell);
        }
        body.append(line);
      }
      table.append(head, body);
      return table;
    }
    const list = document.createElement('ul');
    list.setAttribute('aria-label', name);
    list.className = 'stacked';
    for (const row of rows) {
      const item = document.createElement('li');
      row.forEach((value, index) => {
        const line = document.createElement('p');
        line.textContent = `${headers[index]}: ${value}`;
        item.append(line);
      });
      list.append(item);
    }
    return list;
  }

  function renderMarqueeRows(): void {
    const track = pick<HTMLElement>('[data-marquee-track]');
    const names = new Map<string, string>();
    for (const sku of state.skus.values()) names.set(sku.code, sku.name);
    for (const drink of state.catalogue?.drinks ?? []) {
      for (const sku of drink.skus) names.set(sku.code, sku.name);
    }
    const entries: string[] = [];
    for (const notice of state.notices) {
      if (notice.currentVersion.state === 'scheduled') continue;
      for (const row of notice.currentVersion.rows) {
        entries.push(
          `${names.get(row.skuCode) ?? row.name} Rs ${rupees(row.oldMrpPaise)} to Rs ${rupees(
            row.revisedMrpPaise,
          )} from ${dayMonthYear(notice.currentVersion.effectiveDate)}`,
        );
      }
    }
    track.textContent = entries.join('   ·   ');
  }

  // ----- loading ------------------------------------------------------------

  async function loadCatalogue(): Promise<void> {
    const result = await request<Catalogue>('GET', '/api/catalogue');
    if (!ok(result)) return;
    state.catalogue = result.body;
    state.drawnDate = result.body.today;
    countsNode.textContent = countsLine(result.body.counts);
    if (state.selectedDrinkId === '') {
      const drink = result.body.drinks.find((entry) =>
        entry.skus.some((sku) => sku.code === state.selectedSkuCode),
      );
      state.selectedDrinkId = drink?.id ?? result.body.drinks[0].id;
    }
    renderLineup();
  }

  async function loadNotices(): Promise<void> {
    const result = await request<{ notices: NoticeSummary[] }>('GET', '/api/notices');
    if (!ok(result)) return;
    state.notices = result.body.notices;
  }

  async function loadSkus(): Promise<void> {
    const catalogue = state.catalogue;
    if (catalogue === null) return;
    const codes = catalogue.drinks.flatMap((drink) => drink.skus.map((sku) => sku.code));
    const answers = await Promise.all(
      codes.map((code) => request<SkuDetail>('GET', `/api/skus/${code}`).catch(() => null)),
    );
    for (const answer of answers) {
      if (answer !== null && ok(answer)) state.skus.set(answer.body.code, answer.body);
    }
  }

  /** The pack the address asks for is read first, so nothing later overrides it. */
  async function loadEverything(): Promise<void> {
    await loadCatalogue();
    await openAddress(false);
    await Promise.all([loadNotices(), loadSkus()]);
    renderListings();
    renderMarqueeRows();
  }

  async function openAddress(push: boolean): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const batch = params.get('batch');
    const sku = params.get('sku');
    if (batch !== null && batch !== '') {
      await choosePack({ kind: 'batch', code: batch.toUpperCase() }, { history: push ? 'push' : 'none' });
      return;
    }
    if (sku !== null && sku !== '') {
      await choosePack({ kind: 'sku', code: sku.toUpperCase() }, { history: push ? 'push' : 'none' });
      return;
    }
    await choosePack({ kind: 'sku', code: DEFAULT_SKU }, { history: 'none' });
  }

  window.addEventListener('popstate', () => {
    void openAddress(false);
  });

  void loadEverything();

  // ----- the new day --------------------------------------------------------

  const daySlip = pick<HTMLElement>('[data-day-slip]');
  const daySentence = pick<HTMLElement>('[data-day-sentence]');
  const dayReadButton = pick<HTMLButtonElement>('[data-day-read]');

  window.setInterval(() => {
    void checkDay();
  }, 30_000);

  async function checkDay(): Promise<void> {
    state.dayGeneration += 1;
    const mine = state.dayGeneration;
    const result = await request<Catalogue>('GET', '/api/catalogue').catch(() => null);
    if (result === null || !ok(result)) return;
    if (mine !== state.dayGeneration || state.dayPending) return;
    if (result.body.today === state.drawnDate) {
      if (!daySlip.hidden) {
        daySlip.hidden = true;
      }
      return;
    }
    const sentence = newDaySentence(result.body.today);
    if (daySlip.hidden || daySentence.textContent !== sentence) {
      daySentence.textContent = sentence;
      daySlip.hidden = false;
      announce(dayStatus, sentence);
    }
  }

  dayReadButton.addEventListener('click', () => {
    if (state.dayPending) return;
    state.dayPending = true;
    state.dayGeneration += 1;
    dayReadButton.setAttribute('aria-disabled', 'true');
    void readToday().finally(() => {
      state.dayPending = false;
      dayReadButton.removeAttribute('aria-disabled');
    });
  });

  async function readToday(): Promise<void> {
    const scroll = window.scrollY;
    const result = await request<Catalogue>('GET', '/api/catalogue').catch(() => null);
    if (result === null) return;
    if (result.status === 429) {
      startWait(result.retryAfter ?? 60, readerStatus);
      return;
    }
    if (!ok(result)) return;
    state.catalogue = result.body;
    state.drawnDate = result.body.today;
    countsNode.textContent = countsLine(result.body.counts);
    state.skus.clear();
    await Promise.all([loadNotices(), loadSkus()]);
    renderListings();
    renderMarqueeRows();
    renderLineup();
    await openAddress(false);
    window.scrollTo({ top: scroll });
    daySlip.hidden = true;
    announce(dayStatus, dayReadSentence(state.drawnDate));
    focusWithoutScroll(dayStatus);
  }

  // ----- layout and motion --------------------------------------------------

  /** The wordmark is scaled to the full width of the screen. */
  function fitWordmark(): void {
    const node = pick<HTMLElement>('[data-wordmark]');
    const target = window.innerWidth;
    node.style.fontSize = '100px';
    for (let pass = 0; pass < 3; pass += 1) {
      const current = node.getBoundingClientRect().width;
      if (current <= 0) return;
      const size = Number.parseFloat(node.style.fontSize);
      node.style.fontSize = `${(size * target) / current}px`;
    }
  }

  window.addEventListener('resize', () => {
    renderListings();
    renderLineup();
    fitWordmark();
  });
  window.setTimeout(fitWordmark, 400);
  window.setTimeout(fitWordmark, 1500);
  if (document.fonts !== undefined) void document.fonts.ready.then(fitWordmark);

  onReducedMotionChange(() => {
    const stills = pick<HTMLElement>('[data-stills]');
    stills.hidden = !reducedMotion();
    pick<HTMLElement>('[data-turn]').closest('.turn')?.toggleAttribute('hidden', reducedMotion());
    pick<HTMLElement>('[data-marquee-toggle]').toggleAttribute('hidden', reducedMotion());
  });
  pick<HTMLElement>('[data-stills]').hidden = !reducedMotion();
  pick<HTMLElement>('[data-turn]').closest('.turn')?.toggleAttribute('hidden', reducedMotion());
  pick<HTMLElement>('[data-marquee-toggle]').toggleAttribute('hidden', reducedMotion());
}

function easeSwap(value: number): number {
  const bezier = (a: number, b: number, time: number): number =>
    3 * a * time * (1 - time) * (1 - time) + 3 * b * time * time * (1 - time) + time * time * time;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step += 1) {
    const middle = (low + high) / 2;
    if (bezier(0.2, 0, middle) < value) low = middle;
    else high = middle;
  }
  return bezier(0, 1, (low + high) / 2);
}

function setUpReels(root: HTMLElement): void {
  const toggle = root.querySelector('[data-reels-toggle]') as HTMLButtonElement;
  const nav = root.querySelector('[data-reels]') as HTMLElement;
  const links = [...nav.querySelectorAll('a')] as HTMLAnchorElement[];

  const narrow = (): boolean => window.innerWidth < 768;
  let open = false;

  const apply = (): void => {
    if (narrow()) {
      toggle.hidden = false;
      nav.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    toggle.hidden = true;
    nav.hidden = false;
    open = false;
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    open = !open;
    apply();
    if (open) focusWithoutScroll(links[0]);
  });

  nav.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !narrow()) return;
    open = false;
    apply();
    focusWithoutScroll(toggle);
  });

  for (const link of links) {
    link.addEventListener('click', () => {
      if (!narrow()) return;
      open = false;
      apply();
      focusWithoutScroll(toggle);
    });
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!narrow() || !open) return;
      const target = event.target as Node;
      if (nav.contains(target) || toggle.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      open = false;
      apply();
      focusWithoutScroll(toggle);
    },
    true,
  );

  document.addEventListener('keydown', (event) => {
    if (!narrow() || !open || event.key !== 'Tab') return;
    const order: HTMLElement[] = [toggle, ...links];
    const index = order.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    const next = event.shiftKey
      ? order[(index <= 0 ? order.length : index) - 1]
      : order[(index + 1) % order.length];
    focusWithoutScroll(next);
  });

  window.addEventListener('resize', () => {
    const insidePanel = nav.contains(document.activeElement) || document.activeElement === toggle;
    const wasNarrow = narrow();
    apply();
    if (!wasNarrow && insidePanel) {
      focusWithoutScroll(root.querySelector('[data-reels] a:nth-child(2)') as HTMLElement);
    }
  });
  apply();
}

function setUpMarquee(root: HTMLElement): void {
  const marquee = root.querySelector('[data-marquee]') as HTMLElement;
  const toggle = root.querySelector('[data-marquee-toggle]') as HTMLButtonElement;
  let running = true;
  toggle.addEventListener('click', () => {
    running = !running;
    marquee.dataset.running = running ? 'true' : 'false';
    marquee.classList.toggle('paused', !running);
    toggle.textContent = running ? 'Pause price changes' : 'Play price changes';
  });
  marquee.dataset.running = 'true';
}

function setUpStills(root: HTMLElement, stage: PackStage): void {
  for (const button of [...root.querySelectorAll('[data-still]')] as HTMLButtonElement[]) {
    button.addEventListener('click', () => {
      stage.setStillView(button.dataset.still as 'front' | 'back' | 'sticker');
    });
  }
}

function setUpSlider(slider: HTMLInputElement, stage: PackStage): void {
  const applyValue = (value: number): void => {
    const next = Math.max(0, Math.min(100, value));
    slider.value = String(next);
    window.scrollTo({ top: stage.offsetFor(next / 100) });
  };
  slider.addEventListener('input', () => applyValue(Number(slider.value)));
  slider.addEventListener('keydown', (event) => {
    const current = Number(slider.value);
    const steps: Record<string, number> = {
      ArrowRight: 5,
      ArrowUp: 5,
      ArrowLeft: -5,
      ArrowDown: -5,
      PageUp: 25,
      PageDown: -25,
    };
    if (event.key in steps) {
      event.preventDefault();
      applyValue(current + steps[event.key]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      applyValue(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      applyValue(100);
    }
  });
}
