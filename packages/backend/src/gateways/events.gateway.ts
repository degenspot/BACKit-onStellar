import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface StakeCreatedPayload {
  marketId: string;
  stakeId: string;
  userId: string;
  amount: number;
  odds: number;
  selection: string;
  createdAt: string;
}

export interface MarketPriceUpdatedPayload {
  marketId: string;
  prices: Record<string, number>; // selection → price
  updatedAt: string;
}

export interface UserNotificationPayload {
  userId: string;
  type: string;
  message: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

const marketRoom = (marketId: string) => `market:${marketId}`;
const userRoom = (userId: string) => `user:${userId}`;

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

@WebSocketGateway({
  cors: {
    origin: '*', // tighten in production via ConfigService
    credentials: true,
  },
  namespace: '/ws',
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------

  afterInit(server: Server) {
    this.logger.log('WebSocket gateway initialised');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    // Optionally send a welcome event so the client knows the socket is ready
    client.emit('connected', { socketId: client.id });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // -------------------------------------------------------------------------
  // Public subscriptions — Market rooms
  // -------------------------------------------------------------------------

  /**
   * Any client (authenticated or anonymous) can subscribe to a market room
   * to receive live stake events and price updates for that market.
   *
   * Client → server:
   *   emit('market:subscribe', { marketId: 'abc123' })
   *
   * Server → client confirmations:
   *   emit('market:subscribed', { marketId })   on success
   *   emit('error', { message })                on failure
   */
  @SubscribeMessage('market:subscribe')
  handleMarketSubscribe(
    @MessageBody() data: { marketId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { marketId } = data ?? {};

    if (!marketId || typeof marketId !== 'string') {
      client.emit('error', { message: 'marketId is required' });
      return;
    }

    const room = marketRoom(marketId);
    client.join(room);
    this.logger.log(`Socket ${client.id} joined room "${room}"`);

    client.emit('market:subscribed', { marketId });
  }

  /**
   * Unsubscribe from a market room.
   *
   * Client → server:
   *   emit('market:unsubscribe', { marketId: 'abc123' })
   */
  @SubscribeMessage('market:unsubscribe')
  handleMarketUnsubscribe(
    @MessageBody() data: { marketId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { marketId } = data ?? {};

    if (!marketId) return;

    const room = marketRoom(marketId);
    client.leave(room);
    this.logger.log(`Socket ${client.id} left room "${room}"`);

    client.emit('market:unsubscribed', { marketId });
  }

  // -------------------------------------------------------------------------
  // Private subscriptions — User notification rooms (requires JWT)
  // -------------------------------------------------------------------------

  /**
   * Authenticated clients subscribe to their own private notification room.
   *
   * Client → server:
   *   emit('user:subscribe', { token: '<jwt>' })
   *
   * Server → client:
   *   emit('user:subscribed', { userId })   on success
   *   emit('error', { message })            on failure
   */
  @SubscribeMessage('user:subscribe')
  async handleUserSubscribe(
    @MessageBody() data: { token: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { token } = data ?? {};

    if (!token) {
      client.emit('error', {
        message: 'JWT token is required for private subscriptions',
      });
      return;
    }

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });
      const userId: string = payload.sub ?? payload.userId;

      if (!userId)
        throw new Error('Token does not contain a valid user identifier');

      const room = userRoom(userId);
      client.join(room);

      // Store userId on socket data for later reference
      client.data.userId = userId;

      this.logger.log(`Socket ${client.id} joined private room "${room}"`);
      client.emit('user:subscribed', { userId });
    } catch (err) {
      this.logger.warn(
        `Authentication failed for socket ${client.id}: ${(err as Error).message}`,
      );
      client.emit('error', {
        message: 'Authentication failed: invalid or expired token',
      });
    }
  }

  /**
   * Leave the private user room.
   *
   * Client → server:
   *   emit('user:unsubscribe')
   */
  @SubscribeMessage('user:unsubscribe')
  handleUserUnsubscribe(@ConnectedSocket() client: Socket) {
    const userId: string | undefined = client.data.userId;

    if (userId) {
      const room = userRoom(userId);
      client.leave(room);
      delete client.data.userId;
      this.logger.log(`Socket ${client.id} left private room "${room}"`);
      client.emit('user:unsubscribed', { userId });
    }
  }

  // -------------------------------------------------------------------------
  // EventEmitter2 listeners — bridge internal events → WebSocket broadcasts
  // -------------------------------------------------------------------------

  /**
   * Fired by the Stakes service when a new stake is placed.
   * Broadcasts to all clients subscribed to the affected market room.
   *
   * Internal event name: 'stake.created'  (matches Issue 9 convention)
   */
  @OnEvent('stake.created')
  onStakeCreated(payload: StakeCreatedPayload) {
    const room = marketRoom(payload.marketId);
    this.logger.debug(`Broadcasting stake.created to room "${room}"`);
    this.server.to(room).emit('stake:created', payload);
  }

  /**
   * Fired when market prices are updated (e.g. odds change).
   * Broadcasts to all clients in the affected market room.
   *
   * Internal event name: 'market.priceUpdated'
   */
  @OnEvent('market.priceUpdated')
  onMarketPriceUpdated(payload: MarketPriceUpdatedPayload) {
    const room = marketRoom(payload.marketId);
    this.logger.debug(`Broadcasting market.priceUpdated to room "${room}"`);
    this.server.to(room).emit('market:priceUpdated', payload);
  }

  /**
   * Fired when a push notification should be delivered to a specific user.
   * Broadcasts only to the private room of that user.
   *
   * Internal event name: 'notification.push'
   */
  @OnEvent('notification.push')
  onNotificationPush(payload: UserNotificationPayload) {
    const room = userRoom(payload.userId);
    this.logger.debug(`Broadcasting notification to room "${room}"`);
    this.server.to(room).emit('notification', payload);
  }

  // -------------------------------------------------------------------------
  // Utility — push a notification from elsewhere in the codebase
  // -------------------------------------------------------------------------

  /** Programmatically push a notification to a user without going through EventEmitter. */
  pushNotificationToUser(
    userId: string,
    notification: Omit<UserNotificationPayload, 'userId'>,
  ) {
    const room = userRoom(userId);
    this.server.to(room).emit('notification', { userId, ...notification });
  }
}
