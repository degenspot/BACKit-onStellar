# Back It (On Stellar)

**Back It (On Stellar)** is a social prediction market platform built on **Stellar** (using Soroban for smart contracts).  
It allows users to create "calls" (predictions), back them with onchain stakes, and build a reputation based on accuracy.

## 🚀 Features

- **Create Calls**: Make bold predictions about crypto, culture, or tech.
- **Back & Counter**: Stake on "YES" or "NO" outcomes.
- **Social Feed**:
  - **For You**: Algorithmic feed of trending calls.
  - **Following**: See calls from users you follow.
- **User Profiles**: Track your reputation, follower counts, and betting history.
- **Onchain Accountability**: All stakes and outcomes are recorded on Stellar.

## 🛠 Tech Stack

- **Frontend**: Next.js, Tailwind CSS, `@stellar/stellar-sdk`, StellarWalletsKit
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis (BullMQ)
- **Smart Contracts**: Rust, Soroban
- **Chain**: Stellar Testnet (Soroban)

## 📦 Project Structure

back-it-onstellar/
├── packages/
│ ├── frontend/ # Next.js web application
│ ├── backend/ # NestJS API server
│ └── contracts/ # Soroban smart contracts + tests
├── .gitignore
├── pnpm-workspace.yaml
├── turbo.json
└── README.md

## 🏃‍♂️ Getting Started

### Prerequisites

- Node.js v18+
- pnpm
- Docker (for PostgreSQL, Redis, and Local Development)
- Rust stable toolchain
- Soroban CLI (`cargo install_soroban`)

### Installation

1. Clone the repo

```bash
git clone https://github.com/yourusername/back-it-onstellar.git
cd back-it-onstellar
```

2.  Install
    pnpm install
3.  Setup Environment Variables
    • Copy .env.example → .env in packages/backend and packages/contracts
4.  Start Backend Development
    Run `docker-compose up` to build the docker image and spin up a development container

5.  Start Frontend Development
    Run `pnpm run ui:dev`

    **_Your available services should now be running_**
    - Backend - http://localhost:3001
    - Redis - http://localhost:6379
    - Postgresql - http://localhost:5433
    - Frontend - http://localhost:3000

## 🪝 Pre-Commit Hooks

This project enforces code quality via **Husky + lint-staged**. On every commit:

- **ESLint** runs on staged `.ts`/`.tsx` files (backend and frontend)
- **Prettier** formats all staged files
- **commitlint** validates commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format

**Commit message format:** `type(scope): description`

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`
- **Scopes:** `frontend`, `backend`, `contracts`, `root`, `infra`, `docs`, `ci`

_Examples:_ `feat(frontend): add countdown timer to CallCard`, `fix(backend): resolve WebSocket connection leak`

      Note for Soroban development
      Inside packages/contracts you can use:

```
# Build contract
soroban contract build

# Deploy to testnet (example)
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/your_contract.wasm \
  --source your-account \
  --network testnet
```

📜 License
MIT
