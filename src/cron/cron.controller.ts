import { Controller, Post, Get, Headers, HttpCode, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { CronService } from './cron.service';

// PUBLIC ENDPOINT — called by an external scheduler (Cloud Scheduler, GitHub
// Actions, cron), so it carries no JWT. Deliberately NOT behind JwtAuthGuard;
// authentication is a shared secret in the X-Cron-Secret header instead.
//
// The whole point is that this runs when nobody is logged in — see CronService
// for why in-process timers cannot be used on Cloud Run.
@Controller('api/v1/cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(private readonly cron: CronService) {}

  @Post('tick')
  @HttpCode(200)
  async tick(@Headers('x-cron-secret') secret?: string) {
    this.assertAuthorised(secret);
    return this.cron.tick();
  }

  // Some schedulers (and uptime pingers) only issue GETs. Same guard, same work.
  @Get('tick')
  async tickViaGet(@Headers('x-cron-secret') secret?: string) {
    this.assertAuthorised(secret);
    return this.cron.tick();
  }

  private assertAuthorised(provided?: string): void {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      // Fail closed. An unset secret must never mean "open to the internet" —
      // this endpoint triggers customer-facing WhatsApp sends.
      this.logger.error('CRON_SECRET is not set — refusing to run the tick.');
      throw new UnauthorizedException('Cron endpoint is not configured');
    }
    const a = Buffer.from(provided ?? '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    // Length check first: timingSafeEqual throws on mismatched lengths.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.logger.warn('cron tick rejected — bad or missing X-Cron-Secret');
      throw new UnauthorizedException('Invalid cron secret');
    }
  }
}
