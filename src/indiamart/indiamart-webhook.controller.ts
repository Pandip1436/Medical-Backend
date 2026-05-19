import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IndiamartService } from './indiamart.service';

// Public-facing webhook endpoint. IndiaMART POSTs every new lead here.
//
// AUTH MODEL: URL secrecy only — IndiaMART doesn't send any auth headers,
// so the unguessable `webhookToken` in the path is the only protection.
// Tokens are 32 bytes of randomness (256 bits of entropy); brute-forcing
// is not practical and we never log the token plainly.
//
// Lives in its OWN controller (separate from IndiamartController) because
// it needs to bypass the JwtAuthGuard / RolesGuard that the admin
// controller mounts via @UseGuards. Nest applies guards per-controller, so
// keeping the webhook in its own controller without any @UseGuards
// decorator leaves it open as required.
@ApiTags('integrations:indiamart')
@Controller('api/v1/integrations/indiamart/webhook')
export class IndiamartWebhookController {
  private readonly logger = new Logger(IndiamartWebhookController.name);

  constructor(private readonly svc: IndiamartService) {}

  // Health-check endpoint for the test pop-up in IndiaMART's panel. Some
  // IndiaMART test tooling does a GET on the configured URL before pushing,
  // and returning anything other than 2xx flags the URL as broken in their
  // logs. A plain JSON 200 here keeps the activation flow smooth.
  @Get(':token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe used by IndiaMART activation flow' })
  ping(@Param('token') _token: string) {
    return { status: 'ok' };
  }

  @Post(':token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive a single lead push from IndiaMART (token in URL path)',
  })
  async receive(
    @Param('token') token: string,
    @Body() payload: Record<string, unknown>,
  ) {
    // Never log the token — it's the credential.
    const result = await this.svc.handleIncomingPush(token, payload ?? {});
    // IndiaMART only checks for HTTP 200; body is informational and helps
    // when we replay the request from their logs UI.
    return {
      status: 'received',
      unique_query_id: result.unique_query_id,
    };
  }
}
