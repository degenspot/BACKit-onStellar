# Platform Settings Contract Indexer

## Overview

This implementation adds platform settings synchronization from smart contract events to the backend database. The system listens for `AdminParamsChanged` contract events and automatically updates platform configuration variables like `feePercent`.

## Components

### 1. PlatformSettings Entity

**Location:** `packages/backend/src/indexer/entities/platform-settings.entity.ts`

Singleton entity that stores platform configuration:

- `feePercent`: Platform fee percentage
- `lastUpdatedByTxHash`: Transaction hash of last update
- `lastUpdatedAtLedger`: Ledger number of last update
- Timestamps: `createdAt`, `updatedAt`

### 2. Event Type Extension

**Location:** `packages/backend/src/indexer/event-log.entity.ts`

Added `ADMIN_PARAMS_CHANGED` to the `EventType` enum to track parameter change events.

### 3. Event Parser Update

**Location:** `packages/backend/src/indexer/event-parser.ts`

Added `parseAdminParamsChanged()` method to parse `admin_params_changed` events:

- Extracts parameter name and new value from event topics
- Returns structured event data for storage

### 4. Platform Settings Service

**Location:** `packages/backend/src/indexer/platform-settings.service.ts`

Background service that:

- Runs every 30 seconds via cron job
- Fetches new contract events from the last processed ledger
- Filters for `ADMIN_PARAMS_CHANGED` events
- Updates the PlatformSettings entity
- Logs all parameter changes

### 5. Indexer Service Extension

**Location:** `packages/backend/src/indexer/indexer.service.ts`

Added methods:

- `getPlatformSettings()`: Retrieves current platform settings (creates default if not exists)
- `updatePlatformSettings()`: Updates settings based on contract events

### 6. Config Endpoint

**Location:** `packages/backend/src/indexer/indexer.controller.ts`

New endpoint: `GET /indexer/config`

Returns current platform configuration:

```json
{
  "feePercent": 5,
  "lastUpdatedByTxHash": "abc123...",
  "lastUpdatedAtLedger": 12345,
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## Configuration

Set the following environment variables:

- `STELLAR_CONTRACT_ID`: Smart contract address to monitor
- `STELLAR_RPC_URL`: Stellar RPC endpoint (defaults to testnet)

## Usage

### Accessing Platform Settings

```typescript
// In any service
constructor(private readonly indexerService: IndexerService) {}

async getConfig() {
  const settings = await this.indexerService.getPlatformSettings();
  console.log(`Current fee: ${settings.feePercent}%`);
}
```

### API Endpoint

```bash
# Get current platform configuration
curl http://localhost:3000/indexer/config
```

## Event Flow

1. Admin updates parameters on smart contract
2. Contract emits `admin_params_changed` event
3. PlatformSettingsService detects event (every 30s)
4. Event is parsed and stored in `event_logs` table
5. PlatformSettings entity is updated
6. New configuration is immediately available via API

## Database Schema

### platform_settings table

```sql
CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  fee_percent INTEGER DEFAULT 0,
  last_updated_by_tx_hash VARCHAR(64),
  last_updated_at_ledger BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Testing

The service will automatically create a default PlatformSettings record on first access with:

- `feePercent`: 0
- Other fields: null

Monitor logs for sync activity:

```
[PlatformSettingsService] Platform Settings Service initialized. Last processed ledger: 12345
[PlatformSettingsService] Updated platform setting: fee_percent = 5 (ledger: 12346)
```

## Future Enhancements

- Add more configurable parameters (e.g., minimum stake, max duration)
- Add webhook notifications for parameter changes
- Add admin UI for viewing parameter history
- Add validation for parameter values
