import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { TeamService } from './team.service';
import { Member, SessionGuard } from '../auth/session.guard';
import { MemberContext } from '../auth/auth.service';
import { setSessionCookie } from '../auth/auth.controller';

@Controller('api/team')
@UseGuards(SessionGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  read(@Member() member: MemberContext) {
    return this.team.read(member);
  }

  @Post('invitations')
  @HttpCode(201)
  invite(@Member() member: MemberContext, @Body() body: Record<string, unknown>) {
    return this.team.invite(member, body);
  }

  @Delete('invitations/:id')
  revoke(@Member() member: MemberContext, @Param('id') id: string) {
    return this.team.revoke(member, id);
  }

  @Delete('members/:id')
  removeMember(@Member() member: MemberContext, @Param('id') id: string) {
    return this.team.removeMember(member, id);
  }
}

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly team: TeamService) {}

  @Get(':token')
  read(@Param('token') token: string) {
    return this.team.readInvitation(token);
  }

  @Post(':token')
  @HttpCode(201)
  async accept(
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.team.accept(token, body);
    setSessionCookie(response, result.token);
    return result;
  }
}
