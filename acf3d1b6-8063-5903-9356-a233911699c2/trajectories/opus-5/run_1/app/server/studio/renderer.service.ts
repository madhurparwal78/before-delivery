import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db.service';

const SWEEP_MS = 700;
const QUEUED_FOR = '0.5 seconds';
const RENDERS_FOR = '11 seconds';

/**
 * The server, not the browser, moves a generation from Queued to Rendering to Ready,
 * so it keeps rendering while no page is open.
 */
@Injectable()
export class RendererService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Renderer');
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DbService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      await this.db.query(
        `update generations set status = 'rendering'
          where status = 'queued' and created_at <= now() - interval '${QUEUED_FOR}'`
      );
      await this.db.query(
        `update generations set status = 'ready', finished_at = now()
          where status = 'rendering' and created_at <= now() - interval '${RENDERS_FOR}'`
      );
    } catch (error) {
      this.logger.error(`render sweep failed: ${(error as Error).message}`);
    }
  }
}
