import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger)); // Use pino logger

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('BACKit on Stellar API')
    .setDescription(
      'API documentation for BACKit — Blockchain Asset Call Kit on Stellar. ' +
        'A prediction market platform for cryptocurrency trading calls.',
    )
    .setVersion('1.0.0')
    .setContact(
      'BACKit Team',
      'https://github.com/degenspot/BACKit-onStellar',
      'support@backit.io',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(
      `http://localhost:${process.env.PORT || 3001}`,
      'Local Development',
    )
    .addServer('https://api.backit.io', 'Production')
    .addTag('health', 'Health check and monitoring endpoints')
    .addTag('auth', 'Stellar challenge-response authentication')
    .addTag('calls', 'Trading call management')
    .addTag('oracle', 'Oracle and price resolution')
    .addTag('Analytics', 'User and platform analytics')
    .addTag('users', 'User profiles and social graph')
    .addTag('indexer', 'Soroban event indexer')
    .addTag('notifications', 'In-app notifications')
    .addTag('search', 'Full-text search')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'BACKit API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true,
      syntaxHighlight: { activate: true, theme: 'monokai' },
    },
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);

  const logger = app.get(Logger);

  logger.log(`🚀 Backend running on http://localhost:${port}`, 'Bootstrap');
  logger.log(
    `📚 Swagger documentation available at http://localhost:${port}/api/docs`,
    'Bootstrap',
  );
  logger.log(
    `📊 API JSON spec available at http://localhost:${port}/api/docs-json`,
    'Bootstrap',
  );
  logger.log(
    `💚 Health check available at http://localhost:${port}/health`,
    'Bootstrap',
  );
  logger.log(
    `🔌 WebSocket gateway available at ws://localhost:${port}/ws`,
    'Bootstrap',
  );
  logger.log(
    `🌍 Environment: ${process.env.NODE_ENV || 'development'}`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  const err = error as Error;
  console.error(`Failed to start application: ${err.message}`, err.stack);
  process.exit(1);
});
