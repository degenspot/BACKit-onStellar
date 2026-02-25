import { Logger } from '@nestjs/common';
import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { AdminParamsChangedEvent } from '../../config/config.service';

const logger = new Logger('AdminParamsParser');

/**
 * Topic layout emitted by the Rust contract:
 *
 *   events::emit_admin_params_changed(&env, fee_percent, contract_id);
 *
 * topics[0] = Symbol("AdminParamsChanged")   — event discriminator
 * topics[1] = Symbol("fee_percent")          — field name
 * data       = { fee_percent: i128, contract_id: Address, oracle_contract_id: Address }
 *
 * All fields are optional — the contract may emit partial updates.
 */
export function parseAdminParamsChanged(
  topics: xdr.ScVal[],
  data: xdr.ScVal,
  txHash: string,
  ledger: number,
): AdminParamsChangedEvent | null {
  try {
    // topics[0] must be the Symbol "AdminParamsChanged"
    const discriminator = topics[0];
    if (
      discriminator.switch() !== xdr.ScValType.scvSymbol() ||
      discriminator.sym().toString() !== 'AdminParamsChanged'
    ) {
      return null;
    }

    // Decode the map payload — scValToNative converts Soroban types to JS
    const payload = scValToNative(data) as Record<string, unknown>;

    const event: AdminParamsChangedEvent = { txHash, ledger };

    // fee_percent arrives as a basis-point integer (e.g. 150 = 1.50%)
    if (payload['fee_percent'] !== undefined) {
      event.feePercent = Number(payload['fee_percent']) / 100;
    }

    if (payload['contract_id'] !== undefined) {
      event.contractId = String(payload['contract_id']);
    }

    if (payload['oracle_contract_id'] !== undefined) {
      event.oracleContractId = String(payload['oracle_contract_id']);
    }

    return event;
  } catch (err: any) {
    logger.error(`Failed to parse AdminParamsChanged event: ${err.message}`);
    return null;
  }
}