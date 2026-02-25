import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class StellarRpcIndicator extends HealthIndicator {
  private readonly rpcUrl: string;

  constructor(private readonly httpService: HttpService) {
    super();
    // Falls back to the public testnet if nothing is configured
    this.rpcUrl =
      process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  }

  async isHealthy(key = 'stellar_rpc'): Promise<HealthIndicatorResult> {
    try {
      // Soroban RPC exposes a getHealth JSON-RPC method — a 200 with any
      // valid JSON body means the node is reachable and responsive.
      const { status } = await firstValueFrom(
        this.httpService.post(
          this.rpcUrl,
          { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] },
          { timeout: 5000 },
        ),
      );

      if (status === 200) {
        return this.getStatus(key, true, { url: this.rpcUrl });
      }

      throw new Error(`Unexpected status ${status}`);
    } catch (err: any) {
      throw new HealthCheckError(
        'Stellar RPC check failed',
        this.getStatus(key, false, {
          url: this.rpcUrl,
          error: err?.message ?? 'Unknown error',
        }),
      );
    }
  }
}