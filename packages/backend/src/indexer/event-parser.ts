import * as SorobanSdk from '@stellar/stellar-sdk';
import { Logger } from '@nestjs/common';
import { EventType } from './event-log.entity';

export class EventParser {
  private readonly logger = new Logger(EventParser.name);

  /**
   * Parse Soroban contract events into structured data
   */
  parseEvent(event: any): ParsedEvent | null {
    try {
      // Extract contract ID and topics
      const contractId = event.contractId;
      const topics = event.topic.map((topic) => this.parseScVal(topic));

      if (topics.length === 0) {
        return null;
      }

      // First topic is usually the event name
      const eventName = topics[0];

      // Parse based on contract and event type
      if (eventName === 'call_created') {
        return this.parseCallCreated(event, topics);
      } else if (eventName === 'stake_added') {
        return this.parseStakeAdded(event, topics);
      } else if (eventName === 'call_resolved') {
        return this.parseCallResolved(event, topics);
      } else if (eventName === 'call_settled') {
        return this.parseCallSettled(event, topics);
      } else if (eventName === 'admin_changed') {
        return this.parseAdminChanged(event, topics);
      } else if (eventName === 'outcome_manager_changed') {
        return this.parseOutcomeManagerChanged(event, topics);
      } else if (
        eventName === 'outcome_finalized' ||
        eventName === 'finalized'
      ) {
        return this.parseOutcomeFinalized(event, topics);
      } else if (eventName === 'initialized') {
        return this.parseInitialized(event, topics);
      } else if (eventName === 'admin_params_changed') {
        return this.parseAdminParamsChanged(event, topics);
      }

      // Log unknown events for debugging
      this.logger.debug(`Unknown event type: ${eventName}`, {
        contractId,
        topics,
        eventId: `${event.ledger}-${event.id}`,
      });

      return null;
    } catch (error) {
      this.logger.error('Failed to parse event', error);
      return null;
    }
  }

  private parseCallCreated(event: any, topics: any[]): ParsedEvent {
    // call_created(call_id, creator, stake_token, stake_amount, end_ts, token_address, pair_id, ipfs_cid)
    const data = SorobanSdk.xdr.ScVal.fromXDR(event.value, 'base64');
    return {
      contractId: event.contractId,
      creator: '',
      description: '',
      eventType: EventType.CALL_CREATED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        callId: this.parseU64(topics[1]),
        creator: this.parseAddress(topics[2]),
        stakeToken: this.parseAddress(topics[3]),
        stakeAmount: this.parseI128(topics[4]),
        endTs: this.parseU64(topics[5]),
        tokenAddress: this.parseAddress(topics[6]),
        pairId: this.parseBytes(topics[7]),
        ipfsCid: this.parseBytes(topics[8]),
      },
    };
  }

  private parseStakeAdded(event: any, topics: any[]): ParsedEvent {
    // stake_added(call_id, staker, amount, position)
    return {
      contractId: event.contractId,
      eventType: EventType.STAKE_ADDED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        callId: this.parseU64(topics[1]),
        staker: this.parseAddress(topics[2]),
        amount: this.parseI128(topics[3]),
        position: this.parseU32(topics[4]), // 1 = UP, 2 = DOWN
      },
    };
  }

  private parseCallResolved(event: any, topics: any[]): ParsedEvent {
    // call_resolved(call_id, outcome, end_price)
    return {
      contractId: event.contractId,
      eventType: EventType.CALL_RESOLVED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        callId: this.parseU64(topics[1]),
        outcome: this.parseU32(topics[2]), // 1 = UP, 2 = DOWN
        endPrice: this.parseI128(topics[3]),
      },
    };
  }

  private parseCallSettled(event: any, topics: any[]): ParsedEvent {
    // call_settled(call_id, winner_count)
    return {
      contractId: event.contractId,
      eventType: EventType.CALL_SETTLED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        callId: this.parseU64(topics[1]),
        winnerCount: this.parseU64(topics[2]),
      },
    };
  }

  private parseAdminChanged(event: any, topics: any[]): ParsedEvent {
    // admin_changed(old_admin, new_admin)
    return {
      contractId: event.contractId,
      eventType: EventType.ADMIN_CHANGED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        oldAdmin: this.parseAddress(topics[1]),
        newAdmin: this.parseAddress(topics[2]),
      },
    };
  }

  private parseOutcomeManagerChanged(event: any, topics: any[]): ParsedEvent {
    // outcome_manager_changed(old_manager, new_manager)
    return {
      contractId: event.contractId,
      eventType: EventType.OUTCOME_MANAGER_CHANGED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        oldManager: this.parseAddress(topics[1]),
        newManager: this.parseAddress(topics[2]),
      },
    };
  }

  private parseOutcomeFinalized(event: any, topics: any[]): ParsedEvent {
    // outcome_finalized(call_id) or finalized(call_id)
    return {
      contractId: event.contractId,
      eventType: EventType.OUTCOME_FINALIZED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        callId: this.parseU64(topics[1]),
      },
    };
  }

  private parseInitialized(event: any, topics: any[]): ParsedEvent {
    // initialized(admin, outcome_manager)
    return {
      contractId: event.contractId,
      eventType: EventType.INITIALIZED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        admin: this.parseAddress(topics[1]),
        outcomeManager: this.parseAddress(topics[2]),
      },
    };
  }

  private parseAdminParamsChanged(event: any, topics: any[]): ParsedEvent {
    // admin_params_changed(param_name, new_value)
    return {
      contractId: event.contractId,
      eventType: EventType.ADMIN_PARAMS_CHANGED,
      ledger: event.ledger,
      txHash: event.txHash,
      txOrder: event.pagingToken,
      timestamp: new Date(event.createdAt),
      eventData: {
        paramName: this.parseBytes(topics[1]),
        newValue: this.parseU32(topics[2]),
      },
    };
  }

  // Helper methods for parsing SCVals
  private parseScVal(scval: any): any {
    // This is a simplified parser - in practice you'd use the stellar-sdk's scval parsing
    // For now, we'll assume the topics are already parsed by the SDK
    return scval;
  }

  private parseAddress(val: any): string {
    // Assuming val is already a string representation of the address
    return val.toString();
  }

  private parseU64(val: any): number {
    return Number(val);
  }

  private parseI128(val: any): string {
    return val.toString();
  }

  private parseU32(val: any): number {
    return Number(val);
  }

  private parseBytes(val: any): string {
    // Convert bytes to hex string
    return Buffer.from(val).toString('hex');
  }

  private parseStakePlaced(event: any) {
    // Logic to decode XDR for StakePlaced
    return {
      staker: '',
      amount: 0,
      callId: '',
    };
  }
}

export interface ParsedEvent {
  creator?: string;
  description?: string;
  contractId: string;
  eventType: EventType;
  ledger: number;
  txHash: string;
  txOrder: string;
  timestamp: Date;
  eventData: any;
}
