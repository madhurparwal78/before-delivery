import { Body, Controller, Get, Headers, HttpCode, HttpException, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { GenerationsService } from './generations.service';
import { Member, SessionGuard } from '../auth/session.guard';
import { MemberContext } from '../auth/auth.service';
import { modelById } from '../../shared/catalog';
import { Aspect, drawArt } from '../../shared/art';

@Controller('api')
@UseGuards(SessionGuard)
export class GenerationsController {
  constructor(private readonly generations: GenerationsService) {}

  @Get('projects/:id/generations')
  listForProject(@Member() member: MemberContext, @Param('id') id: string) {
    return this.generations.listForProject(member, id);
  }

  @Post('generations')
  async start(
    @Member() member: MemberContext,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const key = typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : null;
    const { generation, created } = await this.generations.start(member, body, key);
    response.status(created ? 201 : 200);
    return generation;
  }

  @Get('generations/:id')
  read(@Member() member: MemberContext, @Param('id') id: string) {
    return this.generations.read(member, id);
  }

  @Post('generations/:id/cancel')
  @HttpCode(200)
  cancel(@Member() member: MemberContext, @Param('id') id: string) {
    return this.generations.cancel(member, id);
  }

  @Get('generations/:id/output')
  async output(@Member() member: MemberContext, @Param('id') id: string, @Res() response: Response) {
    const generation = await this.generations.read(member, id);
    if (generation.status !== 'ready') throw new HttpException({ error: 'not_ready' }, 409);
    const model = modelById(generation.model)!;
    const svg = drawArt({
      seed: `${generation.prompt}|${generation.model}|${generation.aspect}`,
      aspect: generation.aspect as Aspect,
      animated: model.kind === 'video',
      loopSeconds: generation.duration ?? 10,
      title: generation.prompt
    });
    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.send(svg);
  }
}
