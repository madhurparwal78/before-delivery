import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { DbService } from '../db.service';
import { filterExamples, MODELS, PLANS } from '../../shared/catalog';

@Controller('api')
export class CatalogController {
  constructor(private readonly db: DbService) {}

  @Get('health')
  async health() {
    try {
      await this.db.query('select 1');
    } catch {
      throw new HttpException({ error: 'database_unavailable' }, 503);
    }
    return { status: 'ok' };
  }

  @Get('plans')
  plans() {
    return PLANS;
  }

  @Get('models')
  models() {
    return MODELS.map(({ id, name, kind, credits_per_unit }) => ({ id, name, kind, credits_per_unit }));
  }

  @Get('examples')
  examples(@Query('category') category?: string, @Query('search') search?: string) {
    const items = filterExamples(category, search);
    return { items, total: items.length };
  }
}
