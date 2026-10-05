import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { NotificationsService } from './notifications.service';

const readBody = z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid()).max(500)]) });

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() a: Actor, @Query('unread') unread?: string, @Query('limit') limit?: string) {
    return this.svc.list(a, { unread: unread === '1' || unread === 'true', limit: Number(limit) || 50 });
  }

  @Get('unread-count')
  count(@CurrentUser() a: Actor) {
    return this.svc.unreadCount(a);
  }

  @Post('read')
  read(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.svc.markRead(a, parse(readBody, b).ids);
  }
}
