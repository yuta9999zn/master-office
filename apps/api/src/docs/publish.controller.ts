import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocsService } from './docs.service';

/** Published pages (File → Publish to web): the token in the link is the permission. */
@Controller('pub')
export class PublishController {
  constructor(private readonly docs: DocsService) {}

  @Get(':token')
  async page(@Param('token') token: string, @Query('embed') embed: string | undefined, @Res() res: Response) {
    const { html } = await this.docs.published(token, embed === '1' || embed === 'true');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Short cache: edits show up within a minute; embeddable anywhere (it is meant to be public).
    res.setHeader('Cache-Control', 'public, max-age=60');
    // Sandboxed (§85 B): the page gets a unique origin, so even injected markup cannot use the viewer's session;
    // allow-scripts keeps the slide navigation of published decks working. Embeddable anywhere (it is public).
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-popups allow-forms; frame-ancestors *');
    res.send(html);
  }
}
