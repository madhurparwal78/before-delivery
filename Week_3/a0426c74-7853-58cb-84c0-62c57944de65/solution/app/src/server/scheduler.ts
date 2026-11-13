import { clock } from './clock.ts';

type Task = () => void | Promise<void>;
interface Item { dueAt: number; order: number; run: Task; cancelled: boolean }

const TICK_MS = 100;

/**
 * Deadlines on the server clock: a min-heap ordered by due time (then by scheduling order). It is ticked about every 100 ms of real
 * time and drained synchronously after the grading clock moves; every due item runs, in due order, and may schedule more.
 */
class Scheduler {
  private readonly heap: Item[] = [];
  private counter = 0;
  private draining: Promise<void> = Promise.resolve();
  private ticker: NodeJS.Timeout | null = null;

  /** Runs `run` once the server clock reaches `dueAt` (ms). The returned function cancels it. */
  schedule(dueAt: number, run: Task): () => void {
    const item: Item = { dueAt, order: this.counter++, run, cancelled: false };
    this.push(item);
    return () => {
      item.cancelled = true;
    };
  }

  /** Runs everything that is due now and resolves when the last item (and anything it scheduled) has finished. */
  runDue(): Promise<void> {
    this.draining = this.draining.then(() => this.drain());
    return this.draining;
  }

  start(): void {
    this.ticker = setInterval(() => void this.runDue(), TICK_MS);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private async drain(): Promise<void> {
    for (let item = this.nextDue(); item; item = this.nextDue()) {
      try {
        await item.run();
      } catch (error) {
        console.error('scheduled task failed', error);
      }
    }
  }

  private nextDue(): Item | null {
    while (this.heap.length > 0) {
      const top = this.heap[0];
      if (top.cancelled) {
        this.pop();
        continue;
      }
      if (top.dueAt > clock.now()) return null;
      return this.pop();
    }
    return null;
  }

  private before(a: Item, b: Item): boolean {
    return a.dueAt < b.dueAt || (a.dueAt === b.dueAt && a.order < b.order);
  }

  private push(item: Item): void {
    this.heap.push(item);
    let child = this.heap.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.before(this.heap[child], this.heap[parent])) break;
      [this.heap[child], this.heap[parent]] = [this.heap[parent], this.heap[child]];
      child = parent;
    }
  }

  private pop(): Item {
    const top = this.heap[0];
    const last = this.heap[this.heap.length - 1];
    this.heap.length -= 1;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.heap.length && this.before(this.heap[left], this.heap[smallest])) smallest = left;
        if (right < this.heap.length && this.before(this.heap[right], this.heap[smallest])) smallest = right;
        if (smallest === parent) break;
        [this.heap[parent], this.heap[smallest]] = [this.heap[smallest], this.heap[parent]];
        parent = smallest;
      }
    }
    return top;
  }
}

export const scheduler = new Scheduler();
