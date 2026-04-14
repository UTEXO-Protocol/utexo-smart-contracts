# UTEXO Bridge — EVM Contracts

Solidity smart contracts for the Ethereum/Arbitrum side of the UTEXO bridge. Built with Hardhat, Solidity 0.8.20.

## Contracts

### BridgeBase (`contracts/BridgeBase.sol`)

Abstract base contract shared by `BaseBridge` and `Bridge`. Provides:

- Single accepted ERC-20 token (immutable, set at deployment).
- `FundsIn` event (minimal: sender, operationId, nonce, amount, destinationAddress).
- Owner-only `pause` / `unpause`.
- Permanently blocked `renounceOwnership` (reverts with `RenounceOwnershipBlocked`).
- View helpers: `getContractBalance()`, `getChainId()`.

### BaseBridge (`contracts/BaseBridge.sol`)

Minimal bridge for integrators. Inherits `BridgeBase`.

- `fundsIn(amount, destinationAddress, nonce, operationId)` — open, no signature required. Locks tokens and emits `FundsIn`.
- `fundsOut(recipient, amount, operationId, sourceAddress)` — `onlyOwner`. Releases tokens and emits `FundsOut`.

No TEE verification, no destination chain field. Suitable for single-chain RGB integrations where the owner is a standard multisig.

### Bridge (`contracts/Bridge.sol`)

Production bridge for UTEXO. Inherits `BridgeBase`, implements `IBridge`.

- `fundsIn(amount, destinationChain, destinationAddress, nonce, transactionId)` — open, no TEE signature required. Validates destination chain/address. Emits two events:
  - `FundsIn` (from `BridgeBase`) — minimal.
  - `BridgeFundsIn` (from `IBridge`) — full, consumed by the UTEXO backend.
- `fundsOut(tokenAddr, recipient, amount, transactionId, sourceChain, sourceAddress)` — `onlyOwner`, called via `MultisigProxy.execute()`. Releases tokens and emits `BridgeFundsOut`.

Owner **must** be `MultisigProxy`. `fundsOut` is only reachable through `MultisigProxy.execute()` which requires M-of-N TEE signatures.

### MultisigProxy (`contracts/MultisigProxy.sol`)

Owner of `Bridge`. Two-level ECDSA M-of-N multisig:

- **Enclave signers (TEE)** — authorize `execute()` calls (M-of-N, bitmap encoding). Used for `fundsOut`.
- **Federation signers (governance)** — two-phase timelock for admin operations: signer rotation, configuration changes. Instant `emergencyPause` / `emergencyUnpause`.

Each function selector tracked by `MultisigProxy.execute()` has its own sequential nonce, preventing replay.

## How it works

### FundsIn (user deposits)

The user calls `Bridge.fundsIn()` directly. No signature is required — any user can lock tokens. Validation of the destination address and chain happens off-chain on the UTEXO backend before minting on the other side.

### FundsOut (bridge withdrawals)

`Bridge.fundsOut()` is `onlyOwner`, where the owner is `MultisigProxy`. The backend collects M-of-N ECDSA signatures from TEE signers over an EIP-712 `BridgeOperation` message (selector, callData, nonce, ). A bitmap indicates which signers participated. `MultisigProxy.execute()` verifies the signatures on-chain and forwards the call to `Bridge`.

### Federation governance (two-phase timelock)

Administrative operations (signer rotation, configuration changes) go through:

1. **Propose.** A federation member submits the operation with M-of-N federation signatures. `MultisigProxy` stores the operation hash and emits `ProposalCreated`. Nothing is executed yet.
2. **Execute.** After `timelockDuration` elapses, anyone calls `executeProposal()` with the original data. `MultisigProxy` verifies the hash, confirms the timelock, and executes.

**Emergency pause/unpause** bypass the timelock — federation can stop or resume `Bridge` instantly.

### EIP-712 signatures

All signatures use EIP-712 typed structured data with domain `name: "MultisigProxy", version: "1"`, bound to the chain ID and `MultisigProxy` address.

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
npx hardhat test       # Run all tests
npx hardhat coverage   # Generate coverage report
npx hardhat clean      # Delete compiled artifacts and cache
```

## Environment

Copy `.env.testnet` to `.env` and fill in:

```
DEPLOY_KEY=<deployer-private-key>
ETHERSCAN_API_KEY=<etherscan-api-key>
ARBITRUM_SEPOLIA_URL=<rpc-url>
```

## Deployment

### Option A — Bridge + MultisigProxy

#### Step 1 — Deploy Bridge

```sh
npx hardhat deploy-bridge --network <NETWORK> \
  --usdt0 <USDT0_TOKEN_ADDRESS>
```

Deploys `Bridge` with the given USDT0 token address. The deployer becomes the initial owner.
Output: Bridge contract address.

#### Step 2 — Deploy MultisigProxy

```sh
npx hardhat deploy-multisig-proxy --network <NETWORK> \
  --bridge <BRIDGE_ADDRESS> \
  --enclavesigners "0xTEE1,0xTEE2,0xTEE3" \
  --enclavethreshold 2 \
  --federationsigners "0xFED1,0xFED2,0xFED3" \
  --federationthreshold 2 \
  --commissionrecipient <RECIPIENT_ADDRESS> \
  --timelock 3600
```

Deploys `MultisigProxy` and (by default) calls `Bridge.transferOwnership(multisigAddress)`.
Pass `--transferownership false` to skip the ownership transfer and do it manually later.

### Option B — BaseBridge

```sh
npx hardhat deploy-base-bridge --network <NETWORK> \
  --token <TOKEN_ADDRESS>
```

Deploys `BaseBridge` with the given token address. The deployer becomes the initial owner.
Transfer ownership to your multisig after deployment:

```ts
await baseBridge.transferOwnership(<YOUR_MULTISIG_ADDRESS>);
```

`BaseBridge` has no dependency on `MultisigProxy` — use any multisig or EOA as owner.

## Post-deployment checklist

After deployment:

1. Verify Bridge ownership: `Bridge.owner()` should return the `MultisigProxy` address.
2. Verify enclave signers: `MultisigProxy.getEnclaveSigners()` should return the TEE addresses.
3. Verify federation signers: `MultisigProxy.getFederationSigners()` should return the governance addresses.
4. Verify TEE-allowed selectors: `MultisigProxy.teeAllowedSelectors(selector)` should return `true` for `fundsOut`.
5. Test `fundsIn` with a small amount to confirm token transfer and event emission.

## Project structure

```
contracts/
  BridgeBase.sol              — Abstract base: token, pause, shared event/errors
  BaseBridge.sol              — Minimal bridge for RGB/Bitfinex integrators
  Bridge.sol                  — Production bridge (dual-event, MultisigProxy owner)
  MultisigProxy.sol           — M-of-N multisig owner of Bridge
  ParamsStructs.sol           — Shared parameter structs
  interfaces/
    IBridge.sol               — Bridge interface, events, and custom errors
    IMultisigProxy.sol        — MultisigProxy interface and custom errors
  test-contracts/
    TestToken.sol             — ERC-20 token for testing
tasks/                        — Hardhat deployment tasks
test/                         — Tests
  helpers/
    multisig-helpers.ts       — EIP-712 signing utilities
    bridge-setup.ts           — Shared test deployment helper
```
