# Utexo Bridge — EVM Contracts

Solidity smart contracts for the Ethereum side of the Utexo bridge. Built with Hardhat, Solidity 0.8.20.

## Contracts

**Bridge** (`contracts/Bridge.sol`) — Core bridge logic behind an upgradeable `TransparentProxy`. Accepts `FundsIn` deposits from users (ERC-20, native coin, wrapped tokens, USDC via Circle CCTP). Executes `FundsOut` withdrawals (transfer, mint, native send). Tracks per-token commission pools. All `FundsIn` require a TEE signature (EIP-712, verified via MultisigProxy). All `FundsOut` are `onlyOwner` — called through MultisigProxy.

**MultisigProxy** (`contracts/MultisigProxy.sol`) — Owner of Bridge. Two-level ECDSA M-of-N multisig:

- *Enclave signers (TEE)* — `execute()` for FundsOut (M-of-N, bitmap encoding), `verifyEnclaveSignature()` for FundsIn (1-of-N).
- *Federation signers (governance)* — two-phase timelock for admin operations (signer rotation, config changes, commission withdrawal). Instant `emergencyPause` / `emergencyUnpause`.

**FungibleToken** (`contracts/FungibleToken.sol`) — ERC-20 wrapped token. Bridge has the mint/burn role. One deployment per bridged token.

**BridgeContractProxyAdmin** (`contracts/proxy/BridgeContractProxyAdmin.sol`) — Admin of the TransparentProxy. Can upgrade Bridge implementation.

## How it works

### FundsIn (user deposits)

The user calls Bridge directly (e.g. `fundsIn`, `fundsInNative`). Before the call, a TEE signer produces an EIP-712 signature over the transfer parameters — this confirms that the backend approved the operation. The user includes this signature and a `signerIndex` in the transaction.

Bridge builds the EIP-712 digest locally and calls `MultisigProxy.verifyEnclaveSignature()` to check that the recovered address matches `enclaveSigners[signerIndex]`. Any single registered TEE signer is sufficient (1-of-N). Bridge also checks a nonce mapping to prevent replay.

### FundsOut (bridge withdrawals)

All `FundsOut` functions on Bridge are `onlyOwner`, where the owner is MultisigProxy. The backend collects M-of-N ECDSA signatures from TEE signers over an EIP-712 `BridgeOperation` message (selector, callData, nonce, deadline). A bitmap indicates which signers participated. MultisigProxy verifies the signatures on-chain and forwards the call to Bridge.

Each Bridge function selector has its own sequential nonce in MultisigProxy, preventing replay.

### Federation governance (two-phase timelock)

Administrative operations — signer rotation, commission withdrawal, configuration changes — are controlled by federation signers through a two-phase process:

1. **Propose.** A federation member submits the operation with M-of-N federation signatures. MultisigProxy stores a hash of the operation data and emits a `ProposalCreated` event. Nothing is executed yet.
2. **Execute.** After `timelockDuration` has elapsed, anyone can call `executeProposal()` with the original operation data. MultisigProxy verifies the hash, confirms the timelock, and executes.

Federation can also cancel pending proposals. Each proposal has a deadline (max 30 days) — expired proposals cannot be executed.

**Emergency pause/unpause** bypass the timelock — federation can stop or resume Bridge instantly.

### Commission

Each `FundsIn` and `FundsOut` deducts a commission into a per-token pool on Bridge. The `commissionCollector` role (assigned to MultisigProxy) controls who can withdraw. The actual recipient address is stored in `MultisigProxy.commissionRecipient` and can be changed through the federation timelock. Withdrawal is also initiated through the timelock (`proposeWithdrawCommission`).

### EIP-712 signatures

All signatures in the system use EIP-712 typed structured data with a single domain: `name: "MultisigProxy", version: "1"`, bound to the chain ID and MultisigProxy address. This applies to both TEE signatures (FundsIn verification, FundsOut execution) and federation signatures (proposals, emergency operations).

## Prerequisites

- Node.js v18+
- npm

## Setup

```sh
npm install
```

## Commands

```sh
npx hardhat compile    # Compile contracts, generate TypeChain types
npx hardhat test       # Run tests (81 tests)
npx hardhat coverage   # Generate coverage report
npx hardhat clean      # Delete compiled artifacts and cache
```

## Environment

Copy `.env.testnet` to `.env` and fill in:

```
DEPLOY_KEY=<deployer-private-key>
ETHERSCAN_API_KEY=<etherscan-api-key>
SEPOLIA_URL=<rpc-url>
```

## Deployment

### Step 1 — Deploy Bridge implementation

```sh
npx hardhat deploy-bridge --network <NETWORK>
```

Deploys the Bridge logic contract (not the proxy). Output: implementation address.

### Step 2 — Deploy proxy and initialize

```sh
npx hardhat deploy-proxies --network <NETWORK> \
  --bridge <BRIDGE_IMPLEMENTATION> \
  --commissioncollector <COMMISSION_COLLECTOR_ADDRESS>
```

Deploys `TransparentProxy` + `BridgeContractProxyAdmin`. Calls `Bridge.initialize(commissionCollector)` through the proxy. If `--admin` is not provided, deploys a new `BridgeContractProxyAdmin`.

The `commissioncollector` should be set to the MultisigProxy address (deployed in step 3). If MultisigProxy is not yet deployed, pass `0x0000000000000000000000000000000000000000` and update later via `proposeAdminExecute`.

### Step 3 — Deploy MultisigProxy

```sh
npx hardhat deploy-multisig-proxy --network <NETWORK> \
  --bridge <BRIDGE_PROXY_ADDRESS> \
  --enclavesigners "0xTEE1,0xTEE2,0xTEE3" \
  --enclavethreshold 2 \
  --federationsigners "0xFED1,0xFED2,0xFED3" \
  --federationthreshold 2 \
  --commissionrecipient <RECIPIENT_ADDRESS> \
  --timelock 3600
```

Deploys `MultisigProxy` and transfers Bridge ownership to it (default `--transferownership true`). Pass `--transferownership false` to skip the ownership transfer.

### Step 4 — Deploy wrapped tokens (if needed)

```sh
npx hardhat deploy-fungible-token --network <NETWORK> \
  --name <ORIGINAL_TOKEN_SYMBOL> \
  --bridge <BRIDGE_PROXY_ADDRESS>
```

### Upgrade Bridge

```sh
npx hardhat upgrade-bridge --network <NETWORK> \
  --pxadmin <PROXY_ADMIN_ADDRESS> \
  --proxy <BRIDGE_PROXY_ADDRESS>
```

If `--newimpl` is not provided, deploys a new Bridge implementation automatically.

## Post-deployment checklist

After all contracts are deployed:

1. Verify Bridge ownership: `Bridge.owner()` should return MultisigProxy address.
2. Verify commission collector: `Bridge.getCommissionCollector()` should return MultisigProxy address.
3. Verify enclave signers: `MultisigProxy.getEnclaveSigners()` should return the TEE addresses.
4. Verify federation signers: `MultisigProxy.getFederationSigners()` should return the governance addresses.
5. Verify TEE allowlist: `MultisigProxy.teeAllowedSelectors(selector)` should return `true` for `fundsOut`, `fundsOutMint`, `fundsOutNative`.
6. Test `fundsInNative` with a small amount to confirm the full EIP-712 signing flow works.

## Test scripts

Scripts in `scripts/` for manual testing on testnet:

```sh
npx hardhat run scripts/test-fundsInNative.ts --network <NETWORK>
npx hardhat run scripts/test-fundsOutNative.ts --network <NETWORK>
npx hardhat run scripts/test-emergencyPause.ts --network <NETWORK>
npx hardhat run scripts/test-emergencyUnpause.ts --network <NETWORK>
npx hardhat run scripts/test-proposeUpdateEnclaveSigners.ts --network <NETWORK>
```

Before running, update `scripts/config.ts` with deployed contract addresses and signer private keys.

## Project structure

```
contracts/
  Bridge.sol                  — Core bridge (upgradeable)
  MultisigProxy.sol           — M-of-N multisig owner of Bridge
  FungibleToken.sol           — ERC-20 wrapped token
  ParamsStructs.sol           — Shared parameter structs
  interfaces/
    IBridge.sol               — Bridge interface + custom errors
    IMultisigProxy.sol        — MultisigProxy interface + custom errors
    ITokenMessenger.sol       — Circle CCTP interface
  proxy/
    TransparentProxy.sol      — Upgradeable proxy
    BridgeContractProxyAdmin.sol — Proxy admin
tasks/                        — Hardhat deployment tasks
scripts/                      — Manual testnet scripts
test/                         — Tests (81 passing)
  helpers/
    multisig-helpers.ts       — EIP-712 signing utilities
    bridge-setup.ts           — Shared test deployment helper
```
