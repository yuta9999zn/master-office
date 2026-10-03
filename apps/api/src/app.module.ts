import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CollabService } from './collab/collab.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { CurrentUserMiddleware } from './common/current-user';
import { DbModule } from './db/db.module';
import { DocStore } from './docs/doc-store';
import { DocsController } from './docs/docs.controller';
import { PublishController } from './docs/publish.controller';
import { DocsService } from './docs/docs.service';
import { PdfRenderer } from './docs/pdf-renderer';
import { EventsService } from './events/events.service';
import { PermissionsService } from './permissions/permissions.service';
import { ResourcesController } from './resources/resources.controller';
import { ResourcesService } from './resources/resources.service';
import { SheetsService } from './sheets/sheets.service';
import { SlidesService } from './slides/slides.service';
import { FormsController } from './forms/forms.controller';
import { FormsService } from './forms/forms.service';
import { SearchController } from './search/search.controller';
import { SpacesController } from './spaces/spaces.controller';
import { SpacesService } from './spaces/spaces.service';
import { SpellingController } from './spelling/spelling.controller';
import { SpellingService } from './spelling/spelling.service';
import { StorageService } from './storage/storage.service';
import { UsersController } from './users/users.controller';
import { WorkspaceController } from './users/workspace.controller';

@Module({
  imports: [DbModule],
  controllers: [UsersController, WorkspaceController, SpacesController, ResourcesController, DocsController, PublishController, CommentsController, SearchController, FormsController, SpellingController],
  providers: [
    SpellingService,
    PermissionsService,
    EventsService,
    StorageService,
    DocStore,
    CollabService,
    PdfRenderer,
    SheetsService,
    SlidesService,
    FormsService,
    DocsService,
    CommentsService,
    ResourcesService,
    SpacesService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CurrentUserMiddleware).forRoutes('*');
  }
}
