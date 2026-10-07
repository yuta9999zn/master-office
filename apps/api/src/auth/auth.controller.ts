import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentUser, readCookie } from '../common/current-user';
import { parse } from '../common/validation';
import { config } from '../config';
import { OrgService } from '../admin/org.service';
import { AuthService, SESSION_COOKIE, SESSION_DAYS } from './auth.service';

const meta = (req: Request) => ({ ua: req.header('user-agent') ?? undefined, ip: req.ip });
const sessionOf = (req: Request) => readCookie(req.header('cookie'), SESSION_COOKIE);

export function setSession(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.header('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

/** Sign-in, sign-out, first-run setup, password resets and invitation links (docs/ARCHITECTURE.md §79). */
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly org: OrgService,
  ) {}

  /** What the web app needs before anything else: set up yet? signed in? dev user switcher on? */
  @Get('auth/session')
  async session(@Req() req: Request) {
    const token = sessionOf(req);
    const actor = token ? await this.auth.actorFor(token) : null;
    return { needsSetup: await this.org.needsSetup(), signedIn: !!actor, dev: config.auth.dev, userId: actor?.id ?? (config.auth.dev ? (req.actor?.id ?? null) : null) };
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: unknown) {
    const { email, password } = parse(z.object({ email: z.string().max(200), password: z.string().max(200) }), b);
    setSession(req, res, await this.auth.login(email, password, meta(req)));
    return { ok: true };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(sessionOf(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie('mo_uid', { path: '/' });
    return { ok: true };
  }

  @Get('auth/password')
  async hasPassword(@CurrentUser() a: Actor) {
    return { hasPassword: await this.auth.hasPassword(a.id) };
  }

  @Post('auth/password')
  @HttpCode(200)
  async changePassword(@CurrentUser() a: Actor, @Req() req: Request, @Body() b: unknown) {
    const { current, password } = parse(z.object({ current: z.string().max(200).optional(), password: z.string().max(200) }), b);
    await this.auth.changePassword(a, current, password, sessionOf(req));
    return { ok: true };
  }

  @Post('auth/forgot')
  @HttpCode(200)
  async forgot(@Req() req: Request, @Body() b: unknown) {
    await this.auth.forgot(parse(z.object({ email: z.string().max(200) }), b).email, req.ip);
    return { ok: true };
  }

  @Get('auth/reset/:token')
  resetInfo(@Param('token') token: string) {
    return this.auth.resetInfo(token);
  }

  @Post('auth/reset/:token')
  @HttpCode(200)
  async reset(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('token') token: string, @Body() b: unknown) {
    setSession(req, res, await this.auth.reset(token, parse(z.object({ password: z.string().max(200) }), b).password, meta(req)));
    return { ok: true };
  }

  // ── First run ────────────────────────────────────────────────────────────

  @Get('setup/status')
  async setupStatus() {
    return { needsSetup: await this.org.needsSetup() };
  }

  @Post('setup')
  async setup(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: unknown) {
    const input = parse(
      z.object({
        orgName: z.string().trim().min(1).max(120),
        mailDomain: z.string().max(120).nullish(),
        name: z.string().trim().min(1).max(120),
        email: z.string().max(200),
        password: z.string().max(200),
        appUrl: z.string().max(300).nullish(),
      }),
      b,
    );
    const r = await this.org.setup(input, meta(req));
    setSession(req, res, r.token);
    return { ok: true };
  }

  // ── Invitation links ─────────────────────────────────────────────────────

  @Get('invitations/:token')
  invitation(@Param('token') token: string) {
    return this.org.invitationInfo(token);
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  async accept(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('token') token: string, @Body() b: unknown) {
    const r = await this.org.accept(token, parse(z.object({ name: z.string().max(120), password: z.string().max(200) }), b), meta(req));
    setSession(req, res, r.token);
    return { ok: true };
  }
}
