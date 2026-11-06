import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService, MemberContext } from './auth.service';
import { Member, SessionGuard } from './session.guard';
import { SESSION_COOKIE } from './tokens';
import { DbService } from '../db.service';

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

@Controller('api')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DbService
  ) {}

  @Post('auth/signup')
  @HttpCode(201)
  async signUp(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.signUp(body);
    setSessionCookie(response, result.token);
    return result;
  }

  @Post('auth/login')
  @HttpCode(200)
  async logIn(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.logIn(body);
    setSessionCookie(response, result.token);
    return result;
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async logOut(@Member() member: MemberContext, @Res({ passthrough: true }) response: Response) {
    await this.auth.logOut(member.user.id);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Member() member: MemberContext) {
    const balance = await this.db.balanceOf(this.db.pool, member.workspace.id);
    return { user: member.user, workspace: member.workspace, balance };
  }
}
