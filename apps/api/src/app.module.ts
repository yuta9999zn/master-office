import { HealthController } from './health.controller';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CalendarController } from './calendar/calendar.controller';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { MeetingsController } from './meetings/meetings.controller';
import { MeetingsService } from './meetings/meetings.service';
import { ProjectDocsController } from './tasks/project-docs.controller';
import { ProjectDocsService } from './tasks/project-docs.service';
import { SprintsController } from './tasks/sprints.controller';
import { SprintsService } from './tasks/sprints.service';
import { TasksController } from './tasks/tasks.controller';
import { TasksService } from './tasks/tasks.service';
import { CalendarService } from './calendar/calendar.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
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
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PermissionsService } from './permissions/permissions.service';
import { RealtimeService } from './realtime/realtime.service';
import { ResourcesController } from './resources/resources.controller';
import { ResourcesService } from './resources/resources.service';
import { SheetsService } from './sheets/sheets.service';
import { MacroTriggersController } from './sheets/macro-triggers.controller';
import { QaController } from './slides/qa.controller';
import { QaService } from './slides/qa.service';
import { MacroTriggersService } from './sheets/macro-triggers.service';
import { SlidesService } from './slides/slides.service';
import { BaseController } from './base/base.controller';
import { FlowService } from './flow/flow.service';
import { FlowRunnerService } from './flow/flow-runner.service';
import { FlowController } from './flow/flow.controller';
import { AiService } from './ai/ai.service';
import { ImageStudioService } from './ai/image-studio';
import { AiController } from './ai/ai.controller';
import { WikiController } from './wiki/wiki.controller';
import { WikiService } from './wiki/wiki.service';
import { BaseService } from './base/base.service';
import { FormsController } from './forms/forms.controller';
import { FormsService } from './forms/forms.service';
import { MailService } from './mail/mail.service';
import { MailController } from './mail/mail.controller';
import { MailboxService } from './mail/mailbox.service';
import { InboundMailService } from './mail/inbound.service';
import { SearchController } from './search/search.controller';
import { SpacesController } from './spaces/spaces.controller';
import { SpacesService } from './spaces/spaces.service';
import { SpellingController } from './spelling/spelling.controller';
import { SpellingService } from './spelling/spelling.service';
import { StorageService } from './storage/storage.service';
import { ContactsController } from './users/contacts.controller';
import { ContactsService } from './users/contacts.service';
import { UsersController } from './users/users.controller';
import { WorkspaceController } from './users/workspace.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AdminController } from './admin/admin.controller';
import { OrgService } from './admin/org.service';
import { SettingsService } from './admin/settings.service';
import { QuotaService } from './storage/quota.service';
import { StorageController } from './storage/storage.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController, UsersController, WorkspaceController, SpacesController, ResourcesController, DocsController, PublishController, CommentsController, SearchController, FormsController, SpellingController, MacroTriggersController, QaController, ChatController, NotificationsController, ContactsController, MailController, CalendarController, TasksController, SprintsController, ProjectDocsController, MeetingsController, ApprovalsController, BaseController, WikiController, AuthController, AdminController, StorageController, FlowController, AiController],
  providers: [
    SpellingService,
    RealtimeService,
    NotificationsService,
    ContactsService,
    ChatService,
    PermissionsService,
    EventsService,
    StorageService,
    QuotaService,
    DocStore,
    CollabService,
    PdfRenderer,
    SheetsService,
    MacroTriggersService,
    QaService,
    SlidesService,
    FormsService,
    BaseService,
    FlowService,
    FlowRunnerService,
    AiService,
    ImageStudioService,
    WikiService,
    SettingsService,
    AuthService,
    OrgService,
    MailService,
    MailboxService,
    InboundMailService,
    CalendarService,
    TasksService,
    SprintsService,
    ProjectDocsService,
    MeetingsService,
    ApprovalsService,
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
