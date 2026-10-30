import { Module } from '@nestjs/common';
import { AuthController, AuthService } from './auth.js';
import { CatalogController } from './catalog.controller.js';
import { CreditsController, CreditsService } from './credits.js';
import { Database } from './database.js';
import { EnquiriesController } from './enquiries.js';
import { GenerationProgress, GenerationsController, GenerationsService } from './generations.js';
import { Mailer } from './mail.js';
import { ProjectsController } from './projects.js';
import { InvitationsController, TeamController, TeamService } from './team.js';

@Module({
  controllers: [
    CatalogController,
    AuthController,
    ProjectsController,
    GenerationsController,
    CreditsController,
    TeamController,
    InvitationsController,
    EnquiriesController,
  ],
  providers: [Database, Mailer, CreditsService, AuthService, GenerationsService, GenerationProgress, TeamService],
})
export class AppModule {}
