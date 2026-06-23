# BACKit — Stellar Architecture

**Complete system design & architecture for Stellar/Soroban (production-ready, opinionated)**

---

## Stack Overview

### Stellar (Soroban) Stack

- **Frontend:** Next.js (App Router) + `@stellar/stellar-sdk` + `@stellar/freighter-api`
- **Wallet / Auth:** Freighter (primary), Lobstr, Albedo, xBull
- **Contracts:** Rust + Soroban SDK, Stellar CLI (`stellar`)
- **Oracle model:** Off-chain ed25519 signer
- **Fees:** Stellar resource fees (~0.0001 XLM per transaction)

### Backend Infrastructure

- **Backend:** NestJS (Oracle worker, relayer, indexer)
- **DB:** PostgreSQL + Redis + BullMQ
- **Price sources:** DexScreener (primary) + StellarX/SDEX (fallback)
- **Indexing:** SorobanRPC `getEvents` + self-managed PostgreSQL persistence
- **Storage:** IPFS for call metadata (Pinata or self-hosted)

---

## Table of Contents

1. Goals & invariants
2. High-level architecture diagrams
3. Component responsibilities
4. On-chain design — Soroban contracts
5. Storage patterns & TTL management
6. Oracle & outcome verification (ed25519)
7. Off-chain backend (NestJS)
8. Frontend — Stellar wallet integration
9. Indexing — SorobanRPC & Horizon
10. Content storage (IPFS)
11. Security & audit checklist
12. Failure modes & mitigations
13. Deployments & CI/CD
14. MVP roadmap
15. Appendices

---

# 1 — Goals & Invariants

- **Calls are immutable prediction objects**: token, condition, stake, startTs, endTs, contentCID (IPFS). On-chain stores minimal metadata only.
- **Support for any token**: DexScreener coverage is required for price resolution. SDEX on-chain prices as fallback.
- **Stakes**: Prefer USDC via Stellar Asset Contract (SAC) for predictable payouts. Native XLM or other Stellar assets possible. Stakes are escrowed on-chain in the contract.
- **Outcome model**: Backend fetches price data at deadline, constructs a canonical message, signs with ed25519 key, and submits `submit_outcome` to contract. Contract verifies signature and settles.
- **User experience**: Low fees (~0.0001 XLM), fast finality (~5 seconds), seamless Freighter wallet integration.
- **Simplicity & scalability**: Keep on-chain logic minimal, index events off-chain, design oracle pipeline to scale from single signer → multiple signers.
- **Security**: Oracle keys stored in KMS/Vault; use multisig for admin actions in production.

---

# 2 — High-Level Architecture Diagrams

## 2.1 System Flow (Overview)

```mermaid
flowchart TD
    User(User) --> Frontend[Next.js Frontend]
    Frontend --> Wallet[Freighter Wallet]
    Wallet --> Contracts[Soroban Smart Contracts]
    Contracts --> EventEmit[Emit Contract Events]
    EventEmit --> Backend[NestJS Indexer Service]
    Backend --> OracleWorker[Oracle Worker]
    OracleWorker --> PriceSign[ed25519 Signed Outcome]
    PriceSign --> Contracts
    Contracts --> Result[Validate & Settle Stakes]
    Result --> Frontend
```

## 2.2 Sequence: Create → Resolve → Payout

```mermaid
sequenceDiagram
  participant U as User (Next.js)
  participant W as Freighter Wallet
  participant C as call_registry (Soroban)
  participant N as NestJS
  participant IP as IPFS
  participant O as OracleWorker
  participant M as outcome_manager (Soroban)

  U->>W: Sign createCall transaction
  W->>C: create_call(...)
  C-->>N: emit CallCreated (via SorobanRPC polling)
  N->>IP: pin call content (CID)
  N->>DB: store call record
  Note over N,O: Wait until call.end_ts
  O->>DexScreener: fetch final price
  O->>KMS: sign ed25519 outcome message
  O->>M: submit_outcome(call_id, outcome, signature)
  M-->>N: emit OutcomeSubmitted
  N->>DB: update call status, notify users
  U->>W: withdraw_payout(call_id)
  W->>M: withdraw_payout(...)
```

---

# 3 — Component Responsibilities

## 3.1 Frontend (Next.js + Stellar SDK)

- **Wallet / Auth**: Freighter wallet connection via `@stellar/freighter-api`; support Lobstr, Albedo as alternatives.
- **Token discovery**: Proxy calls to backend `/tokens/search` which queries DexScreener and caches results.
- **Create Call UI**: Title, thesis, token selector, condition builder (Target/Percent/Range), stake selector (USDC default). Upload thesis to IPFS.
- **Transaction flow**: Build transaction with `@stellar/stellar-sdk`, sign via Freighter, submit to Stellar network.
- **Feeds & Threads**: Pull from PostgreSQL via NestJS endpoints; live updates via WebSocket.
- **Outcome provenance**: Show final price, oracle public key, ed25519 signature and link to evidence (API response pinned to IPFS if required).

## 3.2 Off-chain Backend (NestJS)

- **AuthModule**: Map Stellar public keys → user profiles.
- **CallsModule**: Create drafts, IPFS pinning, transaction building.
- **OracleModule**: Price fetcher, ed25519 signing, outcome submission.
- **IndexerModule**: SorobanRPC `getEvents` polling + PostgreSQL writes.
- **NotificationModule**: WebSocket server for live feed pushes (socket.io).
- **AdminModule**: Moderation, dispute handling.

## 3.3 On-chain (Soroban Contracts)

- **call_registry**: Stores call records, manages stakes, emits `CallCreated`.
- **outcome_manager**: Verifies ed25519 signatures and settles outcomes; supports `withdraw_payout`.
- **No Paymaster needed**: Stellar's low fees (~0.0001 XLM) make gas sponsorship unnecessary.

## 3.4 Indexing & Storage

- **SorobanRPC**: Poll `getEvents` for contract events (7-day retention limit).
- **Self-managed persistence**: Store events immediately in PostgreSQL for permanent history.
- **PostgreSQL**: Main read model for UI and feeds; use `tsvector` for full-text search.
- **IPFS**: Store thesis content, avatars, comments. Pin via Pinata or self-hosted cluster.

---

# 4 — On-chain Design — Soroban Contracts

## 4.1 Contracts & Responsibilities

### call_registry (factory/registry)

- `create_call(...)` — registers call metadata + escrows stake
- `stake_on_call(call_id, amount, position)` — other participants can join (YES/NO positions)
- Emits `CallCreated`, `StakeAdded` events

### outcome_manager

- `submit_outcome(call_id, outcome, final_price, timestamp, public_key, signature)`
- Verifies ed25519 signature via `env.crypto().ed25519_verify()`
- Marks `settled` and emits `OutcomeSubmitted`
- `withdraw_payout(call_id)` — transfers winnings to participants

## 4.2 Contract Structure

```rust
// packages/contracts/call_registry/src/lib.rs (illustrative — see source for latest)
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Map, String,
    token::TokenClient,
};
use crate::types::{Call, ConditionType, ContractConfig};

#[contract]
pub struct CallRegistry;

#[contractimpl]
impl CallRegistry {
    /// Initialize the contract with admin and configuration
    pub fn initialize(env: Env, admin: Address, outcome_manager: Address) { /* ... */ }

    /// Create a new prediction call
    pub fn create_call(
        env: Env,
        creator: Address,
        stake_token: Address,
        stake_amount: i128,
        end_ts: u64,
        token_address: Address,
        pair_id: BytesN<32>,
        ipfs_cid: String,
        start_price: i128,
        condition: ConditionType,
    ) -> u64 {
        // ...
        // The Call struct now uses outcome_stakes: Map<u32, i128> for multi-outcome
        // support (beyond binary UP/DOWN), with fields for cancelled, voided,
        // condition, start_price, and metadata_version.
    }

    /// Add stake to an existing call (supports multi-outcome via position: u32)
    pub fn stake_on_call(
        env: Env,
        staker: Address,
        call_id: u64,
        amount: i128,
        position: u32, // 1 = UP, 2 = DOWN, 3+ = extended outcomes
    ) { /* ... */ }

    /// Cancel a call (creator only, before any third-party stakes)
    pub fn cancel_call(env: Env, creator: Address, call_id: u64) { /* ... */ }

    /// Get call details (view function)
    pub fn get_call(env: Env, call_id: u64) -> Call { /* ... */ }
}
```

> **Note**: The `Call` struct has evolved from a binary `total_stake_yes`/`total_stake_no` model
> to a generalized `outcome_stakes: Map<u32, i128>` multi-outcome model (see `packages/contracts/call_registry/src/types.rs`).
> Key fields include: `id`, `creator`, `stake_token`, `stake_amount`, `end_ts`, `token_address`, `pair_id`,
> `ipfs_cid`, `outcome_count`, `outcome_stakes`, `stakes`, `outcome`, `start_price`, `end_price`,
> `condition: ConditionType`, `settled`, `voided`, `cancelled`, `created_at`, `metadata_version`.

```rust
// packages/contracts/call_registry/src/types.rs (current)
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub id: u64,
    pub creator: Address,
    pub stake_token: Address,
    pub stake_amount: i128,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: Bytes,
    pub ipfs_cid: Bytes,
    pub outcome_count: u32,                  // default 2 for backward compatibility
    pub outcome_stakes: Map<u32, i128>,      // per-outcome total stakes
    pub stakes: Map<u32, Map<Address, i128>>, // per-outcome per-staker stakes
    pub outcome: u32,                        // 0 = unresolved, 1..N = specific outcome
    pub start_price: i128,
    pub end_price: i128,
    pub condition: ConditionType,            // on-chain condition enum
    pub settled: bool,
    pub voided: bool,                        // admin-voided (triggers full refunds)
    pub cancelled: bool,                     // creator-cancelled
    pub created_at: u64,
    pub metadata_version: u32,
}
```

## 4.3 Outcome Manager Contract

```rust
// packages/contracts/outcome_manager/src/lib.rs
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env,
    token::TokenClient,
};

#[contracttype]
pub enum DataKey {
    AuthorizedOracle(BytesN<32>), // ed25519 public key
    Settled(u64),
    CallRegistry,
    Admin,
}

#[contract]
pub struct OutcomeManager;

#[contractimpl]
impl OutcomeManager {
    /// Initialize with admin and authorized oracle
    pub fn initialize(
        env: Env,
        admin: Address,
        call_registry: Address,
        oracle_pubkey: BytesN<32>,
    ) {
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CallRegistry, &call_registry);
        env.storage().instance().set(&DataKey::AuthorizedOracle(oracle_pubkey), &true);
    }

    /// Add an authorized oracle
    pub fn add_oracle(env: Env, oracle_pubkey: BytesN<32>) {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::AuthorizedOracle(oracle_pubkey), &true);
    }

    /// Submit outcome with ed25519 signature verification
    pub fn submit_outcome(
        env: Env,
        call_id: u64,
        outcome: bool,
        final_price: i128,
        timestamp: u64,
        public_key: BytesN<32>,
        signature: BytesN<64>,
    ) {
        // Check not already settled
        let settled: bool = env.storage().persistent()
            .get(&DataKey::Settled(call_id))
            .unwrap_or(false);
        assert!(!settled, "Already settled");

        // Verify oracle is authorized
        let is_authorized: bool = env.storage().instance()
            .get(&DataKey::AuthorizedOracle(public_key.clone()))
            .unwrap_or(false);
        assert!(is_authorized, "Unauthorized oracle");

        // Construct message to verify
        // Format: "BACKit:Outcome:{call_id}:{outcome}:{final_price}:{timestamp}"
        let message = Self::build_outcome_message(&env, call_id, outcome, final_price, timestamp);

        // Verify ed25519 signature
        env.crypto().ed25519_verify(&public_key, &message, &signature);

        // Mark settled
        env.storage().persistent().set(&DataKey::Settled(call_id), &true);

        // Emit event
        env.events().publish(
            (symbol_short!("Outcome"), call_id),
            (outcome, final_price, public_key)
        );
    }

    /// Build canonical message for signature verification
    fn build_outcome_message(
        env: &Env,
        call_id: u64,
        outcome: bool,
        final_price: i128,
        timestamp: u64,
    ) -> Bytes {
        // Construct canonical byte message
        let mut message = Bytes::new(env);

        // Prefix
        message.append(&Bytes::from_slice(env, b"BACKit:Outcome:"));

        // Call ID as bytes
        message.append(&Self::u64_to_bytes(env, call_id));
        message.append(&Bytes::from_slice(env, b":"));

        // Outcome
        message.append(&Bytes::from_slice(env, if outcome { b"1" } else { b"0" }));
        message.append(&Bytes::from_slice(env, b":"));

        // Final price
        message.append(&Self::i128_to_bytes(env, final_price));
        message.append(&Bytes::from_slice(env, b":"));

        // Timestamp
        message.append(&Self::u64_to_bytes(env, timestamp));

        message
    }

    fn u64_to_bytes(env: &Env, val: u64) -> Bytes {
        // Simple conversion for message construction
        Bytes::from_slice(env, &val.to_be_bytes())
    }

    fn i128_to_bytes(env: &Env, val: i128) -> Bytes {
        Bytes::from_slice(env, &val.to_be_bytes())
    }

    /// Withdraw payout for a settled call
    pub fn withdraw_payout(env: Env, caller: Address, call_id: u64) {
        caller.require_auth();

        // Implementation: calculate share and transfer
        // This would interact with call_registry to get call details
        // and distribute winnings based on stake position

        env.events().publish(
            (symbol_short!("Payout"), call_id),
            (caller,)
        );
    }
}
```

---

# 5 — Storage Patterns & TTL Management

## 5.1 Storage Types

Soroban provides three storage types with different characteristics:

| Storage Type   | Characteristics                             | Use Cases                          | Limit            |
| -------------- | ------------------------------------------- | ---------------------------------- | ---------------- |
| **Instance**   | Loaded every call, shared TTL with contract | Config, admin address, oracle list | 64 KB total      |
| **Persistent** | Per-key, archivable but restorable          | Call data, user stakes             | Per-entry limits |
| **Temporary**  | Auto-deleted when TTL expires               | Price cache, session data          | Per-entry limits |

## 5.2 Storage Selection for BACKit

```rust
// Instance storage (loaded with every invocation)
env.storage().instance().set(&DataKey::Config, &config);
env.storage().instance().set(&DataKey::AuthorizedOracle(pubkey), &true);

// Persistent storage (archived after TTL, can be restored)
env.storage().persistent().set(&DataKey::Call(call_id), &call);
env.storage().persistent().set(&DataKey::UserStake(call_id, user, position), &amount);

// Temporary storage (deleted after TTL, NOT restorable)
env.storage().temporary().set(&DataKey::PriceCache(pair_id), &price);
```

## 5.3 TTL Extension

To prevent state archival, extend TTL proactively:

```rust
// Constants for TTL management
const INSTANCE_LIFETIME_THRESHOLD: u32 = 17280;  // ~1 day in ledgers
const INSTANCE_BUMP_AMOUNT: u32 = 518400;        // ~30 days in ledgers

// Extend instance storage TTL (includes all instance data)
env.storage().instance().extend_ttl(
    INSTANCE_LIFETIME_THRESHOLD,
    INSTANCE_BUMP_AMOUNT
);

// Extend specific persistent entry TTL
env.storage().persistent().extend_ttl(
    &DataKey::Call(call_id),
    INSTANCE_LIFETIME_THRESHOLD,
    INSTANCE_BUMP_AMOUNT
);
```

## 5.4 Best Practices

1. **Avoid unbounded data in instance storage** — Instance storage is limited to 64KB and loaded with every call
2. **Use persistent for user data** — Stakes and call data should be in persistent storage
3. **Extend TTL on interaction** — When a user interacts with a call, extend its TTL
4. **Backend TTL automation** — Run a cron job to extend TTL for active calls

---

# 6 — Oracle & Outcome Verification (ed25519)

## 6.1 Why ed25519?

- Native to Stellar ecosystem (all Stellar keys are ed25519)
- Fast and secure verification
- Direct verification via `env.crypto().ed25519_verify()`
- No additional libraries needed in contracts

## 6.2 Message Format

The oracle constructs a deterministic message for signing:

```typescript
// oracle.service.ts
import nacl from "tweetnacl";
import { Keypair } from "@stellar/stellar-sdk";

function signOutcome(
  callId: number,
  outcome: boolean,
  finalPrice: bigint,
  timestamp: number,
): { signature: Buffer; publicKey: Buffer } {
  // Construct canonical message matching contract format
  const callIdBytes = Buffer.alloc(8);
  callIdBytes.writeBigUInt64BE(BigInt(callId));

  const priceBytes = Buffer.alloc(16);
  priceBytes.writeBigInt64BE(finalPrice, 8);

  const timestampBytes = Buffer.alloc(8);
  timestampBytes.writeBigUInt64BE(BigInt(timestamp));

  const message = Buffer.concat([
    Buffer.from("BACKit:Outcome:"),
    callIdBytes,
    Buffer.from(":"),
    Buffer.from(outcome ? "1" : "0"),
    Buffer.from(":"),
    priceBytes,
    Buffer.from(":"),
    timestampBytes,
  ]);

  // Sign with ed25519 private key (from KMS in production)
  const keypair = Keypair.fromSecret(process.env.ORACLE_SECRET_KEY);
  const signature = nacl.sign.detached(message, keypair.rawSecretKey());

  return {
    signature: Buffer.from(signature),
    publicKey: keypair.rawPublicKey(),
  };
}
```

## 6.3 Verification Flow

```mermaid
sequenceDiagram
  participant O as OracleWorker
  participant K as KMS/Vault
  participant C as outcome_manager

  O->>O: Build canonical message
  O->>K: Sign message with ed25519 key
  K-->>O: Return signature
  O->>C: submit_outcome(call_id, outcome, price, ts, pubkey, sig)
  C->>C: Rebuild message from parameters
  C->>C: env.crypto().ed25519_verify(pubkey, message, sig)
  C->>C: Mark settled, emit event
```

## 6.4 Oracle Key Management

- **Development**: Store key in environment variable
- **Production**: Use HashiCorp Vault, AWS KMS, or GCP Cloud KMS
- **Key rotation**: Add new oracle pubkey → deauthorize old key → rotate
- **Multisig future**: Scale to requiring N-of-M signatures

---

# 7 — Off-chain Backend (NestJS)

## 7.1 Core Modules

```
/packages/backend
├── src/
│   ├── auth/           # Stellar public key → user profile mapping
│   ├── calls/          # Call creation, IPFS pinning
│   ├── oracle/         # Price fetching, ed25519 signing
│   ├── indexer/        # SorobanRPC event polling
│   ├── tokens/         # Token discovery, DexScreener proxy
│   ├── notifications/  # WebSocket push (socket.io)
│   └── admin/          # Moderation, disputes
```

## 7.2 Oracle Worker

```typescript
// oracle/oracle.worker.ts
@Injectable()
export class OracleWorker {
  @Cron("*/30 * * * * *") // Every 30 seconds
  async processDueCalls() {
    const dueCalls = await this.db.query(`
      SELECT * FROM calls 
      WHERE end_ts <= NOW() 
        AND status = 'OPEN' 
      FOR UPDATE SKIP LOCKED
    `);

    for (const call of dueCalls) {
      try {
        // Fetch final price
        const price = await this.fetchPrice(call.pair_id);
        if (!price) {
          await this.markUnresolved(call.id);
          continue;
        }

        // Evaluate condition
        const outcome = this.evaluateCondition(call.condition_json, price);

        // Sign outcome
        const { signature, publicKey } = this.signOutcome(
          call.id,
          outcome,
          price,
          Date.now(),
        );

        // Submit to contract
        await this.submitOutcome(call, outcome, price, signature, publicKey);

        // Update DB
        await this.db.update(call.id, {
          status: "SETTLING",
          final_price: price,
          oracle_signature: signature.toString("hex"),
        });
      } catch (error) {
        this.logger.error(`Failed to process call ${call.id}`, error);
      }
    }
  }
}
```

## 7.3 Price Sources

1. **Primary: DexScreener**
   - Wide coverage including memecoins
   - API: `https://api.dexscreener.com/latest/dex/pairs/stellar/{pairAddress}`

2. **Fallback: StellarX / SDEX**
   - Native Stellar DEX orderbook
   - API: Horizon `GET /order_book?selling_asset=...&buying_asset=...`

---

# 8 — Frontend — Stellar Wallet Integration

## 8.1 Wallet Connection

```typescript
// lib/wallet.ts
import freighter from "@stellar/freighter-api";

export async function connectWallet(): Promise<string | null> {
  try {
    // Check if Freighter is installed
    const isInstalled = await freighter.isConnected();
    if (!isInstalled) {
      window.open("https://freighter.app", "_blank");
      return null;
    }

    // Request access
    const hasAccess = await freighter.isAllowed();
    if (!hasAccess) {
      await freighter.setAllowed();
    }

    // Get public key
    const publicKey = await freighter.getPublicKey();
    return publicKey;
  } catch (error) {
    console.error("Wallet connection failed:", error);
    return null;
  }
}

export async function getNetwork(): Promise<string> {
  const networkDetails = await freighter.getNetworkDetails();
  return networkDetails.network; // 'TESTNET' or 'PUBLIC'
}
```

## 8.2 Transaction Signing

```typescript
// lib/transactions.ts
import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Contract,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import freighter from "@stellar/freighter-api";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

export async function createCall(
  callerPublicKey: string,
  stakeToken: string,
  stakeAmount: bigint,
  endTs: number,
  tokenAddress: string,
  pairId: string,
  ipfsCid: string,
): Promise<string> {
  const account = await server.getAccount(callerPublicKey);

  const contract = new Contract(CALL_REGISTRY_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "create_call",
        Address.fromString(callerPublicKey).toScVal(),
        Address.fromString(stakeToken).toScVal(),
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            hi: BigInt(stakeAmount >> 64n),
            lo: BigInt(stakeAmount & 0xffffffffffffffffn),
          }),
        ),
        xdr.ScVal.scvU64(xdr.Uint64.fromBigInt(BigInt(endTs))),
        Address.fromString(tokenAddress).toScVal(),
        // ... other params
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate to get resource estimate
  const simulated = await server.simulateTransaction(tx);
  const prepared = SorobanRpc.assembleTransaction(tx, simulated);

  // Sign with Freighter
  const signedXDR = await freighter.signTransaction(prepared.toXDR(), {
    networkPassphrase: Networks.TESTNET,
  });

  // Submit
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedXDR, Networks.TESTNET),
  );

  return result.hash;
}
```

## 8.3 Multi-Wallet Support

```typescript
// Support multiple wallets
export type WalletType = "freighter" | "lobstr" | "albedo";

export async function connectWallet(type: WalletType): Promise<string | null> {
  switch (type) {
    case "freighter":
      return connectFreighter();
    case "lobstr":
      // LOBSTR wallet uses WalletConnect
      return connectLobstrWC();
    case "albedo":
      return connectAlbedo();
    default:
      throw new Error("Unknown wallet type");
  }
}
```

---

# 9 — Indexing — SorobanRPC & Horizon

## 9.1 Event Polling Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────┐
│  SorobanRPC     │────▶│  IndexerService  │────▶│ PostgreSQL │
│  getEvents()    │     │  (NestJS)        │     │            │
└─────────────────┘     └──────────────────┘     └────────────┘
        │                        │
        │                        ▼
        │               ┌──────────────────┐
        │               │  WebSocket Push  │
        │               └──────────────────┘
        │
        ▼
   7-day retention limit
   (must persist immediately)
```

## 9.2 Indexer Implementation

```typescript
// indexer/indexer.service.ts
import { SorobanRpc } from "@stellar/stellar-sdk";

@Injectable()
export class IndexerService {
  private lastProcessedLedger: number = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly ws: WebSocketGateway,
  ) {}

  @Cron("*/5 * * * * *") // Every 5 seconds
  async pollEvents() {
    const server = new SorobanRpc.Server(process.env.SOROBAN_RPC_URL);

    try {
      const response = await server.getEvents({
        startLedger: this.lastProcessedLedger || (await this.getLatestLedger()),
        filters: [
          {
            type: "contract",
            contractIds: [
              process.env.CALL_REGISTRY_CONTRACT_ID,
              process.env.OUTCOME_MANAGER_CONTRACT_ID,
            ],
          },
        ],
        pagination: { limit: 100 },
      });

      for (const event of response.events) {
        await this.processEvent(event);
      }

      if (response.latestLedger) {
        this.lastProcessedLedger = response.latestLedger;
        await this.saveCheckpoint(response.latestLedger);
      }
    } catch (error) {
      this.logger.error("Event polling failed", error);
    }
  }

  private async processEvent(event: SorobanRpc.Api.EventInfo) {
    const topic = event.topic[0]; // First topic is event name

    switch (topic) {
      case "CallCrtd":
        await this.handleCallCreated(event);
        break;
      case "StakeAdd":
        await this.handleStakeAdded(event);
        break;
      case "Outcome":
        await this.handleOutcome(event);
        break;
      case "Payout":
        await this.handlePayout(event);
        break;
    }

    // Push to connected clients
    this.ws.emitEvent(event);
  }
}
```

## 9.3 Data Retention Strategy

> **Important**: SorobanRPC only retains events for 7 days (24 hours by default).
> Your indexer MUST persist events immediately.

Options:

1. **Self-managed** (recommended): Poll every 5 seconds, store in PostgreSQL
2. **Mercury**: Third-party indexing service (https://mercurydata.app)
3. **SubQuery**: Decentralized indexing (https://subquery.network)

---

# 10 — Content Storage (IPFS)

## 10.1 What to Store

- **Call thesis**: Full text content, images, embedded media
- **Oracle evidence**: Price API responses at resolution time
- **User profiles**: Avatars, bios

## 10.2 Pinning Strategy

```typescript
// storage/ipfs.service.ts
import { PinataSDK } from "pinata-web3";

@Injectable()
export class IpfsService {
  private pinata: PinataSDK;

  async pinCallContent(content: CallContent): Promise<string> {
    const json = JSON.stringify({
      title: content.title,
      thesis: content.thesis,
      condition: content.condition,
      createdAt: new Date().toISOString(),
    });

    const result = await this.pinata.upload.json(JSON.parse(json));
    return result.IpfsHash;
  }

  async pinOracleEvidence(evidence: OracleEvidence): Promise<string> {
    const result = await this.pinata.upload.json({
      callId: evidence.callId,
      apiResponse: evidence.priceData,
      timestamp: evidence.timestamp,
      source: evidence.source,
    });
    return result.IpfsHash;
  }
}
```

---

# 11 — Security & Audit Checklist

## 11.1 Soroban Contracts

- [ ] Use `require_auth()` for all state-changing operations
- [ ] Use `panic_with_error!` instead of bare `panic!` for proper error codes
- [ ] Validate all `Vec<T>` and `Map<K, V>` inputs (can contain invalid data)
- [ ] Avoid unbounded data in instance storage (64KB limit, loaded every call)
- [ ] Implement TTL extension for critical persistent data
- [ ] No reentrancy possible in Soroban (single-threaded execution)
- [ ] Test with fuzzing via `cargo fuzz`

## 11.2 Oracle Security

- [ ] Store ed25519 keys in KMS/Vault (never in code or env in production)
- [ ] Implement key rotation mechanism
- [ ] Log all signed messages with timestamps
- [ ] Pin price API evidence to IPFS for auditability
- [ ] Rate limit oracle submissions

## 11.3 Backend

- [ ] Validate all API inputs with class-validator
- [ ] Rate limit public endpoints
- [ ] Implement request timeouts for external APIs
- [ ] Use parameterized queries (prevent SQL injection)
- [ ] HTTPS only, proper CORS configuration

## 11.4 Frontend

- [ ] Validate transaction parameters before signing
- [ ] Show clear transaction details to users
- [ ] Handle wallet disconnection gracefully
- [ ] Implement retry logic for failed transactions

---

# 12 — Failure Modes & Mitigations

| Failure Mode               | Impact                 | Mitigation                                                  |
| -------------------------- | ---------------------- | ----------------------------------------------------------- |
| **Price API outage**       | Cannot resolve calls   | Fallback to SDEX prices; mark UNRESOLVED if both fail       |
| **Oracle key compromise**  | Malicious outcomes     | Pause contract via admin; rotate keys; audit logs           |
| **SorobanRPC unavailable** | Cannot index events    | Self-host Stellar Core + SorobanRPC; use multiple endpoints |
| **Liquidity manipulation** | Incorrect outcomes     | Enforce minimum liquidity thresholds; use TWAP              |
| **State archival**         | Call data inaccessible | Proactive TTL extension; backend automation                 |
| **Spam attacks**           | Resource exhaustion    | Minimum stake requirement; rate limiting                    |

---

# 13 — Deployments & CI/CD

## 13.1 Stellar CLI Commands

```bash
# Install Stellar CLI
cargo install stellar-cli --features opt

# Build contracts
stellar contract build

# Run tests
cargo test

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/call_registry.wasm \
  --network testnet \
  --source-account $STELLAR_SECRET_KEY

# Deploy SAC for USDC (mainnet issuer address)
stellar contract asset deploy \
  --asset USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN \
  --network mainnet \
  --source-account $STELLAR_SECRET_KEY

# Initialize contract
stellar contract invoke \
  --id $CALL_REGISTRY_CONTRACT_ID \
  --network testnet \
  --source-account $STELLAR_SECRET_KEY \
  -- initialize \
  --admin $ADMIN_ADDRESS \
  --outcome_manager $OUTCOME_MANAGER_CONTRACT_ID

# Invoke function
stellar contract invoke \
  --id $CALL_REGISTRY_CONTRACT_ID \
  --network testnet \
  -- get_call \
  --call_id 1
```

## 13.2 Contract Directory Structure

```
/packages/contracts
├── Cargo.toml
├── call_registry/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── outcome_manager/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
└── shared/
    └── src/
        └── lib.rs
```

## 13.3 CI/CD Pipeline

```yaml
# .github/workflows/contracts.yml
name: Soroban Contracts

on: [push, pull_request]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: wasm32-unknown-unknown

      - name: Install Stellar CLI
        run: cargo install stellar-cli --features opt

      - name: Build contracts
        run: stellar contract build
        working-directory: packages/contracts

      - name: Run tests
        run: cargo test
        working-directory: packages/contracts

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: wasm-contracts
          path: target/wasm32-unknown-unknown/release/*.wasm
```

---

# 14 — MVP Roadmap

## Sprint 0 (1 week) — Scaffolding

- [ ] Soroban contract skeleton + basic tests
- [ ] Next.js + Freighter wallet integration demo
- [ ] NestJS skeleton + PostgreSQL schema
- [ ] IPFS pinning service setup

## Sprint 1 (2–3 weeks) — Core Flows

- [ ] Implement `call_registry` contract with tests
- [ ] Implement `outcome_manager` contract with tests
- [ ] Deploy SAC for USDC on testnet
- [ ] Create Call UI + Freighter transaction signing
- [ ] SorobanRPC event indexer → PostgreSQL

## Sprint 2 (2 weeks) — Oracle Automation

- [ ] OracleWorker: DexScreener integration
- [ ] ed25519 key management (dev: env, prod: KMS)
- [ ] Relayer: submit_outcome transactions
- [ ] Withdraw payout flow
- [ ] Real-time notifications via WebSocket

## Sprint 3 (2 weeks) — Production Readiness

- [ ] TTL management automation
- [ ] Liquidity threshold checks
- [ ] Moderation UI for admins
- [ ] Comprehensive testing + fuzzing
- [ ] Mainnet deployment preparation
- [ ] Security review

---

# 15 — Appendices

## Appendix A — PostgreSQL Schema

```sql
CREATE TABLE users (
  stellar_address VARCHAR(56) PRIMARY KEY,
  display_name TEXT,
  avatar_cid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE calls (
  id SERIAL PRIMARY KEY,
  call_onchain_id BIGINT UNIQUE,
  creator_address VARCHAR(56) REFERENCES users(stellar_address),
  ipfs_cid TEXT NOT NULL,
  token_address VARCHAR(56),
  pair_id TEXT,
  stake_token VARCHAR(56),
  outcome_count INT DEFAULT 2,
  outcome_stakes JSONB,        -- Map<u32, i128> per-outcome totals (replaces total_stake_yes/no)
  start_ts TIMESTAMPTZ,
  end_ts TIMESTAMPTZ,
  condition_json JSONB,        -- ConditionType: TargetAbove/Below, PercentUp/Down, Range
  status VARCHAR DEFAULT 'OPEN', -- OPEN, SETTLING, RESOLVED, UNRESOLVED, PAUSED, CANCELLED, VOIDED
  outcome INT,                 -- 0 = unresolved, 1..N = specific outcome
  final_price NUMERIC,
  oracle_pubkey TEXT,
  oracle_signature TEXT,
  evidence_cid TEXT,
  cancelled BOOLEAN DEFAULT FALSE,
  voided BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_end_ts ON calls(end_ts);
CREATE INDEX idx_calls_creator ON calls(creator_address);

CREATE TABLE participants (
  id SERIAL PRIMARY KEY,
  call_id INT REFERENCES calls(id),
  stellar_address VARCHAR(56),
  stake_amount NUMERIC,
  position BOOLEAN, -- true = YES, false = NO
  payout_claimed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_participants_call ON participants(call_id);
CREATE INDEX idx_participants_address ON participants(stellar_address);

CREATE TABLE events_log (
  id SERIAL PRIMARY KEY,
  ledger_sequence BIGINT,
  contract_id TEXT,
  topic TEXT,
  event_data JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_ledger ON events_log(ledger_sequence);
```

## Appendix B — Ed25519 Signature Format

```typescript
// Backend signature generation
interface OracleSignature {
  callId: number;
  outcome: boolean;
  finalPrice: string; // Stringified bigint
  timestamp: number; // Unix timestamp in seconds
  publicKey: string; // Hex-encoded 32-byte ed25519 public key
  signature: string; // Hex-encoded 64-byte ed25519 signature
}

// Message format (canonical byte representation)
// "BACKit:Outcome:" + callId(8 bytes BE) + ":" + outcome("0"|"1") + ":" + price(16 bytes BE) + ":" + timestamp(8 bytes BE)
```

## Appendix C — Environment Variables

```bash
# .env.example

# Stellar Network
STELLAR_NETWORK=testnet  # or 'mainnet'
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org

# Contract Addresses (set after deployment)
CALL_REGISTRY_CONTRACT_ID=CXXXXXX...
OUTCOME_MANAGER_CONTRACT_ID=CXXXXXX...
USDC_SAC_CONTRACT_ID=CXXXXXX...

# Oracle (use KMS in production)
ORACLE_SECRET_KEY=SXXXXXX...

# IPFS
PINATA_API_KEY=xxx
PINATA_SECRET_KEY=xxx

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/backit

# Redis
REDIS_URL=redis://localhost:6379

# Price APIs
DEXSCREENER_API_URL=https://api.dexscreener.com
```

## Appendix D — Sequence Diagram (Full Flow)

```mermaid
sequenceDiagram
  participant U as User
  participant F as Frontend (Next.js)
  participant W as Freighter Wallet
  participant IP as IPFS (Pinata)
  participant CR as call_registry
  participant I as Indexer (NestJS)
  participant DB as PostgreSQL
  participant O as OracleWorker
  participant DS as DexScreener
  participant OM as outcome_manager

  Note over U,OM: === CREATE CALL ===
  U->>F: Fill call form (token, condition, stake)
  F->>IP: Pin thesis content
  IP-->>F: Return CID
  F->>F: Build transaction
  F->>W: Request signature
  W->>U: Approve transaction
  U-->>W: Confirm
  W->>CR: Submit create_call tx
  CR->>CR: Validate, escrow stake
  CR-->>I: Emit CallCreated event
  I->>DB: Store call record
  I->>F: Push notification via WebSocket

  Note over U,OM: === WAIT FOR END TIME ===

  Note over U,OM: === RESOLVE CALL ===
  O->>DB: Query due calls
  O->>DS: Fetch final price
  DS-->>O: Price data
  O->>IP: Pin price evidence
  O->>O: Sign outcome (ed25519)
  O->>OM: submit_outcome(...)
  OM->>OM: Verify signature
  OM-->>I: Emit OutcomeSubmitted
  I->>DB: Update call status
  I->>F: Push notification

  Note over U,OM: === CLAIM PAYOUT ===
  U->>F: Click "Claim Payout"
  F->>W: Request signature
  W->>OM: withdraw_payout tx
  OM->>OM: Calculate share
  OM->>U: Transfer winnings
  OM-->>I: Emit Payout
```

---

# Closing Notes

This architecture document provides a complete, Stellar-native system design for BACKit. Key differentiators from EVM-based approaches:

1. **Native ed25519 signatures** — No need for complex EIP-712 typed data
2. **Very low fees** — No need for Paymaster/gas sponsorship
3. **Stellar Asset Contract (SAC)** — Native USDC integration without bridges
4. **Soroban storage model** — Three-tier storage with TTL management
5. **5-second finality** — Fast, deterministic transaction confirmation

For any questions or to request additional detail on specific components, please open an issue or reach out to the development team.
