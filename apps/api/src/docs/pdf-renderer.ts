import { Injectable, Logger, type OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { DEFAULT_PAGE_SETUP, expandTokens, type PageSetup } from '@workos/doc-model';
import type { Browser } from 'playwright';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Header/footer template for Chromium: {page}/{pages} become the live page counters. */
function template(text: string, align: PageSetup['headerAlign'], title: string) {
  if (!text) return '<span></span>';
  const html = esc(expandTokens(text, { title, page: '\u0001', pages: '\u0002' }))
    .replace('\u0001', '<span class="pageNumber"></span>')
    .replace('\u0002', '<span class="totalPages"></span>');
  return `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:9px;color:#64748b;padding:0 12mm;text-align:${align}">${html}</div>`;
}

/** HTML → PDF with headless Chromium (docs/ARCHITECTURE.md §8). One browser is shared and reused. */
@Injectable()
export class PdfRenderer implements OnApplicationShutdown {
  private readonly log = new Logger('PdfRenderer');
  private browser: Promise<Browser> | null = null;

  private async getBrowser() {
    if (!this.browser) {
      this.browser = import('playwright').then(({ chromium }) => chromium.launch());
      this.browser.catch(() => (this.browser = null));
    }
    try {
      return await this.browser;
    } catch (e) {
      this.log.error((e as Error).message);
      throw new ServiceUnavailableException('PDF export needs Chromium: run `pnpm --filter @workos/api exec playwright install chromium`');
    }
  }

  /** Page size and margins come from the document's @page rule; header/footer from the page setup. */
  async render(html: string, opts: { pageSetup?: PageSetup; title?: string } = {}): Promise<Buffer> {
    const p = opts.pageSetup ?? DEFAULT_PAGE_SETUP;
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const withHF = !!(p.header || p.footer);
      return await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: withHF,
        headerTemplate: template(p.header, p.headerAlign, opts.title ?? ''),
        footerTemplate: template(p.footer, p.footerAlign, opts.title ?? ''),
      });
    } finally {
      await page.close();
    }
  }

  /** One PNG per `.page` element (slides), rendered at 2× for crisp text. */
  async screenshots(html: string, size: { w: number; h: number }): Promise<Buffer[]> {
    const browser = await this.getBrowser();
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2 });
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const out: Buffer[] = [];
      for (const el of await page.locator('.page').all()) out.push(await el.screenshot({ type: 'png' }));
      return out;
    } finally {
      await page.close();
    }
  }

  async onApplicationShutdown() {
    const b = await this.browser?.catch(() => null);
    await b?.close();
  }
}
