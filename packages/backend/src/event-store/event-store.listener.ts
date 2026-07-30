import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventStoreService } from './event-store.service';
import {
  AggregateType,
  DomainEventType,
} from './entities/event-store-entry.entity';

interface CallCreatedPayload {
  id: string;
  creatorAddress: string;
  title: string;
  [key: string]: unknown;
}

interface CallResolvedPayload {
  callId: string | number;
  outcome: string;
  finalPrice?: string;
  [key: string]: unknown;
}

interface StakePayload {
  userAddress: string;
  callId: string;
  amount: number;
  [key: string]: unknown;
}

interface PayoutClaimedPayload {
  userAddress: string;
  callId: string;
  amount: number;
  txHash?: string;
  [key: string]: unknown;
}

interface UserRegisteredPayload {
  userId: string;
  walletAddress: string;
  [key: string]: unknown;
}

interface UserFollowedPayload {
  followingAddress: string;
  followerAddress: string;
  [key: string]: unknown;
}

interface AdminActionPayload {
  actorId: string;
  actionType: string;
  targetResource: string;
  status: string;
  ip?: string;
  userAgent?: string;
  [key: string]: unknown;
}

interface OracleSubmittedPayload {
  callId: string | number;
  observedPrice: string;
  outcome: string;
  [key: string]: unknown;
}

/**
 * Bridges the app's existing EventEmitter2 domain events onto the
 * append-only event_store. Each handler's only job is to figure out which
 * aggregate the event belongs to and hand the payload to
 * EventStoreService.append() — the store itself is oblivious to what any
 * given event means.
 */
@Injectable()
export class EventStoreListener {
  private readonly logger = new Logger(EventStoreListener.name);

  constructor(private readonly eventStore: EventStoreService) {}

  @OnEvent(DomainEventType.CALL_CREATED)
  async onCallCreated(payload: CallCreatedPayload): Promise<void> {
    await this.record(
      AggregateType.CALL,
      payload.id,
      DomainEventType.CALL_CREATED,
      payload,
      {
        userAddress: payload.creatorAddress,
      },
    );
  }

  @OnEvent(DomainEventType.CALL_RESOLVED)
  async onCallResolved(payload: CallResolvedPayload): Promise<void> {
    await this.record(
      AggregateType.CALL,
      String(payload.callId),
      DomainEventType.CALL_RESOLVED,
      payload,
    );
  }

  @OnEvent(DomainEventType.STAKE_PLACED)
  async onStakePlaced(payload: StakePayload): Promise<void> {
    await this.record(
      AggregateType.STAKE,
      stakeAggregateId(payload),
      DomainEventType.STAKE_PLACED,
      payload,
      { userAddress: payload.userAddress },
    );
  }

  @OnEvent(DomainEventType.STAKE_WITHDRAWN)
  async onStakeWithdrawn(payload: StakePayload): Promise<void> {
    await this.record(
      AggregateType.STAKE,
      stakeAggregateId(payload),
      DomainEventType.STAKE_WITHDRAWN,
      payload,
      { userAddress: payload.userAddress },
    );
  }

  @OnEvent(DomainEventType.PAYOUT_CLAIMED)
  async onPayoutClaimed(payload: PayoutClaimedPayload): Promise<void> {
    await this.record(
      AggregateType.PAYOUT,
      `${payload.callId}:${payload.userAddress}`,
      DomainEventType.PAYOUT_CLAIMED,
      payload,
      { userAddress: payload.userAddress },
    );
  }

  @OnEvent(DomainEventType.USER_REGISTERED)
  async onUserRegistered(payload: UserRegisteredPayload): Promise<void> {
    await this.record(
      AggregateType.USER,
      payload.walletAddress,
      DomainEventType.USER_REGISTERED,
      payload,
      { userAddress: payload.walletAddress },
    );
  }

  @OnEvent(DomainEventType.USER_FOLLOWED)
  async onUserFollowed(payload: UserFollowedPayload): Promise<void> {
    await this.record(
      AggregateType.USER,
      payload.followingAddress,
      DomainEventType.USER_FOLLOWED,
      payload,
      { userAddress: payload.followerAddress },
    );
  }

  @OnEvent(DomainEventType.ADMIN_ACTION)
  async onAdminAction(payload: AdminActionPayload): Promise<void> {
    await this.record(
      AggregateType.ADMIN,
      payload.targetResource,
      DomainEventType.ADMIN_ACTION,
      payload,
      {
        userAddress: payload.actorId,
        ip: payload.ip,
        userAgent: payload.userAgent,
      },
    );
  }

  @OnEvent(DomainEventType.ORACLE_SUBMITTED)
  async onOracleSubmitted(payload: OracleSubmittedPayload): Promise<void> {
    await this.record(
      AggregateType.ORACLE,
      String(payload.callId),
      DomainEventType.ORACLE_SUBMITTED,
      payload,
    );
  }

  /**
   * Writing to the audit trail must never take down the feature that
   * triggered it — same "log but never bubble" contract AuditService uses.
   */
  private async record(
    aggregateType: AggregateType,
    aggregateId: string,
    eventType: DomainEventType,
    payload: Record<string, unknown>,
    metadata?: { userAddress?: string; ip?: string; userAgent?: string },
  ): Promise<void> {
    try {
      await this.eventStore.append(
        aggregateType,
        aggregateId,
        eventType,
        payload,
        metadata,
      );
    } catch (err) {
      this.logger.error(
        `Failed to append ${eventType} for ${aggregateType}:${aggregateId}`,
        (err as Error).stack,
      );
    }
  }
}

function stakeAggregateId(payload: StakePayload): string {
  return `${payload.callId}:${payload.userAddress}`;
}
