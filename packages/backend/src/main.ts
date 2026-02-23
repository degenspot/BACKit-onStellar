import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Attach the Socket.io WebSocket adapter — required for the EventsGateway
  app.useWebSocketAdapter(new IoAdapter(app));

  // Enable CORS
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
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Setup Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('BACKit on Stellar API')
    .setDescription(
      'API documentation for BACKit - Blockchain Asset Call Kit on Stellar. ' +
      'A prediction market platform for cryptocurrency trading calls.'
    )
    .setVersion('1.0.0')
    .setContact(
      'BACKit Team',
      'https://github.com/degenspot/BACKit-onStellar',
      'support@backit.io'
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(`http://localhost:${process.env.PORT || 3001}`, 'Local Development')
    .addServer('https://api.backit.io', 'Production')
    .addTag('default', 'General API information')
    .addTag('health', 'Health check and monitoring endpoints')
    .addTag('authentication', 'User authentication and registration')
    .addTag('calls', 'Trading call management and predictions')
    .addTag('feed', 'Social feed and posts')
    .addTag('profile', 'User profile management')
    .addTag('create', 'Content creation endpoints')
    .addTag('oracle', 'Oracle and blockchain interaction endpoints')
    .addTag('indexer', 'Event indexer endpoints')
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
    customfavIcon: 'https://docs.nestjs.com/assets/favicon.ico',
    customCss: `
      .swagger-ui .topbar { background-color: #1a1a1a; }
      .swagger-ui .info { margin: 50px 0; }
      .swagger-ui .info .title { font-size: 36px; color: #00d4ff; }
      .swagger-ui .info .description { font-size: 16px; line-height: 1.6; }
      .swagger-ui .scheme-container { background: #fafafa; padding: 15px; }
      .swagger-ui .opblock-tag { font-size: 18px; }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true,
      displayRequestDuration: true,
      defaultModelsExpandDepth: 3,
      defaultModelExpandDepth: 3,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai',
      },
    },
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);

  Logger.log(`🚀 Backend running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`📚 Swagger documentation available at http://localhost:${port}/api/docs`, 'Bootstrap');
  Logger.log(`📊 API JSON spec available at http://localhost:${port}/api/docs-json`, 'Bootstrap');
  Logger.log(`💚 Health check available at http://localhost:${port}/health`, 'Bootstrap');
  Logger.log(`🔌 WebSocket gateway available at ws://localhost:${port}/ws`, 'Bootstrap');
  Logger.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(`Failed to start application: ${error.message}`, error.stack, 'Bootstrap');
  process.exit(1);
});