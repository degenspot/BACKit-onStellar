import { Test, TestingModule } from '@nestjs/testing';
import { EventStoreListener } from './event-store.listener';
import { EventStoreService } from './event-store.service';
import {
  AggregateType,
  DomainEventType,
} from './entities/event-store-entry.entity';

describe('EventStoreListener', () => {
  let listener: EventStoreListener;

  const eventStore = {
    append: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventStoreListener,
        { provide: EventStoreService, useValue: eventStore },
      ],
    }).compile();

    listener = module.get(EventStoreListener);
  });

  it('appends call.created under the CALL aggregate', async () => {
    await listener.onCallCreated({
      id: 'call-1',
      creatorAddress: 'GA1',
      title: 'BTC > 100k',
    });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.CALL,
      'call-1',
      DomainEventType.CALL_CREATED,
      expect.objectContaining({ id: 'call-1' }),
      { userAddress: 'GA1' },
    );
  });

  it('appends call.resolved under the CALL aggregate', async () => {
    await listener.onCallResolved({ callId: 42, outcome: 'YES' });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.CALL,
      '42',
      DomainEventType.CALL_RESOLVED,
      expect.objectContaining({ callId: 42 }),
      undefined,
    );
  });

  it('appends stake.placed under a composite STAKE aggregate id', async () => {
    await listener.onStakePlaced({
      userAddress: 'GA1',
      callId: 'call-1',
      amount: 50,
    });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.STAKE,
      'call-1:GA1',
      DomainEventType.STAKE_PLACED,
      expect.objectContaining({ amount: 50 }),
      { userAddress: 'GA1' },
    );
  });

  it('appends payout.claimed under a composite PAYOUT aggregate id', async () => {
    await listener.onPayoutClaimed({
      userAddress: 'GA1',
      callId: 'call-1',
      amount: 100,
    });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.PAYOUT,
      'call-1:GA1',
      DomainEventType.PAYOUT_CLAIMED,
      expect.objectContaining({ amount: 100 }),
      { userAddress: 'GA1' },
    );
  });

  it('appends user.registered under the USER aggregate', async () => {
    await listener.onUserRegistered({ userId: 'u1', walletAddress: 'GA1' });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.USER,
      'GA1',
      DomainEventType.USER_REGISTERED,
      expect.objectContaining({ userId: 'u1' }),
      { userAddress: 'GA1' },
    );
  });

  it('appends user.followed keyed by the followed user', async () => {
    await listener.onUserFollowed({
      followerAddress: 'GA1',
      followingAddress: 'GA2',
    });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.USER,
      'GA2',
      DomainEventType.USER_FOLLOWED,
      expect.objectContaining({ followerAddress: 'GA1' }),
      { userAddress: 'GA1' },
    );
  });

  it('appends admin.action under the ADMIN aggregate, carrying ip/userAgent', async () => {
    await listener.onAdminAction({
      actorId: 'admin-1',
      actionType: 'MARKET_MANUALLY_RESOLVED',
      targetResource: 'call:call-1',
      status: 'SUCCESS',
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.ADMIN,
      'call:call-1',
      DomainEventType.ADMIN_ACTION,
      expect.objectContaining({ actorId: 'admin-1' }),
      { userAddress: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' },
    );
  });

  it('appends oracle.submitted under the ORACLE aggregate', async () => {
    await listener.onOracleSubmitted({
      callId: 7,
      observedPrice: '110',
      outcome: 'YES',
    });

    expect(eventStore.append).toHaveBeenCalledWith(
      AggregateType.ORACLE,
      '7',
      DomainEventType.ORACLE_SUBMITTED,
      expect.objectContaining({ observedPrice: '110' }),
      undefined,
    );
  });

  it('swallows append() failures so a broken audit trail never breaks the feature that triggered it', async () => {
    eventStore.append.mockRejectedValueOnce(new Error('db down'));

    await expect(
      listener.onCallCreated({
        id: 'call-1',
        creatorAddress: 'GA1',
        title: 'x',
      }),
    ).resolves.toBeUndefined();
  });
});
