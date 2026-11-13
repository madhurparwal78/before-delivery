import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSeedState } from './seed.ts';
import type { StoreState } from './types.ts';

/** One embedded file store per serving instance, separated by its port. */
export class Store {
  private readonly file: string;
  private state: StoreState;

  constructor(directory: string, port: number) {
    this.file = join(directory, `slackwater-${port}.json`);
    mkdirSync(dirname(this.file), { recursive: true });
    if (existsSync(this.file)) {
      this.state = JSON.parse(readFileSync(this.file, 'utf8')) as StoreState;
    } else {
      this.state = buildSeedState(Date.now());
      this.write();
    }
  }

  /** Reads see the live state; every change goes through mutate. */
  read(): StoreState {
    return this.state;
  }

  /** The body runs to completion with no await inside, so each change is applied atomically. */
  mutate<T>(body: (state: StoreState) => T): T {
    const result = body(this.state);
    this.write();
    return result;
  }

  nextId(counter: string, prefix: string): string {
    const current = this.state.counters[counter] ?? 1000;
    const next = current + 1;
    this.state.counters[counter] = next;
    return `${prefix}-${next}`;
  }

  private write(): void {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state), 'utf8');
    renameSync(temporary, this.file);
  }
}
