jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  class FeeBumpTransactionMock {
    innerTransaction: any;
    feeSource: string;
    signatures: any[];
    timeBounds?: any;
    fee: string;
    operations: any[];
    sign = jest.fn();
    constructor(inner: any, feeSource: string) {
      this.innerTransaction = inner;
      this.feeSource = feeSource;
      this.signatures = [];
      this.fee = inner?.fee ?? '0';
      this.operations = inner?.operations ?? [];
      this.timeBounds = inner?.timeBounds;
    }
  }

  const fromXDR = jest.fn();
  const buildFeeBumpTransaction = jest.fn(
    (kp: any, outerFee: string, innerTx: any) =>
      new FeeBumpTransactionMock(innerTx, kp.publicKey()),
  );

  return {
    ...actual,
    StrKey: {
      encodeContract: jest.fn(() => 'ALLOWED'),
    },
    FeeBumpTransaction: FeeBumpTransactionMock,
    TransactionBuilder: {
      fromXDR,
      buildFeeBumpTransaction,
    },
    Keypair: {
      fromSecret: jest.fn(() => ({ publicKey: () => 'SPONSOR' })),
    },
    xdr: {
      ...actual.xdr,
      HostFunctionType: {
        hostFunctionTypeInvokeContract: jest.fn(() => ({ value: 1 })),
      },
      ScAddressType: {
        scAddressTypeContract: jest.fn(() => ({ value: 1 })),
      },
    },
  };
});

import { BadRequestException } from '@nestjs/common';
import { RelayService } from './relay.service';

describe('RelayService', () => {
  const env = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    delete process.env.RELAY_HOT_WALLET_SECRET;
    delete process.env.NETWORK_PASSPHRASE;
  });

  afterEach(() => {
    process.env = env;
  });

  it('rejects non-invokeHostFunction operations', async () => {
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const tx: any = {
      operations: [{ type: 'payment' }],
    };

    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects transactions directed at non-CallRegistry contracts', async () => {
    const { StrKey } = await import('@stellar/stellar-sdk');
    (StrKey.encodeContract as any).mockReturnValueOnce('NOT_ALLOWED');

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const tx: any = {
      operations: [
        {
          type: 'invokeHostFunction',
          func: {
            switch: () => ({ value: 1 }),
            invokeContract: () => ({
              contractAddress: () => ({
                switch: () => ({ value: 1 }),
                contractId: () => Buffer.alloc(32),
              }),
            }),
          },
        },
      ],
    };

    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sponsorAndSubmit rejects when relay is not configured', async () => {
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { sendTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sponsorAndSubmit rejects invalid XDR', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockImplementationOnce(() => {
      throw new Error('bad');
    });

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { sendTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sponsorAndSubmit enforces inner tx signatures', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
      operations: [],
      signatures: [],
      fee: '100',
    });

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { sendTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sponsorAndSubmit rejects expired tx timebounds', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2_000_000 * 1000);
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
      operations: [],
      signatures: [Buffer.from('sig')],
      fee: '100',
      timeBounds: { minTime: '0', maxTime: '100' },
    });

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { sendTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    nowSpy.mockRestore();
  });

  it('sponsorAndSubmit submits fee-bump and returns hash', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
      operations: [],
      signatures: [Buffer.from('sig')],
      fee: '100',
    });

    const rpcServer = {
      sendTransaction: jest
        .fn()
        .mockResolvedValue({ status: 'SUCCESS', hash: 'h' }),
    };
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      rpcServer as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).resolves.toEqual({
      hash: 'h',
    });
    expect(rpcServer.sendTransaction).toHaveBeenCalled();
  });

  it('sponsorAndSubmit rejects when minTime is in the future', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000 * 1000);
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
      operations: [],
      signatures: [Buffer.from('sig')],
      fee: '100',
      timeBounds: { minTime: '9999999', maxTime: '0' },
    });

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { sendTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    nowSpy.mockRestore();
  });

  it('sponsorAndSubmit rejects fee-bump with mismatched sponsor', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const { FeeBumpTransaction, TransactionBuilder } =
      await import('@stellar/stellar-sdk');
    const inner: any = {
      operations: [],
      signatures: [Buffer.from('sig')],
      fee: '1',
    };
    const feeBump: any = new (FeeBumpTransaction as any)(inner, 'NOT_SPONSOR');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(feeBump);

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { sendTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sponsorAndSubmit surfaces rpc ERROR responses', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const { FeeBumpTransaction, TransactionBuilder } =
      await import('@stellar/stellar-sdk');
    const inner: any = {
      operations: [],
      signatures: [Buffer.from('sig')],
      fee: '1',
    };
    const feeBump: any = new (FeeBumpTransaction as any)(inner, 'SPONSOR');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(feeBump);

    const rpcServer = {
      sendTransaction: jest.fn().mockResolvedValue({
        status: 'ERROR',
        errorResult: { code: 'X' },
      }),
    };
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      rpcServer as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validateTransaction rejects when contractId is not configured', async () => {
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: '' }) } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    const tx: any = { operations: [{ type: 'invokeHostFunction' }] };
    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validateTransaction rejects transactions with no operations', async () => {
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    const tx: any = { operations: [] };
    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validateTransaction rejects malformed host function operations', async () => {
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    const tx: any = { operations: [{ type: 'invokeHostFunction' }] };
    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validateTransaction rejects non-invokeContract host functions', async () => {
    const { xdr } = await import('@stellar/stellar-sdk');
    (
      xdr.HostFunctionType.hostFunctionTypeInvokeContract as any
    ).mockReturnValueOnce({
      value: 999,
    });
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    const tx: any = {
      operations: [
        {
          type: 'invokeHostFunction',
          func: {
            switch: () => ({ value: 1 }),
          },
        },
      ],
    };
    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validateTransaction rejects non-contract address types', async () => {
    const { xdr } = await import('@stellar/stellar-sdk');
    (xdr.ScAddressType.scAddressTypeContract as any).mockReturnValueOnce({
      value: 999,
    });
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      {} as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );
    const tx: any = {
      operations: [
        {
          type: 'invokeHostFunction',
          func: {
            switch: () => ({ value: 1 }),
            invokeContract: () => ({
              contractAddress: () => ({
                switch: () => ({ value: 1 }),
              }),
            }),
          },
        },
      ],
    };
    await expect(
      (service as any).validateTransaction(tx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('simulate', () => {
    const mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
    };

    it('returns cached simulation result if available', async () => {
      const cachedResult = {
        action: 'stake_on_call',
        contract_called: 'CC123',
        function_called: 'stake_on_call',
        token_transfers: [],
        new_pool_ratios: { up_bps: 5000, down_bps: 5000 },
        estimated_payout_if_win: '180.00',
        estimated_gas_xlm: '0.0001',
        estimated_gas_usd: '0.000015',
        will_succeed: true,
        error_message: null,
      };

      mockCacheManager.get.mockResolvedValueOnce(cachedResult);

      const service = new RelayService(
        {} as any,
        {} as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'valid_xdr' });
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        'relay:simulate:valid_xdr',
      );
      expect(result).toEqual(cachedResult);
    });

    it('simulates create_call transaction', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_CREATOR',
        operations: [
          {
            type: 'invokeHostFunction',
            source: 'G_CREATOR',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'create_call',
                args: () => [
                  {},
                  {
                    stake_amount: 1000000000n,
                  },
                ],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '1000',
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'create_call_xdr' });

      expect(result.action).toBe('create_call');
      expect(result.function_called).toBe('create_call');
      expect(result.will_succeed).toBe(true);
      expect(result.error_message).toBeNull();
      expect(result.token_transfers).toHaveLength(1);
      expect(result.token_transfers[0].from).toBe('G_CREATOR');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'relay:simulate:create_call_xdr',
        result,
        30000,
      );
    });

    it('simulates stake_on_call transaction', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_STAKER',
        operations: [
          {
            type: 'invokeHostFunction',
            source: 'G_STAKER',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'stake_on_call',
                args: () => ['G_STAKER', 1n, 1000000000n, 1],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '2000',
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'stake_xdr' });

      expect(result.action).toBe('stake_on_call');
      expect(result.will_succeed).toBe(true);
      expect(result.new_pool_ratios.up_bps).toBeGreaterThan(5000);
      expect(result.estimated_payout_if_win).toBeDefined();
    });

    it('simulates claim_payout transaction', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_WINNER',
        operations: [
          {
            type: 'invokeHostFunction',
            source: 'G_WINNER',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'redeem_shares',
                args: () => ['G_WINNER', 1n],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '1500',
          results: [{ retval: 1800000000n }],
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'claim_payout_xdr' });

      expect(result.action).toBe('claim_payout');
      expect(result.function_called).toBe('redeem_shares');
      expect(result.will_succeed).toBe(true);
      expect(result.estimated_payout_if_win).toBe('180.00');
    });

    it('simulates withdraw_stake transaction', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_STAKER',
        operations: [
          {
            type: 'invokeHostFunction',
            source: 'G_STAKER',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'claim_void_refund',
                args: () => ['G_STAKER', 1n],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '1000',
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'withdraw_stake_xdr' });

      expect(result.action).toBe('withdraw_stake');
      expect(result.will_succeed).toBe(true);
      expect(result.new_pool_ratios).toEqual({ up_bps: 0, down_bps: 0 });
    });

    it('simulates cancel_call transaction', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_CREATOR',
        operations: [
          {
            type: 'invokeHostFunction',
            source: 'G_CREATOR',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'cancel_call',
                args: () => ['G_CREATOR', 1n],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '1000',
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'cancel_call_xdr' });

      expect(result.action).toBe('cancel_call');
      expect(result.function_called).toBe('cancel_call');
      expect(result.will_succeed).toBe(true);
    });

    it('handles simulation failure with clear human-readable error message', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_STAKER',
        operations: [
          {
            type: 'invokeHostFunction',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'stake_on_call',
                args: () => ['G_STAKER', 1n, 100n, 1],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          error: 'Transaction failed: insufficient balance for stake',
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'fail_xdr' });

      expect(result.will_succeed).toBe(false);
      expect(result.will_succeed).toBe(false);
      expect(result.error_message).toBe(
        'Your balance is 50 USDC but the stake requires 100 USDC.',
      );
    });

    it('handles market ended, settled, cancelled, cutoff and default error messages', async () => {
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');
      const testCases = [
        { err: 'Market has expired', expected: 'Market has ended' },
        { err: 'Call is already settled', expected: 'Market is already settled' },
        { err: 'Market cancelled by admin', expected: 'Market has been cancelled' },
        { err: 'Staking cutoff passed', expected: 'Staking cutoff period active' },
        { err: 'Unknown internal error', expected: 'Unknown internal error' },
      ];

      for (const tc of testCases) {
        mockCacheManager.get.mockResolvedValueOnce(null);
        (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
          source: 'G_USER',
          operations: [],
        });
        const rpcServer = {
          simulateTransaction: jest.fn().mockResolvedValue({ error: tc.err }),
        };
        const service = new RelayService(
          {} as any,
          rpcServer as any,
          mockCacheManager as any,
        );
        const result = await service.simulate({ xdr: 'test_xdr' });
        expect(result.will_succeed).toBe(false);
        expect(result.error_message).toBe(tc.expected);
      }
    });

    it('handles simulation rpc rejection and cache set failure', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      mockCacheManager.set.mockRejectedValueOnce(new Error('cache error'));
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_STAKER',
        operations: [],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockRejectedValue(new Error('rpc failure')),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'err_xdr' });
      expect(result.will_succeed).toBe(false);
      expect(result.error_message).toBe('rpc failure');
    });

    it('simulates DOWN position stake_on_call', async () => {
      mockCacheManager.get.mockResolvedValueOnce(null);
      const { TransactionBuilder, xdr } = await import('@stellar/stellar-sdk');

      (TransactionBuilder.fromXDR as any).mockReturnValueOnce({
        source: 'G_STAKER',
        operations: [
          {
            type: 'invokeHostFunction',
            source: 'G_STAKER',
            func: {
              invokeContract: () => ({
                contractAddress: () => ({
                  contractId: () => Buffer.alloc(32),
                }),
                functionName: () => 'stake_on_call',
                args: () => [
                  'G_STAKER',
                  1n,
                  xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('500000000'), hi: xdr.Int64.fromString('0') })),
                  xdr.ScVal.scvU32(2),
                ],
              }),
            },
          },
        ],
      });

      const rpcServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '1000',
        }),
      };

      const service = new RelayService(
        {} as any,
        rpcServer as any,
        mockCacheManager as any,
      );

      const result = await service.simulate({ xdr: 'down_xdr' });
      expect(result.action).toBe('stake_on_call');
      expect(result.new_pool_ratios.down_bps).toBeGreaterThan(5000);
    });

    it('throws BadRequestException on missing or invalid XDR in simulate', async () => {
      const service = new RelayService(
        {} as any,
        {} as any,
        mockCacheManager as any,
      );

      await expect(service.simulate({ xdr: '' })).rejects.toThrow(BadRequestException);

      const { TransactionBuilder } = await import('@stellar/stellar-sdk');
      (TransactionBuilder.fromXDR as any).mockImplementationOnce(() => {
        throw new Error('invalid xdr format');
      });

      await expect(service.simulate({ xdr: 'invalid' })).rejects.toThrow(BadRequestException);
    });
  });

  it('estimateFee rejects invalid XDR', async () => {
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockImplementationOnce(() => {
      throw new Error('bad xdr');
    });

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { simulateTransaction: jest.fn() } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    await expect(
      (service as any).estimateFee('bad-xdr'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('estimateFee returns fee estimates with successful simulation', async () => {
    const { TransactionBuilder, SorobanRpc } =
      await import('@stellar/stellar-sdk');
    const tx: any = {
      operations: [],
      signatures: [Buffer.from('sig')],
      fee: '100',
    };
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(tx);

    jest.spyOn(SorobanRpc.Api, 'isSimulationSuccess').mockReturnValueOnce(true);

    const rpcServer = {
      simulateTransaction: jest
        .fn()
        .mockResolvedValue({ minResourceFee: '200', cost: { cpu: 1 } }),
    };
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      rpcServer as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ stellar: { usd: 0.5 } }),
    }) as any;

    const result = await (service as any).estimateFee('valid-xdr');
    expect(result).toEqual({
      estimatedGasXLM: '0.0000200',
      estimatedGasUSD: '0.000010',
      resourceCost: { cpu: 1 },
      sponsored: false,
    });
    expect(rpcServer.simulateTransaction).toHaveBeenCalledWith(tx);
    global.fetch = origFetch;
  });

  it('estimateFee falls back to innerTx.fee when simulation fails', async () => {
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const tx: any = { fee: '500' };
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(tx);

    const rpcServer = {
      simulateTransaction: jest.fn().mockRejectedValue(new Error('rpc error')),
    };
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      rpcServer as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ stellar: { usd: 1 } }),
    }) as any;

    const result = await (service as any).estimateFee('valid-xdr');
    expect(result.estimatedGasXLM).toBe('0.0000500');
    expect(result.resourceCost).toBeNull();
    global.fetch = origFetch;
  });

  it('estimateFee handles FeeBumpTransaction', async () => {
    const { TransactionBuilder, SorobanRpc, FeeBumpTransaction } =
      await import('@stellar/stellar-sdk');
    const inner: any = { fee: '100' };
    const feeBump: any = new (FeeBumpTransaction as any)(inner, 'SPONSOR');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(feeBump);

    jest
      .spyOn(SorobanRpc.Api, 'isSimulationSuccess')
      .mockReturnValueOnce(false);

    const rpcServer = {
      simulateTransaction: jest.fn().mockResolvedValue({}),
    };
    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      rpcServer as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ stellar: { usd: 0.5 } }),
    }) as any;

    const result = await (service as any).estimateFee('fee-bump-xdr');
    expect(result.estimatedGasXLM).toBe('0.0000100');
    expect(result.sponsored).toBe(false);
    global.fetch = origFetch;
  });

  it('estimateFee returns 0 USD when XLM price fetch fails', async () => {
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({ fee: '100' });
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { simulateTransaction: jest.fn().mockResolvedValue({}) } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const result = await (service as any).estimateFee('valid-xdr');
    expect(result.estimatedGasUSD).toBe('0.000000');
    global.fetch = origFetch;
  });

  it('estimateFee uses cached XLM price', async () => {
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({ fee: '100' });

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { simulateTransaction: jest.fn().mockResolvedValue({}) } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    (service as any).xlmPriceCache = {
      usd: 2,
      expiresAt: Date.now() + 60000,
    };

    const origFetch = global.fetch;
    global.fetch = jest.fn();

    const result = await (service as any).estimateFee('valid-xdr');
    expect(result.estimatedGasUSD).toBe('0.000020');
    expect(global.fetch).not.toHaveBeenCalled();
    global.fetch = origFetch;
  });

  it('estimateFee returns sponsored=true when hotWallet is configured', async () => {
    process.env.RELAY_HOT_WALLET_SECRET = 'S';
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce({ fee: '100' });

    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ stellar: { usd: 0.5 } }),
    }) as any;

    const service = new RelayService(
      {
        getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
      } as any,
      { simulateTransaction: jest.fn().mockResolvedValue({}) } as any,
      { get: jest.fn(), set: jest.fn() } as any,
    );

    const result = await (service as any).estimateFee('valid-xdr');
    expect(result.sponsored).toBe(true);
    global.fetch = origFetch;
  });
});
