import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { MODELS, PLANS, findExamples } from '../shared/catalog.js';
import { Database } from './database.js';

@Controller()
export class CatalogController {
  constructor(private readonly db: Database) {}

  @Get('health')
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }

  @Get('plans')
  plans() {
    return PLANS;
  }

  @Get('models')
  models() {
    return MODELS;
  }

  @Get('examples')
  examples(@Query('category') category?: string, @Query('search') search?: string) {
    const items = findExamples(category || undefined, typeof search === 'string' ? search : undefined);
    return { items, total: items.length };
  }
}
