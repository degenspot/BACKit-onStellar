import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutClaim, PayoutClaimStatus } from './entities/payout-claim.entity';
import { PayoutsService } from './payouts.service';

describe('PayoutsService', () => {
  let service: PayoutsService;

  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const eventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: getRepositoryToken(PayoutClaim), useValue: repository },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
  });

  it('marks claim as CLAIMED when payout event arrives', async () => {
    repository.findOne.mockResolvedValue({
      callId: 'call-1',
      stakerAddress: 'GA1',
      amount: '100',
      status: PayoutClaimStatus.PENDING,
    });
    repository.save.mockImplementation(async (value: any) => value);

    const result = await service.markClaimed(
      'call-1',
      'GA1',
      'tx-hash',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(result.status).toBe(PayoutClaimStatus.CLAIMED);
    expect(eventEmitter.emit).toHaveBeenCalledWith('payout.claimed', {
      userAddress: 'GA1',
      callId: 'call-1',
      amount: 100,
      txHash: 'tx-hash',
    });
    expect(result.txHash).toBe('tx-hash');
  });

  it('marks claim as FAILED', async () => {
    repository.findOne.mockResolvedValue(null);
    repository.create.mockReturnValue({
      callId: 'call-2',
      stakerAddress: 'GA2',
      amount: '0',
    });
    repository.save.mockImplementation(async (value: any) => value);

    const result = await service.markFailed('call-2', 'GA2');
    expect(result.status).toBe(PayoutClaimStatus.FAILED);
  });

  it('returns payouts by user address', async () => {
    repository.find.mockResolvedValue([{ id: 'p1' }]);
    const data = await service.listUserPayouts('GA3');
    expect(data).toEqual([{ id: 'p1' }]);
  });
});
