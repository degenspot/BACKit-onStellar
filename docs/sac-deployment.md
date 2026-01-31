# USDC SAC Deployment Guide

This document outlines the deployment details for the USDC Stellar Asset Contract (SAC) on both Testnet and Mainnet.

## 🚨 Critical Warning
The USDC Issuer Address is **different** on Testnet and Mainnet. 
Do NOT use the Testnet issuer address for Mainnet deployment.

## Contract Addresses

| Network | Asset Code | Issuer Address | Contract ID (SAC) |
|---------|------------|----------------|-------------------|
| **Testnet** | USDC | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| **Mainnet** | USDC | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | *To be deployed* |

## Deployment Steps

To deploy the SAC (Soroban Asset Contract) wrapper for USDC:

1. **Configure Network:** Ensure your `stellar-cli` is pointing to the correct network.
2. **Run Deployment Command:**

**For Mainnet (Production):**
```bash
stellar contract asset deploy \
  --asset USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN \
  --network mainnet \
  --source <YOUR_MAINNET_ADMIN_KEY>