// Discarding answers older than the person's latest action, storage actions included.

/**
 * Refreshes against the person's own actions: a refresh answer whose request was sent before the answer to the
 * latest action arrived is discarded.
 */
class ActionClock {
  private answers = 0;

  /** The person's own action has answered. */
  answered(): void {
    this.answers += 1;
  }

  /** Taken when a refresh is sent. */
  now(): number {
    return this.answers;
  }

  /** Whether an answer to a refresh sent at `sent` still applies. */
  current(sent: number): boolean {
    return this.answers === sent;
  }
}

/**
 * Storage actions (upload, figure-preview raw read, export, export download) are stamped when sent. Once one has
 * answered, the answer to any storage action sent before it is ignored.
 */
class StorageOrder {
  private sent = 0;
  private newestAnswered = 0;

  stamp(): number {
    this.sent += 1;
    return this.sent;
  }

  /** Records the answer to the action stamped `stamp`; false when a later one has already answered. */
  applies(stamp: number): boolean {
    if (stamp < this.newestAnswered) return false;
    this.newestAnswered = stamp;
    return true;
  }
}

export const storageOrder = new StorageOrder();

/** Every own action of the person answers through this one clock (the project view's `act`, saves, resolutions). */
export const actions = new ActionClock();
