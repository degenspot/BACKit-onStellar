import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // URI-based API versioning: /api/v1/... (defaultVersion covers all unversioned routes)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Global exception filter — standardised { statusCode, error, message, timestamp, path }
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global exception filter — standardised { statusCode, error, message, timestamp, path }
  app.useGlobalFilters(new GlobalExceptionFilter());

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

  Logger.log(`🚀 Backend running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(
    `📚 Swagger docs at http://localhost:${port}/api/docs`,
    'Bootstrap',
  );
  Logger.log(`💚 Health check at http://localhost:${port}/health`, 'Bootstrap');
  Logger.log(
    `🌍 Environment: ${process.env.NODE_ENV || 'development'}`,
    'Bootstrap',
  );
}

bootstrap().catch((error) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  Logger.error(`Failed to start: ${error.message}`, error.stack, 'Bootstrap');
  process.exit(1);
});
