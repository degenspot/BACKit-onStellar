# Environment variables reference catalog

This document catalogs all environment variables used across the BACKit (StellarRoute) codebase, their purpose, example values, and guidance for development vs production.

## How to use
- Copy relevant variables into your local `.env` file during development.
- Never commit secrets (private keys, API secrets) into source control.
- In production, use a secrets manager or KMS and do not store raw secrets in `.env` files.

## Environment variables

- **STELLAR_NETWORK**: Which Stellar network to use. Example: `testnet` or `mainnet`. Default for development: `testnet`.
  - Required: yes
  - Used by: backend services, integration tests, frontend network selection.

- **SOROBAN_RPC_URL**: URL for the Soroban RPC endpoint. Example: `https://soroban-testnet.stellar.org`.
  - Required: yes
  - Used by: contract interaction code and services that query Soroban.

- **HORIZON_URL**: Horizon server URL. Example: `https://horizon-testnet.stellar.org`.
  - Required: yes
  - Used by: services interacting with Stellar ledger via Horizon.

- **CALL_REGISTRY_CONTRACT_ID**: Contract ID for the deployed Call Registry contract.
  - Required: set after deploying the contract to a network.
  - Format: Soroban contract id (starting with `C...`).

- **OUTCOME_MANAGER_CONTRACT_ID**: Contract ID for the Outcome Manager contract.
  - Required: set after deploying the contract.

- **USDC_SAC_CONTRACT_ID**: Contract ID for the USDC SAC contract (if used).
  - Required: set if the USDC contract is integrated.

- **ORACLE_SECRET_KEY**: Oracle secret key used to sign outcomes. In production, use a KMS; do NOT store raw secrets in the repo.
  - Required: yes for oracle services
  - Security: treat as secret — add to secret manager or environment only.

- **PINATA_API_KEY** and **PINATA_SECRET_KEY**: Credentials for Pinata IPFS service used to pin metadata.
  - Required: only if using Pinata for IPFS pinning.

- **DATABASE_URL**: Postgres connection string. Example: `postgresql://user:pass@localhost:5432/backit`.
  - Required: yes for backend services that persist state.

## Example `.env` (development)

```
# Stellar Network
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org

# Contract IDs (populate after deployment)
CALL_REGISTRY_CONTRACT_ID=
OUTCOME_MANAGER_CONTRACT_ID=
USDC_SAC_CONTRACT_ID=

# Oracle (use KMS in production)
ORACLE_SECRET_KEY=

# IPFS / Pinata
PINATA_API_KEY=
PINATA_SECRET_KEY=

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/backit
```

## Security recommendations

- Use a secrets manager (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault) for production secrets.
- Rotate keys regularly and audit access.
- Limit the scope of any API keys used for third-party services.

## Where these variables are referenced
- See code references (search for `process.env` in the repository) to find exact usage sites.

If you need the project to provide sample `.env` templates per package (backend/frontend), request a follow-up and I can add `packages/*/.env.example` files.
