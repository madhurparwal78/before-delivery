import { api, motionDuration, qs, qsa, reducedMotion } from './core.js';

export type GaugeBag = {
  sku: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
};

export type Airline = {
  code: string;
  name: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
};

let airlines: Airline[] = [];
let settleTimer = 0;

export async function loadAirlines(): Promise<Airline[]> {
  if (airlines.length > 0) return airlines;
  airlines = await api<Airline[]>('/api/airlines');
  return airlines;
}

function airlineByCode(code: string): Airline | undefined {
  return airlines.find((airline) => airline.code === code);
}

function valueText(value: number, max: number): string {
  if (value <= 0) return 'Outside the frame';
  if (value >= max) return 'Inside the frame';
  if (value >= max - 20) return 'Inside the frame';
  if (value >= 20) return 'Touching the frame';
  return 'Outside the frame';
}

export class GateGauge {
  private readonly root: HTMLElement;
  private bags: GaugeBag[];
  private selected: string;
  private airlineCode: string;

  constructor(root: HTMLElement, bags: GaugeBag[]) {
    this.root = root;
    this.bags = bags;
    this.selected = bags[0]?.sku ?? '';
    this.airlineCode = root.dataset.airline ?? 'skyline-indus';
    this.attach();
  }

  setBags(bags: GaugeBag[]): void {
    this.bags = bags;
    if (!bags.some((bag) => bag.sku === this.selected)) this.selected = bags[0]?.sku ?? '';
    void this.refresh(true);
  }

  private currentBag(): GaugeBag | undefined {
    return this.bags.find((bag) => bag.sku === this.selected) ?? this.bags[0];
  }

  private slider(): HTMLElement | null {
    return qs<HTMLElement>('[data-gauge-bag]', this.root);
  }

  private maxValue(): number {
    const airline = airlineByCode(this.airlineCode);
    return 20 + (airline?.width_cm ?? 40);
  }

  private attach(): void {
    const slider = this.slider();
    if (slider !== null) {
      slider.addEventListener('keydown', (event: KeyboardEvent) => this.onKey(event));
      slider.addEventListener('pointerdown', (event: PointerEvent) => this.onPointerDown(event));
    }

    for (const option of qsa<HTMLElement>('[data-airline-option]', this.root)) {
      option.addEventListener('click', () => this.chooseAirline(option.dataset.airlineOption ?? ''));
    }
    const airlineGroup = qs<HTMLElement>('[data-airline-group]', this.root);
    airlineGroup?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const options = qsa<HTMLElement>('[data-airline-option]', this.root);
      const index = options.findIndex((option) => option.dataset.airlineOption === this.airlineCode);
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      const next = options[(index + step + options.length) % options.length];
      this.chooseAirline(next.dataset.airlineOption ?? '');
      next.focus();
    });

    for (const option of qsa<HTMLElement>('[data-bag-option]', this.root)) {
      option.addEventListener('click', () => {
        this.selected = option.dataset.bagOption ?? '';
        for (const radio of qsa<HTMLElement>('[data-bag-option]', this.root)) {
          const on = radio === option;
          radio.setAttribute('aria-checked', on ? 'true' : 'false');
          radio.setAttribute('tabindex', on ? '0' : '-1');
        }
        void this.refresh(true);
      });
    }

    void loadAirlines().then(() => this.refresh(true));
  }

  private chooseAirline(code: string): void {
    if (code === '') return;
    this.airlineCode = code;
    this.root.dataset.airline = code;
    for (const option of qsa<HTMLElement>('[data-airline-option]', this.root)) {
      const on = option.dataset.airlineOption === code;
      option.setAttribute('aria-checked', on ? 'true' : 'false');
      option.setAttribute('tabindex', on ? '0' : '-1');
    }
    const params = new URLSearchParams(window.location.search);
    params.set('airline', code);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString().replace(/%2C/g, ',')}`);
    void this.refresh(true);
  }

  private onKey(event: KeyboardEvent): void {
    const slider = this.slider();
    if (slider === null) return;
    const max = this.maxValue();
    let value = Number(slider.getAttribute('aria-valuenow') ?? '0');
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') value += 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') value -= 1;
    else if (event.key === 'Home') value = 0;
    else if (event.key === 'End') value = max;
    else if (event.key === 'Enter') {
      event.preventDefault();
      void this.settle();
      return;
    } else return;
    event.preventDefault();
    this.setValue(Math.max(0, Math.min(max, value)));
  }

  private onPointerDown(event: PointerEvent): void {
    const slider = this.slider();
    const stage = qs<HTMLElement>('[data-gauge-stage]', this.root);
    if (slider === null || stage === null) return;
    event.preventDefault();
    slider.focus();
    this.root.dataset.state = 'dragging';
    const rect = stage.getBoundingClientRect();
    const max = this.maxValue();

    const move = (moveEvent: PointerEvent): void => {
      const ratio = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / Math.max(1, rect.width)));
      this.setValue(Math.round(ratio * max));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void this.settle();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private setValue(value: number): void {
    const slider = this.slider();
    if (slider === null) return;
    const max = this.maxValue();
    slider.setAttribute('aria-valuemax', String(max));
    slider.setAttribute('aria-valuenow', String(value));
    slider.setAttribute('aria-valuetext', valueText(value, max));
    slider.style.setProperty('--position', String(value));
  }

  private async settle(): Promise<void> {
    const bag = this.currentBag();
    if (bag === undefined) return;
    const fits = await this.verdict(bag);
    const slider = this.slider();
    if (slider === null) return;
    const max = this.maxValue();
    const target = fits ? max : max - 20;
    window.clearTimeout(settleTimer);
    const ms = motionDuration(this.root, 420);
    if (ms === 0 || reducedMotion()) {
      this.setValue(target);
      this.root.dataset.state = 'settled';
      this.root.dataset.settled = fits ? 'inside' : 'edge';
      return;
    }
    this.root.dataset.state = 'settling';
    this.setValue(target);
    settleTimer = window.setTimeout(() => {
      this.root.dataset.state = 'settled';
      this.root.dataset.settled = fits ? 'inside' : 'edge';
    }, Math.min(700, ms + 200));
  }

  private async verdict(bag: GaugeBag): Promise<boolean> {
    try {
      const result = await api<{ fits: boolean; verdict: string }>(
        `/api/fit?sku=${encodeURIComponent(bag.sku)}&airline=${encodeURIComponent(this.airlineCode)}`
      );
      const holder = qs<HTMLElement>('[data-verdict]', this.root);
      if (holder !== null) holder.textContent = result.verdict;
      const cell = qs<HTMLElement>(`[data-verdict-for="${bag.sku}"]`);
      if (cell !== null) cell.textContent = result.verdict;
      this.root.dataset.fits = result.fits ? 'true' : 'false';
      return result.fits;
    } catch {
      return false;
    }
  }

  async refresh(updateDimensions: boolean): Promise<void> {
    await loadAirlines();
    const airline = airlineByCode(this.airlineCode);
    const frame = qs<HTMLElement>('[data-frame]', this.root);
    if (frame !== null && airline !== undefined) {
      frame.style.setProperty('--frame-h', String(airline.height_cm));
      frame.style.setProperty('--frame-w', String(airline.width_cm));
    }
    const bag = this.currentBag();
    if (bag === undefined) return;
    if (updateDimensions) {
      const set = (name: string, text: string): void => {
        const item = qs<HTMLElement>(`[data-dimension="${name}"]`, this.root);
        if (item !== null) item.textContent = text;
      };
      set('height', `Height ${bag.height_cm} cm`);
      set('width', `Width ${bag.width_cm} cm`);
      set('depth', `Depth ${bag.depth_cm} cm`);
      set('weight', `Weight ${bag.weight_kg} kg`);
    }
    const slider = this.slider();
    if (slider !== null) {
      slider.style.setProperty('--bag-h', String(bag.height_cm));
      slider.style.setProperty('--bag-w', String(bag.width_cm));
    }
    for (const other of this.bags) await this.verdict(other);
    await this.verdict(bag);
    this.setValue(Number(slider?.getAttribute('aria-valuenow') ?? '0'));
  }

  setupTouchDrag(): void {
    const slider = this.slider();
    const stage = qs<HTMLElement>('[data-gauge-stage]', this.root);
    if (slider === null || stage === null) return;
    slider.addEventListener(
      'touchmove',
      (event: TouchEvent) => {
        const rect = stage.getBoundingClientRect();
        const touch = event.touches[0];
        if (touch === undefined) return;
        this.root.dataset.state = 'dragging';
        const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / Math.max(1, rect.width)));
        this.setValue(Math.round(ratio * this.maxValue()));
      },
      { passive: true }
    );
    slider.addEventListener(
      'touchend',
      () => {
        void this.settle();
      },
      { passive: true }
    );
  }
}
