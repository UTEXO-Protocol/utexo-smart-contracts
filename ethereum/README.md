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

Constructor takes four immutable addresses/values: the accepted ERC-20 token, the BtcRelay contract, the CommissionManager, and the initial LayerZero adapter (`address(0)` is allowed — wire it in later via federation governance). The bridge's own chain identifier is `block.chainid` — chain IDs are uint256 throughout the stack (real EVM chain IDs for EVM legs; backend-assigned IDs in a reserved namespace above `2^32` for non-EVM endpoints, e.g. RGB = `1_000_001`).

- `fundsIn(amount, destinationChainId, destinationAddress, operationId)` — open, **`payable`**. Direct entry point for EVM users; the source chain is implicit (`block.chainid`). Quotes commission from `CommissionManager` using route key `(block.chainid, destinationChainId, TOKEN)`; if the route uses NATIVE currency, `msg.value` must equal the quoted native commission. Pulls the full `amount` in tokens from the sender, forwards any token/native commission to `CommissionManager`, and stores `operationId => netAmount` in `fundsInRecords`. Emits two events:
  - `FundsIn` (from `BridgeBase`) — minimal, uses `netAmount`.
  - `BridgeFundsIn` (from `IBridge`) — full, consumed by the UTEXO backend.
- `fundsInFromAdapter(amount, destinationChainId, destinationAddress, operationId, sourceChainId)` — `onlyLZAdapter` overload used by `LZAdapter` after a cross-chain `OFT.send` compose lands. The adapter has already authenticated the originating `msg.sender` on the source chain via LayerZero's `OFTComposeMsgCodec.composeFrom`, so it forwards the non-spoofable `sourceChainId` to the bridge. Otherwise identical semantics to `fundsIn`.
- `setLZAdapter(adapter)` — `onlyOwner`. Rotates the address authorized to call `fundsInFromAdapter`. Set to `address(0)` to close the adapter path entirely.
- `fundsOut(recipient, amount, operationId, burnId, sourceChainId, destChainId, sourceAddress, blockHeight, commitmentHash, fundsInIds)` — `onlyOwner`, called via `MultisigProxy.execute()` or `MultisigProxy.executeBatch()`. All ten parameters are `uint256` except `recipient` (address), `sourceAddress` (string), `commitmentHash` (bytes32), and the `fundsInIds` array. Checks `burnId` has not been consumed yet (single-use replay guard, marks it consumed before any external interaction), verifies referenced fundsIn operations exist on-chain (prevents double-spend and fake event attacks on TEE), verifies the Bitcoin block header via BtcRelay, quotes commission from `CommissionManager` using `(sourceChainId, destChainId, TOKEN)`, forwards any token commission to the pool, and releases `netAmount` to the recipient. Emits `BridgeFundsOut`. NATIVE commission on `fundsOut` is disallowed (the caller is the multisig, not a user) — the contract reverts `NativeCommissionNotAllowedOnFundsOut`.

Owner **must** be `MultisigProxy`. `fundsOut` is only reachable through `MultisigProxy.execute()` (single-call) or `MultisigProxy.executeBatch()` (atomic multi-call, e.g. `Bridge.fundsOut` + `LZAdapter.sendOut` for outbound to non-Arbitrum), both of which require M-of-N TEE signatures.

#### FundsIn records (double-spend protection)

Every `fundsIn` stores `operationId => netAmount` in the `fundsInRecords` mapping. During `fundsOut`, TEE supplies an array of `fundsInIds` referencing specific deposits. The contract verifies each ID exists, then **partially consumes** them in order: full records are deleted; the last record on the chain is decremented if its remaining balance exceeds the requested `amount` so the surplus stays available for future `fundsOut` calls. This prevents:
- **Fake event attacks:** a malicious node operator cannot feed fake `BridgeFundsIn` events to TEE — the contract is the source of truth.
- **Double-spend:** every wei of net liquidity is referenced by exactly one record at all times.
- **Liquidity loss:** partial consumption preserves the residual on the same `operationId` rather than discarding it.

Note: records store the **net** amount (post-commission), i.e. the actual bridged liquidity. Gross amounts are available in the `BridgeFundsIn` event for backend bookkeeping.

#### Burn-id replay guard (single-use)

Every `fundsOut` call carries a `burnId` — an identifier the backend extracts from the source-side burn consignment. The `Bridge` keeps a `consumedBurnIds` mapping and **rejects** any call whose `burnId` is already recorded (`BurnIdAlreadyConsumed`). The flag is set before any token transfer (CEI ordering), so a revert anywhere downstream rolls the mark back together with the rest of the call. This complements `MultisigProxy`'s per-selector nonce: nonces stop a signature bundle from being executed twice, while `burnId` stops the same logical burn from being settled twice even under independent signature bundles.

#### BtcRelay integration

`fundsOut` calls `IBtcRelayView(btcRelay).verifyBlockheaderHash(blockHeight, commitmentHash)` and reverts if the block is unknown to the relay. The TEE backend supplies `blockHeight` and `commitmentHash` as part of the signed call data. This adds a trustless Bitcoin verification layer — the relay must have seen the block header before funds can be released.

### CommissionManager (`src/CommissionManager.sol`)

Standalone fee contract. Holds protocol commissions separately from bridge liquidity so that deployment, auditing, and withdrawal of fees are independent of bridge funds.

- **Route keys** are `keccak256(abi.encode(sourceChainId, destChainId, token))` where both chain IDs are `uint256` — directional, so each leg of a round trip can have its own config. EVM legs use `block.chainid`; non-EVM endpoints get backend-assigned IDs in a reserved namespace (e.g. `RGB = 1_000_001`).
- **Config** selects per route: `side` (`FUNDS_IN` vs `FUNDS_OUT`), `currency` (`TOKEN` vs `NATIVE`), `stablePercent` (×100, capped at 9000 = 90%), and `multiplier`. Global defaults apply to any route without an override.
- **NATIVE quotes** use an owner-set mock wei-per-token rate (global or per-token) and the token's `decimals()`.
- **Ingress:** `receiveTokenCommission(token)` and `receive()` are gated by `onlyBridge` — only `Bridge` may credit commissions. Pools are updated from balance deltas, so fee-on-transfer tokens are supported.
- **Owner** (`MultisigProxy` in production) configures rules, updates `bridgeAddress`, and withdraws accumulated pools. `renounceOwnership` is blocked.

### MultisigProxy (`src/MultisigProxy.sol`)

Owner of `Bridge` **and** `CommissionManager`. Two-level ECDSA M-of-N multisig:

- **Enclave signers (TEE)** — authorize `execute()` (single-call) and `executeBatch()` (atomic multi-call) calls (M-of-N, bitmap encoding). Used for `fundsOut` (and outbound `LZAdapter.sendOut` paired in a batch). Per-selector sequential nonces prevent replay on `execute`; a sequential `batchNonce` does the same for `executeBatch`. The TEE allowlist is keyed on `(target, selector)` pairs (`teeAllowedCalls`), enabling atomic multi-target batches without granting TEE blanket admin power.
- **Federation signers (governance)** — two-phase timelock for admin operations. Instant `emergencyPause` / `emergencyUnpause` bypass the timelock.

Federation-controlled operations (`OperationType`):

| OpType | Target | Purpose |
| :--- | :--- | :--- |
| `AdminExecute` | Bridge | Generic call, rarely needed |
| `UpdateEnclaveSigners` | self | Rotate TEE signer set / threshold |
| `UpdateFederationSigners` | self | Rotate federation signer set / threshold |
| `UpdateBridge` | self | Migrate to a redeployed Bridge |
| `SetCommissionRecipient` | self | Change destination address for CM withdrawals |
| `SetTeeAllowedCall` | self | Add/remove a `(target, selector)` pair from the TEE allowlist |
| `SetTimelockDuration` | self | Adjust the timelock window |
| `AdminExecuteCommissionManager` | CommissionManager | Generic call into CM (route rules, global defaults, mock rates, `transferOwnership`, …) |
| `WithdrawTokenCommissionCM` | CommissionManager | Withdraw ERC-20 commission to `commissionRecipient` |
| `WithdrawNativeCommissionCM` | CommissionManager | Withdraw native commission to `commissionRecipient` |
| `UpdateCommissionManager` | self | Migrate to a redeployed CommissionManager |
| `AdminExecuteAdapter` | LZAdapter | Generic call into the registered LayerZero adapter (`setTrustedEntrypoint`, `refundStuckFunds`, …). Reverts `ZeroTarget` if `MultisigProxy.lzAdapter` is unset. |
| `UpdateLZAdapter` | self | Rotate `MultisigProxy.lzAdapter` — the routing target for `AdminExecuteAdapter`. Setting to `address(0)` closes the adapter-admin path. |

Note: `MultisigProxy.lzAdapter` and `Bridge.lzAdapter` are **separate** fields with different roles. `Bridge.lzAdapter` gates `fundsInFromAdapter` (data path); `MultisigProxy.lzAdapter` is the target of `AdminExecuteAdapter` proposals (governance path). Both default to `address(0)` and are wired in by federation after the adapter is deployed.

## How it works

### FundsIn (user deposits)

1. The user (or frontend) quotes commission from `CommissionManager.calculateFundsInCommission(sourceChainId, destinationChainId, token, amount)`. EVM users pass `block.chainid` as `sourceChainId`.
2. The user approves `amount` to `Bridge` and calls `Bridge.fundsIn{ value: nativeCommission }(amount, destinationChainId, destinationAddress, operationId)`. No signature required — any user can lock tokens. Cross-chain (LayerZero compose) deposits land through `Bridge.fundsInFromAdapter(...)` instead, called by the trusted `LZAdapter` with an authenticated `sourceChainId`. Validation of the destination address and chain happens off-chain on the UTEXO backend before minting on the other side.
3. Bridge pulls `amount` in tokens, forwards `tokenCommission` and `nativeCommission` (if any) to `CommissionManager`, stores `netAmount = amount - tokenCommission` in `fundsInRecords`, and emits `FundsIn` + `BridgeFundsIn`.

### FundsOut (bridge withdrawals)

`Bridge.fundsOut()` is `onlyOwner`, where the owner is `MultisigProxy`. The backend collects M-of-N ECDSA signatures from TEE signers over an EIP-712 `BridgeOperation` message (selector, callData, nonce, deadline). The call data includes `burnId` (replay guard for the source-side burn), `blockHeight` and `commitmentHash` for BtcRelay verification, plus `destChainId` so CommissionManager can pick the right outbound route. `MultisigProxy.execute()` verifies the signatures on-chain and forwards the call to `Bridge`, which then:

1. Checks `burnId` has not been consumed yet and marks it consumed (replay guard).
2. Verifies the referenced `fundsInIds` exist and consumes them.
3. Verifies the Bitcoin block header against BtcRelay.
4. Quotes outbound commission via `CommissionManager.calculateFundsOutCommission(sourceChainId, destChainId, token, amount)`.
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

Two separate templates — one per phase. Copy each to a real file and fill it in only when you actually need that flow:

```sh
cp .env.deploy.example   .env.deploy      # one-time, for deploy/upgrade
cp .env.interact.example .env.interact    # day-to-day, for fundsIn / fundsOut sims
```

Foundry doesn't auto-load arbitrary names — load the file you need before running:

```sh
set -a && source .env.deploy   && set +a   # before deploy scripts
set -a && source .env.interact && set +a   # before interact scripts
```

**Key deploy variables** (`.env.deploy`):
- `USDT0_ADDRESS` — accepted ERC-20 token
- `BTC_RELAY_ADDRESS` — Atomiq BtcRelay contract address
- `LZ_ADAPTER` — initial LayerZero adapter address (optional; pass `0x0` if the adapter has not been deployed yet, then wire it in via federation governance after the adapter ships)
- `COMMISSION_MANAGER` — `CommissionManager` address (step-by-step deploys only)
- `COMMISSION_RECIPIENT` — destination for CM withdrawals
- `ENCLAVE_SIGNERS` / `FEDERATION_SIGNERS` — comma-separated addresses, ordered by bitmap bit index
- `TIMELOCK_DURATION` — federation timelock window in seconds

> Chain identifiers are `uint256` everywhere — `block.chainid` for EVM legs, backend-assigned values for non-EVM endpoints. There is no `SOURCE_CHAIN_NAME` env var anymore; the bridge reads `block.chainid` at runtime.

**Key interact variables** (`.env.interact`):
- `BRIDGE_ADDRESS`, `PROXY_ADDRESS`, `BASE_BRIDGE_ADDRESS` — deployed contracts
- `OPERATION_ID` — backend-assigned operation id (replay guard)
- `BURN_ID`, `BLOCK_HEIGHT`, `COMMITMENT_HASH`, `FUNDS_IN_IDS` — fundsOut-only inputs
- `DEST_CHAIN_ID` — destination chain id (`uint256`) used by `MultisigExecuteFundsOut.s.sol` when building calldata
- `ENCLAVE_PKS` / `FED_PKS` — comma-separated private keys for local TEE/federation simulation

## Deployment

All deploy scripts live in `script/deploy/`. They read their inputs from `.env.deploy`.

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

Scripts in `script/interact/` let you exercise contracts manually before the backend is wired up. All read inputs from `.env.interact`.

| Script | What it does |
|---|---|
| `BridgeFundsIn.s.sol` | Quotes commission from `CommissionManager`, approves tokens and calls `Bridge.fundsIn{ value: nativeCommission }(...)` |
| `BaseBridgeFundsIn.s.sol` | Approves tokens and calls `BaseBridge.fundsIn(amount, operationId)` |
| `BaseBridgeFundsOut.s.sol` | Calls `BaseBridge.fundsOut()` as owner |
| `MultisigExecuteFundsOut.s.sol` | Signs a `Bridge.fundsOut()` locally with `ENCLAVE_PKS` (10-arg `uint256`-chain-id signature including `destChainId`, `sourceChainId` and `burnId`) and submits via `MultisigProxy.execute()` |
| `EmergencyPause.s.sol` | Signs and submits `MultisigProxy.emergencyPause()` with `FED_PKS` |
| `EmergencyUnpause.s.sol` | Signs and submits `MultisigProxy.emergencyUnpause()` with `FED_PKS` |

Example:

```sh
forge script script/interact/BridgeFundsIn.s.sol --rpc-url $RPC_URL --broadcast
```

> **Security note:** `MultisigExecuteFundsOut` signs with local private keys from `.env.interact`. Only use for testnet and local end-to-end checks. In production, TEE enclaves produce signatures; this script just simulates that flow.

## Post-deployment checklist

1. Verify Bridge ownership: `Bridge.owner()` returns the `MultisigProxy` address.
2. Verify CommissionManager ownership: `CommissionManager.owner()` returns the `MultisigProxy` address.
3. Verify CommissionManager linkage: `CommissionManager.bridgeAddress()` returns the live `Bridge` address; `Bridge.commissionManager()` returns the live `CommissionManager` address.
4. Verify BtcRelay: `Bridge.btcRelay()` returns the expected BtcRelay contract address.
5. Verify LZ adapter wiring: `Bridge.lzAdapter()` and `MultisigProxy.lzAdapter()` both return `address(0)` immediately after deploy. Once the adapter is live, federation must run two timelocked proposals:
   - `proposeAdminExecute` on the proxy with calldata `Bridge.setLZAdapter(adapter)` — opens the `fundsInFromAdapter` data path.
   - `proposeUpdateLZAdapter(adapter)` — opens the `AdminExecuteAdapter` governance path on the proxy.
6. Verify enclave signers: `MultisigProxy.getEnclaveSigners()` returns the TEE addresses.
7. Verify federation signers: `MultisigProxy.getFederationSigners()` returns the governance addresses.
8. Verify TEE-allowed call: `MultisigProxy.teeAllowedCalls(bridgeAddress, fundsOutSelector)` returns `true` (selector for the 10-arg `uint256`-chain-id `fundsOut` signature with `destChainId`, `sourceChainId` and `burnId`).
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
.env.deploy.example           — Deploy environment template
.env.interact.example         — Interaction environment template
```
