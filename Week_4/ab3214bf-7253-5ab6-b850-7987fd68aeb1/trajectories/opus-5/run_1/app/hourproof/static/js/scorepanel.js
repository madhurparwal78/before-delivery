// The score panel: blocks drawn to scale, the giant numeral, and Break the Month.

import { get } from './api.js';
import { announce, clear, el } from './dom.js';
import { commas, grainWord, percent, points } from './format.js';
import { motionAttributes, onMotionChange, reduced } from './motion.js';

export const GRAINS = ['month', 'week', 'day', 'hour'];
export const GRAIN_WORDS = ['MONTH', 'WEEK', 'DAY', 'HOUR'];

const SPLIT_MS = 180;
const FALL_MS = 320;
const COUNT_MS = 480;

const GRAIN_FAILURE = 'THAT GRAIN DID NOT LOAD. MOVE AGAIN.';

export class ScorePanel {
  constructor({ windowId, onGrain, onHourGrain }) {
    this.windowId = windowId;
    this.onGrain = onGrain;
    this.onHourGrain = onHourGrain;
    this.monthBp = 0;
    this.index = 0;
    this.settledIndex = 0;
    this.sequence = 0;
    this.highestRevision = 0;
    this.retried = false;
    this.timers = [];
    this.openWorst = new Set();

    this.blockArea = el('div', { className: 'block-area', dataset: { blockArea: 'true' } });
    this.splitPart = el('div', { dataset: { phasePart: 'split' } }, [this.blockArea]);
    this.fallPart = el('div', { dataset: { phasePart: 'fall' } });
    this.numeral = el('div', { className: 'numeral', dataset: { scoreNumeral: 'true' } });
    this.countPart = el('div', { dataset: { phasePart: 'count' } }, [this.numeral]);
    motionAttributes(this.splitPart, SPLIT_MS);
    motionAttributes(this.fallPart, FALL_MS);
    motionAttributes(this.countPart, COUNT_MS);
    this.failureLine = el('div', { className: 'outage', text: GRAIN_FAILURE, hidden: true });

    this.node = el(
      'div',
      {
        role: 'region',
        'aria-label': 'Score panel',
        className: 'score-panel',
        dataset: { phase: 'settled' },
      },
      [this.countPart, this.splitPart, this.fallPart, this.failureLine]
    );

    this.slider = el('input', {
      type: 'range',
      min: '0',
      max: '3',
      step: '1',
      value: '0',
      'aria-label': 'Break the Month',
      'aria-valuetext': 'MONTH',
    });
    this.slider.addEventListener('input', () => {
      const next = Number(this.slider.value);
      if (next !== this.index) this.move(next);
    });
    const detents = el(
      'div',
      { className: 'detents', 'aria-hidden': 'true' },
      GRAIN_WORDS.map((word, position) => {
        const button = el('button', { type: 'button', text: word, tabindex: '-1' });
        button.addEventListener('click', () => this.move(position));
        return button;
      })
    );
    this.sliderShell = el('div', { className: 'slider-shell' }, [this.slider, detents]);

    this.buckets = el('ul', { role: 'list', 'aria-label': 'Buckets', className: 'buckets' });
    onMotionChange(() => {
      if (this.node.dataset.phase !== 'settled') this.settle();
    });
  }

  setMonthScore(bp) {
    this.monthBp = bp;
  }

  grain() {
    return GRAINS[this.settledIndex];
  }

  clearTimers() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }

  async move(nextIndex, { silent = false } = {}) {
    this.index = nextIndex;
    this.slider.value = String(nextIndex);
    this.slider.setAttribute('aria-valuetext', GRAIN_WORDS[nextIndex]);
    this.clearTimers();
    this.sequence += 1;
    const mine = this.sequence;
    const grain = GRAINS[nextIndex];
    this.numeral.textContent = 'COUNTING';
    const answer = await get(`/api/windows/${this.windowId}/grains/${grain}`);
    if (mine !== this.sequence) return;
    if (answer.status >= 500 || answer.cancelled) {
      this.failed();
      return;
    }
    if (answer.status !== 200) {
      this.failed();
      return;
    }
    const data = answer.data;
    if (data.revision < this.highestRevision) {
      if (this.retried) return;
      this.retried = true;
      this.move(nextIndex, { silent });
      return;
    }
    this.retried = false;
    this.highestRevision = Math.max(this.highestRevision, data.revision);
    this.failureLine.hidden = true;
    this.current = data;
    this.openWorst = new Set();
    this.runSequence(data, nextIndex, silent);
  }

  failed() {
    this.index = this.settledIndex;
    this.slider.value = String(this.settledIndex);
    this.slider.setAttribute('aria-valuetext', GRAIN_WORDS[this.settledIndex]);
    this.failureLine.hidden = false;
    if (this.current) this.paint(this.current);
    this.node.dataset.phase = 'settled';
  }

  runSequence(data, index, silent) {
    const towardHour = index >= this.settledIndex;
    this.settledIndex = index;
    this.paint(data);
    if (reduced()) {
      this.settle(silent);
      return;
    }
    const order = towardHour ? ['split', 'fall', 'count'] : ['count', 'fall', 'split'];
    const lengths = { split: SPLIT_MS, fall: FALL_MS, count: COUNT_MS };
    let delay = 0;
    order.forEach((phase) => {
      this.timers.push(
        window.setTimeout(() => {
          this.node.dataset.phase = phase;
          if (phase === 'fall') this.showFalls(data);
          else clear(this.fallPart);
          if (phase === 'count') this.countTo(data.score_bp);
        }, delay)
      );
      delay += lengths[phase];
    });
    this.timers.push(window.setTimeout(() => this.settle(silent), delay));
  }

  settle(silent = false) {
    this.clearTimers();
    clear(this.fallPart);
    this.node.dataset.phase = 'settled';
    if (!this.current) return;
    this.numeral.textContent = `${percent(this.current.score_bp)}%`;
    if (!silent) {
      const grain = GRAINS[this.settledIndex];
      announce(
        'Grain score',
        `${grainWord(grain)} grain. ${percent(this.current.score_bp)} percent matched.` +
          ` ${points(this.monthBp, this.current.score_bp)} points gone since month.`
      );
    }
    if (this.onGrain) this.onGrain(this.current, GRAINS[this.settledIndex]);
  }

  countTo(scoreBp) {
    const text = `${percent(scoreBp)}%`;
    clear(this.numeral);
    Array.from(text).forEach((character) =>
      this.numeral.append(el('span', { text: character }))
    );
  }

  showFalls(data) {
    clear(this.fallPart);
    (data.falls || [])
      .filter((fall) => fall.detached_wh > 0)
      .forEach((fall) => {
        this.fallPart.append(
          el('div', {
            className: 'fall-piece',
            dataset: { fallParent: fall.parent_key, detachedWh: fall.detached_wh },
          })
        );
      });
  }

  paint(data) {
    const grain = data.grain;
    this.node.dataset.grain = grain;
    this.numeral.textContent = `${percent(data.score_bp)}%`;
    const scale = Math.max(
      1,
      ...data.buckets.map((bucket) => bucket.consumed_wh + bucket.surplus_wh)
    );
    clear(this.blockArea);
    if (grain !== 'hour') {
      data.buckets.forEach((bucket) => {
        const gap = Math.max(0, bucket.consumed_wh - bucket.matched_wh);
        this.blockArea.append(
          el(
            'div',
            {
              className: 'block',
              dataset: {
                bucketKey: bucket.key,
                matchedWh: bucket.matched_wh,
                consumedWh: bucket.consumed_wh,
                surplusWh: bucket.surplus_wh,
              },
            },
            [
              styled(
                el('div', { className: 'block__surplus', dataset: { blockPart: 'surplus' } }),
                (bucket.surplus_wh / scale) * 100
              ),
              styled(el('div', {}), (gap / scale) * 100),
              styled(
                el('div', { className: 'block__matched', dataset: { blockPart: 'matched' } }),
                (bucket.matched_wh / scale) * 100
              ),
            ]
          )
        );
      });
    }
    this.paintBuckets(data);
    if (grain === 'hour' && this.onHourGrain) this.onHourGrain(data);
  }

  paintBuckets(data) {
    clear(this.buckets);
    if (data.grain === 'hour') {
      this.buckets.hidden = true;
      return;
    }
    this.buckets.hidden = false;
    data.buckets.forEach((bucket) => {
      const worst = el('ul', {
        role: 'list',
        'aria-label': `Worst of ${bucket.key}`,
        className: 'worst',
        hidden: !this.openWorst.has(bucket.key),
      });
      (bucket.worst || []).forEach((row) =>
        worst.append(
          el('li', { text: `${row.key} ${commas(row.unmatched_wh)} Wh unmatched` })
        )
      );
      const reveal = el('button', { type: 'button', text: 'Where it went' });
      reveal.addEventListener('click', () => {
        const open = this.openWorst.has(bucket.key);
        if (open) this.openWorst.delete(bucket.key);
        else this.openWorst.add(bucket.key);
        worst.hidden = open;
      });
      this.buckets.append(
        el('li', {}, [
          el('div', { className: 'row' }, [
            el('strong', { text: bucket.key }),
            el('span', { text: `${percent(share(bucket))}% matched` }),
            el('span', { text: `${commas(bucket.consumed_wh)} Wh consumed` }),
            reveal,
          ]),
          worst,
        ])
      );
    });
  }

  liveUpdate(data) {
    // A live change while settled updates the numeral in place.
    if (this.node.dataset.phase !== 'settled') return;
    this.highestRevision = Math.max(this.highestRevision, data.revision);
    this.current = data;
    this.paint(data);
    this.numeral.textContent = `${percent(data.score_bp)}%`;
  }
}

function styled(node, percentage) {
  node.style.height = `${percentage}%`;
  return node;
}

function share(bucket) {
  if (!bucket.consumed_wh) return 0;
  return Math.round((bucket.matched_wh * 10000) / bucket.consumed_wh);
}
