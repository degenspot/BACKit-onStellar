import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OracleHealthLog,
  OracleOperationType,
} from './entities/oracle-health-log.entity';

export interface OracleHealthRecordInput {
  oracleKey: string;
  callId?: string | number | null;
  operation: OracleOperationType;
  submissionTime?: Date;
  priceFetched?: number | null;
  expectedPrice?: number | null;
  success: boolean;
  errorMessage?: string | null;
  latencyMs?: number;
  dexScreenerPrice?: number | null;
  horizonPrice?: number | null;
}

export interface OracleHealthAlert {
  type: 'SUCCESS_RATE_LOW' | 'LAST_THREE_FAILED' | 'PRICE_DEVIATION';
  message: string;
  severity: 'ERROR';
}

export interface OracleHealthSummary {
  successRate: number;
  averageLatencyMs: number;
  last10Operations: OracleHealthLog[];
  alerts: OracleHealthAlert[];
}

@Injectable()
export class OracleHealthService {
  private readonly logger = new Logger(OracleHealthService.name);
  private readonly successRateThreshold = Number(
    process.env.ORACLE_HEALTH_SUCCESS_RATE_THRESHOLD ?? 90,
  );
  private readonly deviationThreshold = Number(
    process.env.ORACLE_HEALTH_DEVIATION_THRESHOLD_PERCENT ??
      process.env.PRICE_DEVIATION_THRESHOLD_PERCENT ??
      5,
  );
  private readonly alertWebhookUrl =
    process.env.ORACLE_HEALTH_WEBHOOK_URL ??
    process.env.ORACLE_ALERT_WEBHOOK_URL;

  constructor(
    @InjectRepository(OracleHealthLog)
    private readonly healthLogRepo: Repository<OracleHealthLog>,
  ) {}

  async recordOperation(input: OracleHealthRecordInput): Promise<void> {
    try {
      const submissionTime = input.submissionTime ?? new Date();
      const latencyMs =
        input.latencyMs ?? Math.max(Date.now() - submissionTime.getTime(), 0);
      const deviationPercent = this.calculateDeviationPercent(
        input.priceFetched,
        input.expectedPrice,
      );

      const log = this.healthLogRepo.create({
        oracleKey: input.oracleKey,
        callId:
          input.callId === undefined || input.callId === null
            ? null
            : String(input.callId),
        operation: input.operation,
        submissionTime,
        priceFetched: input.priceFetched ?? null,
        expectedPrice: input.expectedPrice ?? null,
        success: input.success,
        errorMessage: input.errorMessage ?? null,
        latencyMs,
        deviationPercent,
        deviationBreached:
          deviationPercent !== null &&
          deviationPercent > this.deviationThreshold,
        dexScreenerPrice: input.dexScreenerPrice ?? null,
        horizonPrice: input.horizonPrice ?? null,
      });

      await this.healthLogRepo.save(log);
      await this.evaluateAndAlert();
    } catch (error) {
      this.logger.error('Failed to write oracle health log', error);
    }
  }

  async getHealth(): Promise<OracleHealthSummary> {
    const logs = await this.healthLogRepo.find({
      order: { submissionTime: 'DESC' },
      take: 100,
    });

    return this.calculateHealth(logs);
  }

  calculateHealth(logs: OracleHealthLog[]): OracleHealthSummary {
    const last10Operations = logs
      .slice()
      .sort((a, b) => b.submissionTime.getTime() - a.submissionTime.getTime())
      .slice(0, 10);

    const successRate =
      logs.length === 0
        ? 100
        : (logs.filter((log) => log.success).length / logs.length) * 100;
    const averageLatencyMs =
      logs.length === 0
        ? 0
        : logs.reduce((sum, log) => sum + (log.latencyMs ?? 0), 0) /
          logs.length;

    return {
      successRate,
      averageLatencyMs,
      last10Operations,
      alerts: this.evaluateAlerts(logs),
    };
  }

  evaluateAlerts(logs: OracleHealthLog[]): OracleHealthAlert[] {
    const ordered = logs
      .slice()
      .sort((a, b) => b.submissionTime.getTime() - a.submissionTime.getTime());
    const alerts: OracleHealthAlert[] = [];

    if (ordered.length > 0) {
      const successRate =
        (ordered.filter((log) => log.success).length / ordered.length) * 100;

      if (successRate < this.successRateThreshold) {
        alerts.push({
          type: 'SUCCESS_RATE_LOW',
          severity: 'ERROR',
          message: `Oracle success rate ${successRate.toFixed(2)}% is below ${this.successRateThreshold}%.`,
        });
      }
    }

    if (
      ordered.length >= 3 &&
      ordered.slice(0, 3).every((log) => !log.success)
    ) {
      alerts.push({
        type: 'LAST_THREE_FAILED',
        severity: 'ERROR',
        message: 'The last 3 oracle operations failed.',
      });
    }

    const breached = ordered.find((log) => log.deviationBreached);
    if (breached) {
      alerts.push({
        type: 'PRICE_DEVIATION',
        severity: 'ERROR',
        message: `Oracle price deviation ${Number(breached.deviationPercent).toFixed(2)}% exceeded ${this.deviationThreshold}%.`,
      });
    }

    return alerts;
  }

  private async evaluateAndAlert(): Promise<void> {
    const logs = await this.healthLogRepo.find({
      order: { submissionTime: 'DESC' },
      take: 10,
    });
    const alerts = this.evaluateAlerts(logs);

    await Promise.all(alerts.map((alert) => this.emitAlert(alert)));
  }

  private async emitAlert(alert: OracleHealthAlert): Promise<void> {
    this.logger.error(
      JSON.stringify({ alert: alert.type, message: alert.message }),
    );

    if (!this.alertWebhookUrl) return;

    try {
      const response = await fetch(this.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'oracle-health',
          ...alert,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        this.logger.error(
          `Oracle health webhook returned status ${response.status}`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to send oracle health webhook', error);
    }
  }

  private calculateDeviationPercent(
    observed?: number | null,
    expected?: number | null,
  ): number | null {
    if (observed === undefined || observed === null) return null;
    if (expected === undefined || expected === null || expected === 0)
      return null;

    return Math.abs((observed - expected) / expected) * 100;
  }
}
