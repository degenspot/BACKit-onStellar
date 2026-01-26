import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('BACKit on Stellar API')
    .setDescription('API documentation for BACKit - Blockchain Asset Call Kit on Stellar')
    .setVersion('1.0')
    .addTag('authentication', 'User authentication and registration')
    .addTag('health', 'Health check endpoints')
    .addTag('oracle', 'Oracle and blockchain interaction endpoints')
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
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 50px 0 }
      .swagger-ui .info .title { font-size: 36px }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  Logger.log(`Backend running on http://localhost:${port}`);
  Logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}
bootstrap();