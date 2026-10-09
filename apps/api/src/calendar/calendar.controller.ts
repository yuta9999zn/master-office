import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { CalendarService } from './calendar.service';

const recurrence = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(99).default(1),
    until: z.string().datetime({ offset: true }).nullish(),
    count: z.number().int().min(1).max(1000).nullish(),
    byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .nullish();
const eventBody = z.object({
  calendarId: z.string().uuid(),
  kind: z.enum(['event', 'focus', 'ooo']).optional(),
  title: z.string().max(300).default(''),
  description: z.string().max(20_000).nullish(),
  location: z.string().max(500).nullish(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  allDay: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
  recurrence,
  meeting: z.object({ provider: z.enum(['office', 'google', 'zoom', 'teams', 'custom']), url: z.string().max(2000).nullish() }).nullish(),
  color: z.string().max(20).nullish(),
  guests: z.array(z.object({ email: z.string().max(320), name: z.string().max(200).nullish(), optional: z.boolean().optional() })).max(200).optional(),
  attachments: z.array(z.string().uuid()).max(20).optional(),
  notify: z.boolean().optional(),
  message: z.string().max(5000).nullish(),
});
const updateBody = eventBody.partial();
const respondBody = z.object({ response: z.enum(['accepted', 'tentative', 'declined']) });
const calendarBody = z.object({ name: z.string().max(120).optional(), color: z.string().max(20).optional(), timezone: z.string().max(64).optional() });
const csv = (v?: string) => (v ? v.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : undefined);

@Controller('calendar')
export class CalendarController {
  constructor(private readonly cal: CalendarService) {}

  @Get('calendars')
  calendars(@CurrentUser() a: Actor) {
    return this.cal.list(a);
  }

  @Patch('calendars/:id')
  @HttpCode(204)
  updateCalendar(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.cal.updateCalendar(a, id, parse(calendarBody, b));
  }

  @Post('spaces/:spaceId/calendar')
  enable(@CurrentUser() a: Actor, @Param('spaceId', ParseUUIDPipe) spaceId: string, @Body() b: unknown) {
    return this.cal.enableSpaceCalendar(a, spaceId, parse(calendarBody, b ?? {}));
  }

  @Get('people')
  people(@CurrentUser() a: Actor) {
    return this.cal.people(a);
  }

  /** Occurrences in [from, to): ?from=&to=&calendars=id,id&people=id,id */
  @Get('events')
  events(@CurrentUser() a: Actor, @Query('from') from: string, @Query('to') to: string, @Query('calendars') calendarIds?: string, @Query('people') people?: string) {
    return this.cal.range(a, { from, to, calendarIds: csv(calendarIds), people: csv(people) });
  }

  @Get('events/:id')
  event(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.cal.get(a, id);
  }

  @Post('events')
  create(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.cal.create(a, parse(eventBody, b));
  }

  @Patch('events/:id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.cal.update(a, id, parse(updateBody, b));
  }

  /** ?occurrence=<start> removes one occurrence of a series; ?notify=false skips telling the guests. */
  @Delete('events/:id')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('occurrence') occurrence?: string, @Query('notify') notify?: string) {
    return this.cal.remove(a, id, occurrence, notify !== 'false');
  }

  @Post('events/:id/respond')
  respond(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.cal.respond(a, id, parse(respondBody, b).response);
  }
}
