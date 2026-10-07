import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { ContactsService } from './contacts.service';

const text = (max: number) => z.string().max(max).nullish();
const updateBody = z.object({
  phone: text(40),
  location: text(120),
  status: text(140),
  skills: z.array(z.string().max(40)).max(20).optional(),
  title: text(120),
  department: text(120),
  managerId: z.string().uuid().nullish(),
  phoneVisibility: z.enum(['leads', 'everyone']).optional(),
});

@Controller('contacts')
export class ContactsController {
  constructor(private readonly svc: ContactsService) {}

  @Get()
  list(@CurrentUser() a: Actor, @Query('q') q?: string) {
    return this.svc.list(a, q);
  }

  @Get(':id')
  profile(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.profile(a, id);
  }

  @Patch(':id')
  update(@CurrentUser() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.update(a, id, parse(updateBody, b));
  }
}
