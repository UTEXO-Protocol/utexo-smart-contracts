# Utexo Bridge — Smart Contracts

Smart contracts for the Utexo cross-chain bridge. Each supported network has its own directory with chain-specific contract implementations, tests, and deployment scripts.

## Repository structure

```
ethereum/   — EVM contracts (Solidity, Foundry)
```

See the README in each directory for setup and deployment instructions.

## Architecture overview

The bridge transfers assets between the EVM side and Bitcoin-anchored networks (RGB, and other Bitcoin L2s in the future). A transfer consists of two on-chain operations: `FundsIn` on the source network (user deposit) and `FundsOut` on the destination network (bridge releases funds to the recipient).

### Deployment topology

The EVM-side contracts in this repository are deployed on Arbitrum. Cross-chain delivery from other EVM networks is implemented by an external delivery layer that lives outside this repository — from the perspective of the contracts here, every deposit lands on Arbitrum and is treated identically regardless of where the user originated from.

```
                 ┌─────────────────────────── Arbitrum ─────────────────────────────┐
                 │                                                                  │
                 │                                          Bridge ◀── BtcRelay     │
                 │                                              │                   │
                 │                              CommissionManager                   │
                 │                                              ▲                   │
                 │                                              │                   │
                 │                                       MultisigProxy              │
                 │                                  (TEE + Federation)              │
                 └──────────────────────────────────────────────────────────────────┘
```

**Arbitrum — main contracts:**

- **`Bridge`** — the value-holding contract. Locks the bridged ERC-20 on `fundsIn`, releases it on `fundsOut`. Emits the events that the backend watches to drive Bitcoin-side actions. Owned by `MultisigProxy`.

- **`CommissionManager`** — a dedicated fee-accounting contract that holds the protocol's commissions strictly separated from bridge liquidity. The `Bridge` consults it on every transfer to determine the per-route commission (token vs. native; charged on `FundsIn` vs. `FundsOut`) and forwards the fee to it. Withdrawal is gated by federation governance through `MultisigProxy`. Owned by `MultisigProxy`.

- **`MultisigProxy`** — the authorization layer. Owns both `Bridge` and `CommissionManager`. Two independent signer sets and two execution paths: TEE-authorized routine operations (`FundsOut`) execute immediately on M-of-N enclave signatures; federation-authorized administrative operations (signer rotation, configuration changes, commission withdrawal, contract address updates) go through a two-phase propose → timelock → execute flow. Emergency pause/unpause is the only federation operation that is instant.

- **`BtcRelay`** — a trustless on-chain Bitcoin SPV light client. It stores Bitcoin block headers and validates them by checking proof-of-work continuity and the difficulty-retarget rules. The `Bridge` consults `BtcRelay` on `fundsOut` to confirm that the corresponding Bitcoin-side event (the RGB transfer that justifies the release) is anchored in a Bitcoin block with sufficient confirmations. This removes the need to trust any single oracle or off-chain attestation for Bitcoin finality: the EVM-side release of funds is gated by Bitcoin's own consensus, observed on-chain.

### Signing model

The bridge uses a federated M-of-N signing model. Multiple independent signer nodes run inside Enclaves (TEE). Each node validates transfer data independently and produces a signature only after its own checks pass. A `FundsOut` transaction executes only after the required threshold of valid signatures is collected.

There are two independent signer sets:

**Enclave signers (TEE)** — authorize routine value-transfer operations. For `FundsOut`, M-of-N signatures are required. In turn, `FundsIn` does not perform any TEE signature verification, so anyone can call it.

**Federation signers (governance)** — authorize administrative operations: signer rotation, configuration changes, commission withdrawal, and updates to the addresses of `Bridge` / `CommissionManager`. All federation operations go through a two-phase timelock (propose → wait → execute), except emergency pause/unpause which are instant.

Private keys are held inside Enclaves and cannot be extracted. Key persistence is handled through attested enclave-to-enclave cloning.

### Signing scope by direction

| Direction | FundsIn (source side) | FundsOut (destination side) |
| :---- | :---- | :---- |
| EVM → RGB | Anyone can call FundsIn and lock funds in the EVM contract | M-of-N PSBT signing inside TEE enclaves |
| RGB → EVM |  | M-of-N ECDSA verified on the EVM contract via `MultisigProxy` |

### Commission

Each transfer deducts a service commission, configured per-route: source side (`FundsIn`) or destination side (`FundsOut`), in the bridged token or the native currency of the chain. On EVM the commission is held by the `CommissionManager` contract — kept separate from bridge liquidity — and withdrawal is controlled by federation governance through the timelock.

### Replay protection

Each network enforces replay protection at the smart-contract level. On EVM the `Bridge` uses transaction-id mappings for `FundsIn` and per-selector sequential nonces on `MultisigProxy.execute` for `FundsOut`. In addition, every `FundsOut` call carries the `burnId` extracted from the source-side burn consignment; the `Bridge` records consumed `burnId`s on-chain and rejects any future `FundsOut` referencing the same id.
