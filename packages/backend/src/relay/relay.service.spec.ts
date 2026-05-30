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
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      {} as any,
    );

    const tx: any = {
      operations: [{ type: 'payment' }],
    };

    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects transactions directed at non-CallRegistry contracts', async () => {
    const { StrKey } = await import('@stellar/stellar-sdk');
    (StrKey.encodeContract as any).mockReturnValueOnce('NOT_ALLOWED');

    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      {} as any,
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

    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sponsorAndSubmit rejects when relay is not configured', async () => {
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      { sendTransaction: jest.fn() } as any,
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
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      { sendTransaction: jest.fn() } as any,
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
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      { sendTransaction: jest.fn() } as any,
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
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      { sendTransaction: jest.fn() } as any,
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
      sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS', hash: 'h' }),
    };
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      rpcServer as any,
    );
    jest
      .spyOn(service as any, 'validateTransaction')
      .mockResolvedValueOnce(undefined);

    await expect(service.sponsorAndSubmit('xdr')).resolves.toEqual({ hash: 'h' });
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
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      { sendTransaction: jest.fn() } as any,
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
    const { FeeBumpTransaction, TransactionBuilder } = await import(
      '@stellar/stellar-sdk'
    );
    const inner: any = { operations: [], signatures: [Buffer.from('sig')], fee: '1' };
    const feeBump: any = new (FeeBumpTransaction as any)(inner, 'NOT_SPONSOR');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(feeBump);

    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      { sendTransaction: jest.fn() } as any,
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
    const { FeeBumpTransaction, TransactionBuilder } = await import(
      '@stellar/stellar-sdk'
    );
    const inner: any = { operations: [], signatures: [Buffer.from('sig')], fee: '1' };
    const feeBump: any = new (FeeBumpTransaction as any)(inner, 'SPONSOR');
    (TransactionBuilder.fromXDR as any).mockReturnValueOnce(feeBump);

    const rpcServer = {
      sendTransaction: jest.fn().mockResolvedValue({
        status: 'ERROR',
        errorResult: { code: 'X' },
      }),
    };
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      rpcServer as any,
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
    );
    const tx: any = { operations: [{ type: 'invokeHostFunction' }] };
    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validateTransaction rejects transactions with no operations', async () => {
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      {} as any,
    );
    const tx: any = { operations: [] };
    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validateTransaction rejects malformed host function operations', async () => {
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      {} as any,
    );
    const tx: any = { operations: [{ type: 'invokeHostFunction' }] };
    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validateTransaction rejects non-invokeContract host functions', async () => {
    const { xdr } = await import('@stellar/stellar-sdk');
    (xdr.HostFunctionType.hostFunctionTypeInvokeContract as any).mockReturnValueOnce({
      value: 999,
    });
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      {} as any,
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
    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validateTransaction rejects non-contract address types', async () => {
    const { xdr } = await import('@stellar/stellar-sdk');
    (xdr.ScAddressType.scAddressTypeContract as any).mockReturnValueOnce({
      value: 999,
    });
    const service = new RelayService(
      { getSettings: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }) } as any,
      {} as any,
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
    await expect((service as any).validateTransaction(tx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
