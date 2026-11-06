// The sleeper coach plan: one procedural SVG per coach, nine bays of eight
// berths, with halved RAC side-lower cells.

import { BERTH_POS, QUOTA_LABEL } from './format.js';
import { el, prefersReducedMotion } from './ui.js';

export interface BerthState {
  berth: number; bay: number; type: string; quota: string;
  state: 'free' | 'taken' | 'rac_free' | 'rac_one_free' | 'rac_full';
}

export interface CoachPlanData {
  coaches: { coach: string; berths: BerthState[] }[];
}

export const STATE_TAG: Record<string, string> = {
  free: 'free',
  taken: 'taken',
  rac_free: 'two RAC places free',
  rac_one_free: 'one RAC place free',
  rac_full: 'RAC full',
};

export interface PlanHandlers {
  /** Called when a berth is picked for the chosen passenger (Enter, Space or tap). */
  onPick?(coach: string, berth: number, type: string): void;
  /** Berth name tags for the current page. */
  preferredTags: Map<string, number[]>; // coach:berth -> passenger numbers
  /** On booking detail: passengers on this booking, per berth. */
  occupantTags?: Map<string, { number: number; rac: boolean }[]>;
  /** The passenger currently chosen in "Choosing for". */
  chosen?: number;
}

const CELL_W = 64, CELL_H = 40, BAY_GAP = 14, TOP = 46;

/** Berth button name: `Berth <coach> <number> <position word>, <tags>`. */
export function berthName(coach: string, berth: BerthState, h: PlanHandlers): string {
  const pos = BERTH_POS[berth.type] ?? 'lower';
  const tags: string[] = [QUOTA_LABEL[berth.quota] ?? berth.quota, STATE_TAG[berth.state]];
  const prefs = h.preferredTags.get(`${coach}:${berth.berth}`) ?? [];
  for (const n of prefs) tags.push(`preferred by passenger ${n}`);
  const occ = h.occupantTags?.get(`${coach}:${berth.berth}`) ?? [];
  for (const o of occ) tags.push(`${o.rac ? 'RAC' : 'CNF'} passenger ${o.number}`);
  return `Berth ${coach} ${berth.berth} ${pos}, ${tags.join(', ')}`;
}

/**
 * Draw the plan. `vertical` flips bays to run top to bottom (phone booking
 * page); horizontally the bays run left to right with the side berths on the
 * aisle edge.
 */
export function drawCoachPlan(
  container: HTMLElement, data: CoachPlanData, selectedCoach: string, vertical: boolean, handlers: PlanHandlers,
): void {
  container.innerHTML = '';
  const coachData = data.coaches.find((c) => c.coach === selectedCoach) ?? data.coaches[0];
  if (!coachData) return;

  const bays = 9;
  const planW = vertical ? CELL_W + 470 : bays * (CELL_W * 2 + 16 + BAY_GAP) + 30;
  const planH = vertical ? bays * (CELL_H * 2 + 22) + TOP + 20 : CELL_H * 2 + TOP + 30;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(planW));
  svg.setAttribute('height', String(planH));
  svg.setAttribute('viewBox', `0 0 ${planW} ${planH}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', `Coach plan ${selectedCoach}`);

  // hatch pattern for taken berths
  const defs = document.createElementNS(svgNS, 'defs');
  const pattern = document.createElementNS(svgNS, 'pattern');
  pattern.setAttribute('id', 'hatch');
  pattern.setAttribute('width', '6');
  pattern.setAttribute('height', '6');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('patternTransform', 'rotate(45)');
  const line1 = document.createElementNS(svgNS, 'line');
  line1.setAttribute('x1', '0'); line1.setAttribute('y1', '0');
  line1.setAttribute('x2', '0'); line1.setAttribute('y2', '6');
  line1.setAttribute('stroke', 'rgba(43,33,22,0.28)');
  line1.setAttribute('stroke-width', '2');
  pattern.appendChild(line1);
  defs.appendChild(pattern);
  svg.appendChild(defs);

  const planWrap = document.createElementNS(svgNS, 'g') as unknown as HTMLElement;
  planWrap.setAttribute('tabindex', '0');
  planWrap.setAttribute('role', 'group');
  planWrap.setAttribute('aria-label', `Coach plan ${selectedCoach}`);
  svg.appendChild(planWrap);

  // coach code and bay numbers along the top edge
  const coachText = document.createElementNS(svgNS, 'text');
  coachText.setAttribute('x', '6'); coachText.setAttribute('y', '16');
  coachText.setAttribute('font-size', '15');
  coachText.setAttribute('font-weight', '700');
  coachText.textContent = selectedCoach;
  planWrap.appendChild(coachText);

  // bay k berths: 8k-7..8k. Visual order per bay: the two facing stacks of
  // lower, middle, upper, then the side berths along the aisle.
  const berthOrder = (bay: number): number[] =>
    [8 * bay - 7, 8 * bay - 6, 8 * bay - 5, 8 * bay - 4, 8 * bay - 3, 8 * bay - 2, 8 * bay - 1, 8 * bay];
  const berthEls = new Map<number, HTMLElement>();

  for (let bay = 1; bay <= bays; bay++) {
    const bayX = vertical ? 8 : 24 + (bay - 1) * (CELL_W * 2 + 16 + BAY_GAP);
    const bayY = vertical ? TOP + (bay - 1) * (CELL_H * 2 + 22) : TOP;
    const bayLabel = document.createElementNS(svgNS, 'text');
    bayLabel.setAttribute('x', String(bayX + CELL_W));
    bayLabel.setAttribute('y', String(bayY - 8));
    bayLabel.setAttribute('font-size', '12');
    bayLabel.textContent = `Bay ${bay}`;
    planWrap.appendChild(bayLabel);

    for (const [pos, berthNum] of berthOrder(bay).entries()) {
      const berth = coachData.berths.find((b) => b.berth === berthNum)!;
      const isSide = pos >= 6;
      const stackIdx = pos % 3;
      const col = pos < 6 ? Math.floor(pos / 3) : 0;
      const x = vertical ? bayX + (isSide ? CELL_W + 8 : col * (CELL_W + 4)) : bayX + (isSide ? CELL_W * 2 + 8 : col * (CELL_W + 4));
      const y = bayY + stackIdx * (CELL_H + 4);
      const w = isSide ? (vertical ? 120 : CELL_W + 40) : CELL_W;
      const hgt = CELL_H;

      const btn = document.createElementNS(svgNS, 'foreignObject');
      btn.setAttribute('x', String(x));
      btn.setAttribute('y', String(y));
      btn.setAttribute('width', String(w));
      btn.setAttribute('height', String(hgt));
      const htmlBtn = document.createElement('button');
      htmlBtn.className = 'berth';
      htmlBtn.dataset.coach = selectedCoach;
      htmlBtn.dataset.berth = String(berthNum);
      htmlBtn.dataset.bay = String(bay);
      htmlBtn.dataset.pos = String(pos);
      htmlBtn.dataset.side = isSide ? '1' : '0';
      htmlBtn.dataset.stack = String(stackIdx);
      htmlBtn.setAttribute('aria-label', berthName(selectedCoach, berth, handlers));

      const inner = document.createElement('span');
      inner.setAttribute('aria-hidden', 'true');
      inner.style.display = 'flex';
      inner.style.gap = '2px';
      inner.style.width = '100%';
      inner.style.height = '100%';
      inner.style.minHeight = '44px';
      inner.style.minWidth = '44px';

      const makeCell = (cls: string, label: string, stamp: boolean, half: 'a' | 'b' | null): HTMLElement => {
        const cell = el('span', { class: cls });
        cell.style.flex = '1';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.minHeight = '44px';
        cell.style.position = 'relative';
        cell.setAttribute('data-cell-kind', label);
        if (half !== 'b') {
          const num = el('span', { class: 'mono' });
          num.style.fontSize = '0.68rem';
          num.textContent = stamp ? 'CNF' : String(berthNum);
          cell.appendChild(num);
        }
        return cell;
      };

      let stampCnf = false;
      if (berth.quota === 'RAC') {
        const occ = handlers.occupantTags?.get(`${selectedCoach}:${berthNum}`) ?? [];
        const selfRac = occ.filter((o) => o.rac).length > 0;
        const other = handlers.occupantTags?.get(`${selectedCoach}:${berthNum}`)?.filter((o) => o.rac).length ?? 0;
        void selfRac; void other;
        const clsA = berth.state === 'rac_full' ? 'cell-rac-half-a' : (berth.state === 'rac_one_free' ? 'cell-rac-half-a' : 'cell-rac-half-b');
        const taken = berth.state !== 'rac_free';
        const cellA = makeCell(berth.state === 'rac_free' ? 'cell-free cell-any' : (taken ? 'cell-rac-half-a cell-any' : 'cell-free cell-any'), 'rac-a', false, 'a');
        const cellB = makeCell(berth.state === 'rac_full' ? 'cell-taken cell-any' : 'cell-rac-half-b cell-any', 'rac-b', false, 'b');
        inner.appendChild(cellA);
        inner.appendChild(cellB);
      } else {
        const free = berth.state === 'free';
        const cnf = !free && (handlers.occupantTags?.get(`${selectedCoach}:${berthNum}`)?.some((o) => !o.rac) ?? false);
        stampCnf = cnf;
        const cls = free ? 'cell-free cell-any' : (cnf ? 'cell-cnf cell-any' : 'cell-taken cell-any');
        const cell = makeCell(cls, free ? 'free' : (cnf ? 'cnf' : 'taken'), cnf, null);
        if (cnf) cell.querySelector('span')?.setAttribute('class', 'berth-stamp');
        else cell.querySelector('span')?.setAttribute('class', 'berth-num');
        inner.appendChild(cell);
      }
      const pref = handlers.preferredTags.get(`${selectedCoach}:${berthNum}`);
      if (pref) {
        inner.querySelectorAll('.cell-any').forEach((c) => c.classList.add('cell-preferred'));
      }
      htmlBtn.appendChild(inner);
      btn.appendChild(htmlBtn);
      planWrap.appendChild(btn);
      berthEls.set(berthNum, htmlBtn);
    }
  }

  // keyboard navigation: the plan is one Tab stop
  planWrap.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target !== planWrap && !target.closest('.berth')) return;
    const focused = planWrap.querySelector<HTMLElement>('button.berth:focus');
    const all = Array.from(planWrap.querySelectorAll<HTMLElement>('button.berth'));
    const idx = focused ? all.indexOf(focused) : -1;
    const horizontal = !vertical;
    const delta = (l: number, r: number, u: number, d: number): number => horizontal ? l : u;
    let next = -1;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        const back = (e.key === 'ArrowLeft') || (horizontal && e.key === 'ArrowUp') || (!horizontal && e.key === 'ArrowDown');
        // horizontal: Left/Right = previous/next bay; Up/Down = within bay.
        // vertical: Up/Down = previous/next bay; Left/Right = within bay.
        const within = horizontal
          ? (e.key === 'ArrowUp' || e.key === 'ArrowDown')
          : (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
        const forwardDir = horizontal
          ? e.key === 'ArrowDown'
          : e.key === 'ArrowRight';
        if (within) {
          // berth order within a bay: lower, middle, upper, 2nd lower, 2nd middle, 2nd upper, side lower, side upper
          const orderPos = focused ? Number(focused.dataset.stack) * 2 + (focused.dataset.side === '1' ? 6 + (forwardDir ? 1 : 0) : (focused.dataset.stack ? 3 : 0) % 2) : 0;
          void orderPos;
          if (!focused) { next = 0; break; }
          const bayOf = Number(focused.dataset.bay);
          const berthOf = Number(focused.dataset.berth);
          const posInBay = ((berthOf - 1) % 8); // 0..7 in berth number order
          // map berth number to the keyboard order: 1,2,3,4,5,6 -> LB,MB,UB x2 then 7 SL, 8 SU
          const kbOrder = (p: number): number => p; // berth numbers already in bay order 1..8
          const cur = kbOrder(posInBay);
          const targetPos = forwardDir ? cur + 1 : cur - 1;
          if (targetPos < 0 || targetPos > 7) { next = -2; break; } // at the edge: stay
          const candidate = all.find((b) => Number(b.dataset.bay) === bayOf && ((Number(b.dataset.berth) - 1) % 8) === targetPos);
          next = candidate ? all.indexOf(candidate) : -2;
        } else {
          if (!focused) { next = 0; break; }
          const bayOf = Number(focused.dataset.bay);
          const posInBay = (Number(focused.dataset.berth) - 1) % 8;
          const targetBay = back ? bayOf - 1 : bayOf + 1;
          if (targetBay < 1 || targetBay > 9) { next = -2; break; }
          const candidate = all.find((b) =>
            Number(b.dataset.bay) === targetBay && ((Number(b.dataset.berth) - 1) % 8) === posInBay);
          next = candidate ? all.indexOf(candidate) : -2;
        }
        break;
      }
      case 'Home': case 'End': {
        if (!focused) { next = 0; break; }
        const posInBay = (Number(focused.dataset.berth) - 1) % 8;
        const targetBay = e.key === 'Home' ? 1 : 9;
        const candidate = all.find((b) =>
          Number(b.dataset.bay) === targetBay && ((Number(b.dataset.berth) - 1) % 8) === posInBay);
        next = candidate ? all.indexOf(candidate) : -2;
        break;
      }
      default: return;
    }
    e.preventDefault();
    if (next === -2 || next === -1 || next === idx) {
      if (focused) focused.focus();
      return;
    }
    const targetEl = all[next];
    if (targetEl) {
      targetEl.focus();
      targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  });

  planWrap.addEventListener('focusin', () => {
    // focus the berth that last had focus in the shown coach, or berth 1
    if (!planWrap.contains(document.activeElement) || document.activeElement === planWrap) {
      const all = Array.from(planWrap.querySelectorAll<HTMLElement>('button.berth'));
      (lastFocused.get(selectedCoach) ?? all[0])?.focus();
    }
  });

  planWrap.addEventListener('focusout', (e) => {
    const btn = (e.target as HTMLElement).closest?.('.berth');
    if (btn) lastFocused.set(selectedCoach, btn as HTMLElement);
  });

  planWrap.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest?.('.berth');
    if (btn && handlers.onPick) {
      const berth = coachData.berths.find((b) => String(b.berth) === (btn as HTMLElement).dataset.berth)!;
      handlers.onPick(selectedCoach, berth.berth, berth.type);
    }
  });

  container.appendChild(svg);
}

const lastFocused = new Map<string, HTMLElement>();

/** PageUp / PageDown: previous or next coach of the class. */
export function coachPageKey(
  container: HTMLElement, coaches: string[], getCurrent: () => string, onSwitch: (coach: string) => void,
): void {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
    const idx = Math.max(0, coaches.indexOf(getCurrent()));
    const target = e.key === 'PageUp' ? idx - 1 : idx + 1;
    e.preventDefault();
    if (target < 0 || target >= coaches.length) return; // at the edge, focus stays
    onSwitch(coaches[target]);
  });
}
