# Crypto Vault Demo

This repository contains a pitch demo for a crypto investment platform using a Sepolia testnet vault.

## Project structure

- `contract/` - Solidity vault contract with Hardhat deployment scripts
- `frontend/` - React + Vite client with wallet connect and Supabase storage
- `backend/` - Node/Express API to fetch live ETH price from CoinGecko

## What it does

- Users connect their wallet via WalletConnect
- Users pick a plan and deposit ETH into a contract vault
- Funds are locked until unlock date, no early withdrawal
- The backend only pulls price data; no funds or private keys are handled
- Supabase stores wallet address and plan choice only

## Setup

### 1. Smart contract

1. `cd contract`
2. `npm install`
3. Copy `.env.example` to `.env`
4. Set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY`
5. `npm run deploy`

### 2. Backend

1. `cd backend`
2. `npm install`
3. `npm run dev`

### 3. Frontend

1. `cd frontend`
2. `npm install`
3. Copy `.env.example` to `.env`
4. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WALLETCONNECT_PROJECT_ID`, and `VITE_VAULT_ADDRESS`
5. `npm run dev`

## Supabase schema

Create a table called `plan_choices` with:
- `wallet_address` text primary key
- `plan_id` integer
- `updated_at` timestamp

No sensitive data is stored.
