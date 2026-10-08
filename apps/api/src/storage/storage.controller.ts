import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { type Actor, CurrentUser } from '../common/current-user';
import { QuotaService } from './quota.service';

/** How full my storage (or a team's) is — the meter in Drive (§79 C). */
@Controller('storage')
export class StorageController {
  constructor(private readonly quota: QuotaService) {}

  @Get('me')
  me(@CurrentUser() a: Actor) {
    return this.quota.status(a, 'user', a.id);
  }

  @Get('space/:id')
  space(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quota.status(a, 'space', id);
  }
}
