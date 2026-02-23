import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [
    /**
     * JwtModule is registered asynchronously so the secret is pulled from
     * ConfigService at runtime, identical to the AuthModule setup.
     */
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway], // export so other modules can call pushNotificationToUser()
})
export class GatewaysModule {}
