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
import { JustdialService } from './justdial.service';

// Public-facing webhook endpoint. Just Dial POSTs every new lead here.
// AUTH MODEL: URL secrecy only — the unguessable `webhookToken` in the path is
// the credential. Kept in its own controller (no @UseGuards) so it stays open.
@ApiTags('integrations:justdial')
@Controller('api/v1/integrations/justdial/webhook')
export class JustdialWebhookController {
  private readonly logger = new Logger(JustdialWebhookController.name);

  constructor(private readonly svc: JustdialService) {}

  // Liveness probe — some panels GET the URL before pushing.
  @Get(':token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe used by Just Dial activation flow' })
  ping(@Param('token') _token: string) {
    return { status: 'ok' };
  }

  @Post(':token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive a single lead push from Just Dial (token in URL path)' })
  async receive(
    @Param('token') token: string,
    @Body() payload: Record<string, unknown>,
  ) {
    const result = await this.svc.handleIncomingPush(token, payload ?? {});
    return { status: 'received', unique_query_id: result.unique_query_id };
  }
}
