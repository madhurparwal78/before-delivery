import type { AppConfig } from '../config';

export interface PushMessage {
  title: string;
  message: string;
}

export class Alerts {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.ntfy.url}/v1/health`, { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async push(push: PushMessage): Promise<void> {
    const response = await fetch(`${this.config.ntfy.url}/${this.config.ntfy.topic}`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.config.ntfy.username}:${this.config.ntfy.password}`).toString('base64'),
        Title: push.title,
      },
      body: push.message,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error('unreachable');
    }
  }
}
