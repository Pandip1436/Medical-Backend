import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

// Pin the process timezone to IST. This is a single-region (India) business, so
// every "today" / startOf('day') / expiry-day / reminder-day boundary must be
// computed on the Indian calendar day — NOT the host's timezone. Local dev runs
// in IST but Render/Cloud Run run in UTC, so without this an invoice created
// just after midnight IST (stored as the previous UTC day) silently drops out of
// "Today's Sales" and the Today invoice filter in production. Defaulting via `||`
// still lets an explicit TZ env var override it for testing.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

async function bootstrap() {
  // rawBody: true preserves the original request Buffer at req.rawBody so
  // webhook controllers (Razorpay, Meta WhatsApp) can verify HMAC-SHA256
  // signatures against the EXACT bytes the provider signed. JSON re-encoding
  // would change whitespace/key order and break signature verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // The `verify` callback captures the raw request Buffer at req.rawBody
  // BEFORE the JSON body is parsed. Webhook controllers (Razorpay, Meta
  // WhatsApp) use the raw bytes to verify HMAC-SHA256 signatures — re-
  // encoding the parsed JSON would change whitespace/key order and break
  // signature verification.
  //
  // We attach this on the express json() middleware (rather than relying on
  // NestJS's built-in rawBody: true) because that flag is overridden the
  // moment we register `app.use(json(...))` with our own size limit.
  app.use(
    json({
      limit: '50mb',
      verify: (req: any, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  const config = new DocumentBuilder()
    .setTitle('PBIMS API')
    .setDescription('Pharma Billing & Inventory Management System API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
