import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { ShutdownService } from './shutdown.service';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly rpcUrl: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly httpService: HttpService,
    private readonly shutdownService: ShutdownService,
  ) {
    this.rpcUrl =
      process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  }

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Checks PostgreSQL, Stellar RPC, and process memory. Returns 200 only if all critical subsystems are healthy.',
  })
  @ApiOkResponse({
    description: 'All subsystems healthy',
    schema: {
      example: {
        status: 'ok',
        database: 'connected',
        stellar_rpc: 'reachable',
        memory_heap_mb: 42,
        timestamp: '2024-01-26T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'One or more subsystems are unhealthy',
    schema: {
      example: {
        status: 'error',
        database: 'disconnected',
        stellar_rpc: 'unreachable',
        memory_heap_mb: 42,
        timestamp: '2024-01-26T10:30:00.000Z',
      },
    },
  })
  async check() {
    const [database, stellar_rpc, memory_heap_mb] = await Promise.all([
      this.checkDatabase(),
      this.checkStellarRpc(),
      this.checkMemory(),
    ]);

    const status =
      database === 'connected' && stellar_rpc === 'reachable' ? 'ok' : 'error';

    const payload = {
      status,
      version: process.env.npm_package_version ?? '1.0.0',
      apiVersion: 'v1',
      database,
      stellar_rpc,
      memory_heap_mb,
      timestamp: new Date().toISOString(),
    };

    // Return 503 so load balancers and uptime monitors react correctly
    if (status === 'error') {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns 200 when the application is ready to serve traffic. ' +
      'Returns 503 during graceful shutdown so load balancers stop routing new requests.',
  })
  @ApiOkResponse({ description: 'Application is ready' })
  @ApiResponse({ status: 503, description: 'Application is shutting down' })
  ready() {
    if (this.shutdownService.isShuttingDown()) {
      throw new ServiceUnavailableException({ status: 'shutting_down' });
    }
    return { status: 'ready' };
  }

  // ─── Private Checks ───────────────────────────────────────────────────────

  private async checkDatabase(): Promise<'connected' | 'disconnected'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async checkStellarRpc(): Promise<'reachable' | 'unreachable'> {
    try {
      const { status } = await firstValueFrom(
        this.httpService.post(
          this.rpcUrl,
          { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] },
          { timeout: 5000 },
        ),
      );
      return status === 200 ? 'reachable' : 'unreachable';
    } catch {
      return 'unreachable';
    }
  }

  private checkMemory(): number {
    const bytes = process.memoryUsage().heapUsed;
    return Math.round(bytes / 1024 / 1024);
  }
}
