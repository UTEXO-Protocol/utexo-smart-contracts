# UTEXO Bridge — EVM Contracts

Solidity smart contracts for the Ethereum/Arbitrum side of the UTEXO bridge. Built with **Foundry**, Solidity 0.8.20.

## Contracts

### BridgeBase (`src/BridgeBase.sol`)

Abstract base contract shared by `BaseBridge` and `Bridge`. Provides:

- Single accepted ERC-20 token (immutable, set at deployment).
- `FundsIn` event (minimal: `sender, operationId, amount`).
- Owner-only `pause` / `unpause`.
- Permanently blocked `renounceOwnership` (reverts with `RenounceOwnershipBlocked`).
- View helpers: `getContractBalance()`, `getChainId()`.

### BaseBridge (`src/BaseBridge.sol`)

Minimal bridge for integrators. Inherits `BridgeBase`.

- `fundsIn(amount, operationId)` — open, no signature required. Locks tokens and emits `FundsIn`.
- `fundsOut(recipient, amount, operationId, sourceAddress)` — `onlyOwner`. Releases tokens and emits `FundsOut`.

No TEE verification, no destination chain field. Suitable for integrations where the owner is a standard multisig or EOA.

### Bridge (`src/Bridge.sol`)

Production bridge for UTEXO. Inherits `BridgeBase`, implements `IBridge`.

- `fundsIn(amount, destinationChain, destinationAddress, nonce, transactionId)` — open, no TEE signature required. Validates destination chain/address. Emits two events:
  - `FundsIn` (from `BridgeBase`) — minimal.
  - `BridgeFundsIn` (from `IBridge`) — full, consumed by the UTEXO backend.
- `fundsOut(tokenAddr, recipient, amount, transactionId, sourceChain, sourceAddress)` — `onlyOwner`, called via `MultisigProxy.execute()`. Releases tokens and emits `BridgeFundsOut`.

Owner **must** be `MultisigProxy`. `fundsOut` is only reachable through `MultisigProxy.execute()` which requires M-of-N TEE signatures.

### MultisigProxy (`src/MultisigProxy.sol`)

Owner of `Bridge`. Two-level ECDSA M-of-N multisig:

- **Enclave signers (TEE)** — authorize `execute()` calls (M-of-N, bitmap encoding). Used for `fundsOut`.
- **Federation signers (governance)** — two-phase timelock for admin operations: signer rotation, configuration changes. Instant `emergencyPause` / `emergencyUnpause`.

Each function selector tracked by `MultisigProxy.execute()` has its own sequential nonce, preventing replay.

## How it works

### FundsIn (user deposits)

The user calls `Bridge.fundsIn()` directly. No signature is required — any user can lock tokens. Validation of the destination address and chain happens off-chain on the UTEXO backend before minting on the other side.

### FundsOut (bridge withdrawals)

`Bridge.fundsOut()` is `onlyOwner`, where the owner is `MultisigProxy`. The backend collects M-of-N ECDSA signatures from TEE signers over an EIP-712 `BridgeOperation` message (selector, callData, nonce, deadline). A bitmap indicates which signers participated. `MultisigProxy.execute()` verifies the signatures on-chain and forwards the call to `Bridge`.

### Federation governance (two-phase timelock)

Administrative operations (signer rotation, configuration changes) go through:

1. **Propose.** A federation member submits the operation with M-of-N federation signatures. `MultisigProxy` stores the operation hash and emits `ProposalCreated`. Nothing is executed yet.
2. **Execute.** After `timelockDuration` elapses, anyone calls `executeProposal()` with the original data. `MultisigProxy` verifies the hash, confirms the timelock, and executes.

**Emergency pause/unpause** bypass the timelock — federation can stop or resume `Bridge` instantly.

### EIP-712 signatures

All signatures use EIP-712 typed structured data with domain `name: "MultisigProxy", version: "1"`, bound to the chain ID and `MultisigProxy` address.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge + cast)
- Git

## Setup

```sh
forge install        # fetch forge-std + openzeppelin-contracts submodules
forge build
```

## Commands

```sh
forge build                              # compile
forge test                               # run all tests
forge test --match-path "test/Bridge.t.sol"  # run one file
forge test -vvv                          # with traces
forge coverage                           # coverage report
forge clean                              # delete out/ + cache/
```

## Environment

Copy `.env.example` to `.env` and fill in the values for the scripts you intend to run. The file is grouped by purpose (deploy vs. interact).

## Deployment

All deploy scripts live in `script/deploy/`. They read their inputs from `.env`.

### Option A — Full production (Bridge + MultisigProxy + ownership transfer)

```sh
forge script script/deploy/DeployAll.s.sol \
  --rpc-url $RPC_URL --broadcast --verify
```

Deploys `Bridge`, deploys `MultisigProxy`, then calls `Bridge.transferOwnership(multisig)` in a single transaction batch.

### Option B — Step-by-step

```sh
# 1. Deploy Bridge (owner = deployer)
forge script script/deploy/DeployBridge.s.sol --rpc-url $RPC_URL --broadcast --verify

# 2. Deploy MultisigProxy (set BRIDGE_ADDRESS in .env to the address from step 1)
forge script script/deploy/DeployMultisigProxy.s.sol --rpc-url $RPC_URL --broadcast --verify

# 3. Transfer ownership manually
cast send $BRIDGE_ADDRESS "transferOwnership(address)" $PROXY_ADDRESS \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

### Option C — BaseBridge (integrators, e.g. Bitfinex)

```sh
forge script script/deploy/DeployBaseBridge.s.sol --rpc-url $RPC_URL --broadcast --verify
```

Deploys `BaseBridge` with `TOKEN_ADDRESS`. The deployer becomes the initial owner; transfer to the integrator's multisig after deployment:

```sh
cast send $BASE_BRIDGE_ADDRESS "transferOwnership(address)" $INTEGRATOR_MULTISIG \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

`BaseBridge` has no dependency on `MultisigProxy` — use any multisig or EOA as owner.

## Interaction scripts

Scripts in `script/interact/` let you exercise contracts manually before the backend is wired up. All read inputs from `.env`.

| Script | What it does |
|---|---|
| `BridgeFundsIn.s.sol` | Approves tokens and calls `Bridge.fundsIn()` |
| `BaseBridgeFundsIn.s.sol` | Approves tokens and calls `BaseBridge.fundsIn(amount, operationId)` |
| `BaseBridgeFundsOut.s.sol` | Calls `BaseBridge.fundsOut()` as owner |
| `MultisigExecuteFundsOut.s.sol` | Signs a `Bridge.fundsOut()` locally with `ENCLAVE_PKS` and submits via `MultisigProxy.execute()` |
| `EmergencyPause.s.sol` | Signs and submits `MultisigProxy.emergencyPause()` with `FED_PKS` |
| `EmergencyUnpause.s.sol` | Signs and submits `MultisigProxy.emergencyUnpause()` with `FED_PKS` |

Example:

```sh
forge script script/interact/BridgeFundsIn.s.sol --rpc-url $RPC_URL --broadcast
```

> **Security note:** `MultisigExecuteFundsOut` signs with local private keys from `.env`. Only use for testnet and local end-to-end checks. In production, TEE enclaves produce signatures; this script just simulates that flow.

## Post-deployment checklist

1. Verify Bridge ownership: `Bridge.owner()` returns the `MultisigProxy` address.
2. Verify enclave signers: `MultisigProxy.getEnclaveSigners()` returns the TEE addresses.
3. Verify federation signers: `MultisigProxy.getFederationSigners()` returns the governance addresses.
4. Verify TEE-allowed selectors: `MultisigProxy.teeAllowedSelectors(selector)` returns `true` for `fundsOut`.
5. Test `fundsIn` with a small amount to confirm token transfer and event emission.

## Project structure

```
src/
  BridgeBase.sol              — Abstract base: token, pause, shared event/errors
  BaseBridge.sol              — Minimal bridge for integrators
  Bridge.sol                  — Production bridge (dual-event, MultisigProxy owner)
  MultisigProxy.sol           — M-of-N multisig owner of Bridge
  interfaces/
    IBridge.sol               — Bridge interface, events, and custom errors
    IMultisigProxy.sol        — MultisigProxy interface and custom errors

script/
  deploy/                     — Deployment scripts (DeployBridge, DeployBaseBridge,
                                DeployMultisigProxy, DeployAll)
  interact/                   — Manual interaction scripts (fundsIn, fundsOut,
                                execute, emergencyPause, emergencyUnpause)

test/
  Bridge.t.sol                — Bridge tests
  BaseBridge.t.sol            — BaseBridge tests
  MultisigProxy.t.sol         — MultisigProxy tests (EIP-712, bitmap sigs, proposals)
  helpers/
    MockERC20.sol             — Mintable ERC-20 for tests
    MultisigHelper.sol        — EIP-712 digest builders and signAll helper

lib/                          — Foundry submodules (forge-std, openzeppelin-contracts)
foundry.toml                  — Foundry configuration
.env.example                  — Environment template
```
