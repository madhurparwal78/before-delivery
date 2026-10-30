// The darkroom (postcard store) and the post office (mail server): every request tries them
// afresh, reusing a failure for at most 5 seconds, so a returning service works without a restart.
import { ApiError } from "./errors";
import { probeBucket } from "./s3";
import { probeMailServer } from "./smtp";

const FAILURE_REUSE_MS = 5000;
const STATUS_REUSE_MS = 2000;

class Dependency {
  private failedAt = 0;
  private lastProbe: { at: number; open: boolean } | null = null;

  constructor(
    private readonly code: "darkroom_closed" | "post_office_closed",
    private readonly probe: () => Promise<void>,
  ) {}

  /** Runs work against the service; any failure answers the service's 503. */
  async use<T>(work: () => Promise<T>): Promise<T> {
    if (Date.now() - this.failedAt < FAILURE_REUSE_MS) throw new ApiError(503, this.code);
    try {
      const result = await work();
      this.failedAt = 0;
      return result;
    } catch {
      this.failedAt = Date.now();
      this.lastProbe = null;
      throw new ApiError(503, this.code);
    }
  }

  async isOpen(): Promise<boolean> {
    const now = Date.now();
    if (this.lastProbe && now - this.lastProbe.at < STATUS_REUSE_MS) return this.lastProbe.open;
    const open = await this.use(this.probe).then(
      () => true,
      () => false,
    );
    this.lastProbe = { at: Date.now(), open };
    return open;
  }
}

export const darkroom = new Dependency("darkroom_closed", probeBucket);
export const postOffice = new Dependency("post_office_closed", probeMailServer);
