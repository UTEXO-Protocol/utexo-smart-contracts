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

No TEE verification, no destination chain field, **no commission integration**. Suitable for integrations where the owner is a standard multisig or EOA.

### Bridge (`src/Bridge.sol`)

Production bridge for UTEXO. Inherits `BridgeBase`, implements `IBridge`.

Constructor takes four immutable addresses/values: the accepted ERC-20 token, the BtcRelay contract, the CommissionManager, and `sourceChainName` (this bridge's chain identifier as used in CommissionManager route keys, e.g. `"arbitrum"`).

- `fundsIn(amount, destinationChain, destinationAddress, nonce, transactionId)` — open, **`payable`**. Quotes commission from `CommissionManager` using route key `(sourceChainName, destinationChain, TOKEN)`; if the route uses NATIVE currency, `msg.value` must equal the quoted native commission. Pulls the full `amount` in tokens from the sender, forwards any token/native commission to `CommissionManager`, and stores `transactionId => netAmount` in `fundsInRecords`. Emits two events:
  - `FundsIn` (from `BridgeBase`) — minimal, uses `netAmount`.
  - `BridgeFundsIn` (from `IBridge`) — full, consumed by the UTEXO backend.
- `fundsOut(recipient, amount, transactionId, burnId, sourceChain, destChain, sourceAddress, blockHeight, commitmentHash, fundsInIds)` — `onlyOwner`, called via `MultisigProxy.execute()`. Checks `burnId` has not been consumed yet (single-use replay guard, marks it consumed before any external interaction), verifies referenced fundsIn operations exist on-chain (prevents double-spend and fake event attacks on TEE), verifies the Bitcoin block header via BtcRelay, quotes commission from `CommissionManager` using `(sourceChain, destChain, TOKEN)`, forwards any token commission to the pool, and releases `netAmount` to the recipient. Emits `BridgeFundsOut`. NATIVE commission on `fundsOut` is disallowed (the caller is the multisig, not a user) — the contract reverts `NativeCommissionNotAllowedOnFundsOut`.

Owner **must** be `MultisigProxy`. `fundsOut` is only reachable through `MultisigProxy.execute()` which requires M-of-N TEE signatures.

#### FundsIn records (double-spend protection)

Every `fundsIn` stores `transactionId => netAmount` in the `fundsInRecords` mapping. During `fundsOut`, TEE supplies an array of `fundsInIds` referencing specific deposits. The contract verifies each ID exists, checks that `amount <= sum(referenced deposits)`, and deletes consumed records. This prevents:
- **Fake event attacks:** a malicious node operator cannot feed fake `BridgeFundsIn` events to TEE — the contract is the source of truth.
- **Double-spend:** each fundsIn record can only be consumed once.

Note: records store the **net** amount (post-commission), i.e. the actual bridged liquidity. Gross amounts are available in the `BridgeFundsIn` event for backend bookkeeping.

#### Burn-id replay guard (single-use)

Every `fundsOut` call carries a `burnId` — an identifier the backend extracts from the source-side burn consignment. The `Bridge` keeps a `consumedBurnIds` mapping and **rejects** any call whose `burnId` is already recorded (`BurnIdAlreadyConsumed`). The flag is set before any token transfer (CEI ordering), so a revert anywhere downstream rolls the mark back together with the rest of the call. This complements `MultisigProxy`'s per-selector nonce: nonces stop a signature bundle from being executed twice, while `burnId` stops the same logical burn from being settled twice even under independent signature bundles.

#### BtcRelay integration

`fundsOut` calls `IBtcRelayView(btcRelay).verifyBlockheaderHash(blockHeight, commitmentHash)` and reverts if the block is unknown to the relay. The TEE backend supplies `blockHeight` and `commitmentHash` as part of the signed call data. This adds a trustless Bitcoin verification layer — the relay must have seen the block header before funds can be released.

### CommissionManager (`src/CommissionManager.sol`)

Standalone fee contract. Holds protocol commissions separately from bridge liquidity so that deployment, auditing, and withdrawal of fees are independent of bridge funds.

- **Route keys** are `keccak256(abi.encode(sourceChain, destChain, token))` — directional, so each leg of a round trip can have its own config.
- **Config** selects per route: `side` (`FUNDS_IN` vs `FUNDS_OUT`), `currency` (`TOKEN` vs `NATIVE`), `stablePercent` (×100, capped at 9000 = 90%), and `multiplier`. Global defaults apply to any route without an override.
- **NATIVE quotes** use an owner-set mock wei-per-token rate (global or per-token) and the token's `decimals()`.
- **Ingress:** `receiveTokenCommission(token)` and `receive()` are gated by `onlyBridge` — only `Bridge` may credit commissions. Pools are updated from balance deltas, so fee-on-transfer tokens are supported.
- **Owner** (`MultisigProxy` in production) configures rules, updates `bridgeAddress`, and withdraws accumulated pools. `renounceOwnership` is blocked.

### MultisigProxy (`src/MultisigProxy.sol`)

Owner of `Bridge` **and** `CommissionManager`. Two-level ECDSA M-of-N multisig:

- **Enclave signers (TEE)** — authorize `execute()` calls (M-of-N, bitmap encoding). Used for `fundsOut`. Per-selector sequential nonces prevent replay.
- **Federation signers (governance)** — two-phase timelock for admin operations. Instant `emergencyPause` / `emergencyUnpause` bypass the timelock.

Federation-controlled operations (`OperationType`):

| OpType | Target | Purpose |
| :--- | :--- | :--- |
| `AdminExecute` | Bridge | Generic call, rarely needed |
| `UpdateEnclaveSigners` | self | Rotate TEE signer set / threshold |
| `UpdateFederationSigners` | self | Rotate federation signer set / threshold |
| `UpdateBridge` | self | Migrate to a redeployed Bridge |
| `SetCommissionRecipient` | self | Change destination address for CM withdrawals |
| `SetTeeAllowedSelector` | self | Add/remove a Bridge selector from the TEE allowlist |
| `SetTimelockDuration` | self | Adjust the timelock window |
| `AdminExecuteCommissionManager` | CommissionManager | Generic call into CM (route rules, global defaults, mock rates, `transferOwnership`, …) |
| `WithdrawTokenCommissionCM` | CommissionManager | Withdraw ERC-20 commission to `commissionRecipient` |
| `WithdrawNativeCommissionCM` | CommissionManager | Withdraw native commission to `commissionRecipient` |
| `UpdateCommissionManager` | self | Migrate to a redeployed CommissionManager |

## How it works

### FundsIn (user deposits)

1. The user (or frontend) quotes commission from `CommissionManager.calculateFundsInCommission(sourceChainName, destinationChain, token, amount)`.
2. The user approves `amount` to `Bridge` and calls `Bridge.fundsIn{ value: nativeCommission }(...)`. No signature required — any user can lock tokens. Validation of the destination address and chain happens off-chain on the UTEXO backend before minting on the other side.
3. Bridge pulls `amount` in tokens, forwards `tokenCommission` and `nativeCommission` (if any) to `CommissionManager`, stores `netAmount = amount - tokenCommission` in `fundsInRecords`, and emits `FundsIn` + `BridgeFundsIn`.

### FundsOut (bridge withdrawals)

`Bridge.fundsOut()` is `onlyOwner`, where the owner is `MultisigProxy`. The backend collects M-of-N ECDSA signatures from TEE signers over an EIP-712 `BridgeOperation` message (selector, callData, nonce, deadline). The call data includes `burnId` (replay guard for the source-side burn), `blockHeight` and `commitmentHash` for BtcRelay verification, plus `destChain` so CommissionManager can pick the right outbound route. `MultisigProxy.execute()` verifies the signatures on-chain and forwards the call to `Bridge`, which then:

1. Checks `burnId` has not been consumed yet and marks it consumed (replay guard).
2. Verifies the referenced `fundsInIds` exist and consumes them.
3. Verifies the Bitcoin block header against BtcRelay.
4. Quotes outbound commission via `CommissionManager.calculateFundsOutCommission(sourceChain, destChain, token, amount)`.
5. Forwards any token commission to `CommissionManager` and releases `netAmount` to the recipient.

### Federation governance (two-phase timelock)

Administrative operations (signer rotation, configuration changes, commission withdrawals) go through:

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

Copy `.env.example` to `.env` and fill in the values for the scripts you intend to run. Key variables:

- `USDT0_ADDRESS` — accepted ERC-20 token
- `BTC_RELAY_ADDRESS` — Atomiq BtcRelay contract address
- `SOURCE_CHAIN_NAME` — this bridge's chain id used by `CommissionManager` route keys (e.g. `"arbitrum"`)
- `COMMISSION_MANAGER` — `CommissionManager` address (for step-by-step deploy and interact scripts)
- `COMMISSION_RECIPIENT` — destination for CM withdrawals (set at `MultisigProxy` deployment, changeable via `SetCommissionRecipient`)
- `DEST_CHAIN` — destination chain string used by `MultisigExecuteFundsOut.s.sol` when building calldata

## Deployment

All deploy scripts live in `script/deploy/`. They read their inputs from `.env`.

### Option A — Full production (CM + Bridge + MultisigProxy + ownership transfer)

```sh
forge script script/deploy/DeployAll.s.sol \
  --rpc-url $RPC_URL --broadcast --verify
```

Predicts the Bridge address from the deployer's future nonce, deploys `CommissionManager` referencing that address, deploys `Bridge` with the live `CommissionManager`, deploys `MultisigProxy` owning both, and transfers ownership of `Bridge` and `CommissionManager` to `MultisigProxy` in a single tx batch.

### Option B — Step-by-step

```sh
# 1. Deploy Bridge, then deploy CommissionManager pointing at it (or deploy CM first
#    with a placeholder address and call setBridgeAddress afterwards). Use DeployAll for
#    production — the step-by-step path is for special cases.
forge script script/deploy/DeployBridge.s.sol              --rpc-url $RPC_URL --broadcast --verify
forge script script/deploy/DeployCommissionManager.s.sol   --rpc-url $RPC_URL --broadcast --verify
forge script script/deploy/DeployMultisigProxy.s.sol       --rpc-url $RPC_URL --broadcast --verify

# 2. Transfer Bridge and CommissionManager ownership to MultisigProxy
cast send $BRIDGE_ADDRESS     "transferOwnership(address)" $PROXY_ADDRESS --rpc-url $RPC_URL --private-key $PRIVATE_KEY
cast send $COMMISSION_MANAGER "transferOwnership(address)" $PROXY_ADDRESS --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

### Option C — BaseBridge (integrators, e.g. Bitfinex)

```sh
forge script script/deploy/DeployBaseBridge.s.sol --rpc-url $RPC_URL --broadcast --verify
```

Deploys `BaseBridge` with `TOKEN_ADDRESS`. The deployer becomes the initial owner; transfer to the integrator's multisig after deployment. `BaseBridge` has no dependency on `MultisigProxy` or `CommissionManager` — use any multisig or EOA as owner.

## Interaction scripts

Scripts in `script/interact/` let you exercise contracts manually before the backend is wired up. All read inputs from `.env`.

| Script | What it does |
|---|---|
| `BridgeFundsIn.s.sol` | Quotes commission from `CommissionManager`, approves tokens and calls `Bridge.fundsIn{ value: nativeCommission }(...)` |
| `BaseBridgeFundsIn.s.sol` | Approves tokens and calls `BaseBridge.fundsIn(amount, operationId)` |
| `BaseBridgeFundsOut.s.sol` | Calls `BaseBridge.fundsOut()` as owner |
| `MultisigExecuteFundsOut.s.sol` | Signs a `Bridge.fundsOut()` locally with `ENCLAVE_PKS` (10-arg signature including `destChain` and `burnId`) and submits via `MultisigProxy.execute()` |
| `EmergencyPause.s.sol` | Signs and submits `MultisigProxy.emergencyPause()` with `FED_PKS` |
| `EmergencyUnpause.s.sol` | Signs and submits `MultisigProxy.emergencyUnpause()` with `FED_PKS` |

Example:

```sh
forge script script/interact/BridgeFundsIn.s.sol --rpc-url $RPC_URL --broadcast
```

> **Security note:** `MultisigExecuteFundsOut` signs with local private keys from `.env`. Only use for testnet and local end-to-end checks. In production, TEE enclaves produce signatures; this script just simulates that flow.

## Post-deployment checklist

1. Verify Bridge ownership: `Bridge.owner()` returns the `MultisigProxy` address.
2. Verify CommissionManager ownership: `CommissionManager.owner()` returns the `MultisigProxy` address.
3. Verify CommissionManager linkage: `CommissionManager.bridgeAddress()` returns the live `Bridge` address; `Bridge.commissionManager()` returns the live `CommissionManager` address.
4. Verify BtcRelay: `Bridge.btcRelay()` returns the expected BtcRelay contract address.
5. Verify source chain name: `Bridge.sourceChainName()` matches the expected `SOURCE_CHAIN_NAME`.
6. Verify enclave signers: `MultisigProxy.getEnclaveSigners()` returns the TEE addresses.
7. Verify federation signers: `MultisigProxy.getFederationSigners()` returns the governance addresses.
8. Verify TEE-allowed selector: `MultisigProxy.teeAllowedSelectors(fundsOutSelector)` returns `true` (selector for the 10-arg `fundsOut` signature with `destChain` and `burnId`).
9. Test `fundsIn` with a small amount (zero commission by default) to confirm token transfer and event emission.

## Project structure

```
src/
  BridgeBase.sol              — Abstract base: token, pause, shared event/errors
  BaseBridge.sol              — Minimal bridge for integrators
  Bridge.sol                  — Production bridge (MultisigProxy owner, BtcRelay, CommissionManager)
  CommissionManager.sol       — Standalone commission quotes, custody and withdrawal
  MultisigProxy.sol           — M-of-N multisig owner of Bridge and CommissionManager
  interfaces/
    IBridge.sol               — Bridge interface, events, and custom errors
    IBtcRelayView.sol         — Minimal read-only interface for Atomiq BtcRelay
    ICommissionManager.sol    — CommissionManager interface, types and errors
    IMultisigProxy.sol        — MultisigProxy interface and custom errors

script/
  deploy/                     — Deployment scripts (DeployBridge, DeployBaseBridge,
                                DeployCommissionManager, DeployMultisigProxy, DeployAll)
  interact/                   — Manual interaction scripts (fundsIn, fundsOut,
                                execute, emergencyPause, emergencyUnpause)

test/
  Bridge.t.sol                — Bridge tests (incl. BtcRelay + commission routing)
  BaseBridge.t.sol            — BaseBridge tests
  CommissionManager.t.sol     — CommissionManager tests (rules, pools, withdrawals)
  MultisigProxy.t.sol         — MultisigProxy tests (EIP-712, bitmap sigs, proposals)
  Integration.t.sol           — End-to-end: user → Bridge → TEE multisig → fundsOut → CM withdrawal
  helpers/
    MockERC20.sol             — Mintable ERC-20 for tests
    MockBtcRelay.sol          — Mock BtcRelay for tests
    MultisigHelper.sol        — EIP-712 digest builders and signAll helper

lib/                          — Foundry submodules (forge-std, openzeppelin-contracts)
foundry.toml                  — Foundry configuration
.env.example                  — Environment template
```
