import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { MailService } from './mail.service';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session.guard';
import { AuthController } from './auth/auth.controller';
import { CatalogController } from './public/catalog.controller';
import { EnquiriesController } from './public/enquiries.controller';
import { ProjectsController } from './studio/projects.controller';
import { GenerationsController } from './studio/generations.controller';
import { GenerationsService } from './studio/generations.service';
import { CreditsController } from './studio/credits.controller';
import { InvitationsController, TeamController } from './studio/team.controller';
import { TeamService } from './studio/team.service';
import { RendererService } from './studio/renderer.service';
import { PagesController } from './pages.controller';

@Module({
  controllers: [
    CatalogController,
    EnquiriesController,
    AuthController,
    ProjectsController,
    GenerationsController,
    CreditsController,
    TeamController,
    InvitationsController,
    PagesController
  ],
  providers: [DbService, MailService, AuthService, SessionGuard, GenerationsService, TeamService, RendererService]
})
export class AppModule {}
