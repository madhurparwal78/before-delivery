import { CanActivate, ExecutionContext, HttpException, Injectable, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthService, MemberContext } from './auth.service';
import { SESSION_COOKIE } from './tokens';

export interface SessionRequest extends Request {
  member?: MemberContext;
}

export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[SESSION_COOKIE] ?? null;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const member = await this.auth.resolveSession(tokenFromRequest(request));
    if (!member) throw new HttpException({ error: 'Sign in to continue.' }, 401);
    request.member = member;
    return true;
  }
}

export const Member = createParamDecorator((_data: unknown, context: ExecutionContext): MemberContext => {
  return context.switchToHttp().getRequest<SessionRequest>().member as MemberContext;
});
