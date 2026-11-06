import { Controller, Get, UseGuards } from '@nestjs/common';
import { DbService } from '../db.service';
import { Member, SessionGuard } from '../auth/session.guard';
import { MemberContext } from '../auth/auth.service';

@Controller('api/credits')
@UseGuards(SessionGuard)
export class CreditsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async read(@Member() member: MemberContext) {
    const entries = await this.db.query(
      `select c.id, c.kind, c.amount, c.balance_after, u.name as user_name, c.generation_id, c.created_at
         from credit_entries c left join users u on u.id = c.user_id
        where c.workspace_id = $1
        order by c.created_at desc, c.id desc`,
      [member.workspace.id]
    );
    const balance = await this.db.balanceOf(this.db.pool, member.workspace.id);
    return { balance, entries: entries.rows };
  }
}
