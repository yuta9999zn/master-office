import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { MacroTriggersService } from './macro-triggers.service';

const schedule = z.object({
  every: z.enum(['minutes', 'hours', 'day', 'week']),
  n: z.number().int().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});
const createBody = z.object({
  macroId: z.string().min(1).max(80),
  fn: z.string().regex(/^[A-Za-z_$][\w$]*$/, 'A function name'),
  kind: z.enum(['time', 'formSubmit']),
  schedule: schedule.nullish(),
});

/** Server-run macro triggers of a spreadsheet (docs/ARCHITECTURE.md §48). */
@Controller()
export class MacroTriggersController {
  constructor(private readonly triggers: MacroTriggersService) {}

  @Get('resources/:id/macro-triggers')
  list(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.triggers.list(a, id);
  }

  @Post('resources/:id/macro-triggers')
  create(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.triggers.create(a, id, parse(createBody, b));
  }

  @Patch('macro-triggers/:id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.triggers.setEnabled(a, id, parse(z.object({ enabled: z.boolean() }), b).enabled);
  }

  @Delete('macro-triggers/:id')
  @HttpCode(204)
  remove(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.triggers.remove(a, id);
  }

  @Post('macro-triggers/:id/run')
  @HttpCode(200)
  run(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.triggers.runNow(a, id);
  }
}
