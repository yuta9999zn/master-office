import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentUser } from '../common/current-user';
import { parse } from '../common/validation';
import { SpellingService } from './spelling.service';

const word = z.string().trim().min(1).max(60).regex(/^[\p{L}'’-]+$/u, 'A single word');

@Controller('spelling')
export class SpellingController {
  constructor(private readonly spelling: SpellingService) {}

  @Post('check')
  @HttpCode(200)
  check(@CurrentUser() a: Actor, @Body() b: unknown) {
    const { words } = parse(z.object({ words: z.array(z.string().max(60)).max(5000) }), b);
    return this.spelling.check(a, words);
  }

  @Get('dictionary')
  dictionary(@CurrentUser() a: Actor) {
    return this.spelling.dictionary(a);
  }

  @Post('dictionary')
  add(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.spelling.add(a, parse(z.object({ word }), b).word);
  }

  /** Body `{words}` (several at once from the Personal dictionary dialog). */
  @Delete('dictionary')
  remove(@CurrentUser() a: Actor, @Body() b: unknown) {
    return this.spelling.remove(a, parse(z.object({ words: z.array(word).min(1).max(500) }), b).words);
  }
}
