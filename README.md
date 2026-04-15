# Utexo Bridge — Smart Contracts

Smart contracts for the Utexo cross-chain bridge. Each supported network has its own directory with chain-specific contract implementations, tests, and deployment scripts.

## Repository structure

```
ethereum/   — EVM contracts (Solidity, Hardhat)
tron/       — Tron contracts
```

See the README in each directory for setup and deployment instructions.

## Architecture overview

The bridge transfers assets between networks. A transfer consists of two on-chain operations: `FundsIn` on the source network (user deposits) and `FundsOut` on the destination network (bridge releases funds to the recipient).

### Signing model

The bridge uses a federated M-of-N signing model. Multiple independent signer nodes run inside Nitro Enclaves (TEE). Each node validates transfer data independently and produces a signature only after its own checks pass. A `FundsOut` transaction executes only after the required threshold of valid signatures is collected.

There are two independent signer sets:

**Enclave signers (TEE)** — authorize routine value-transfer operations. For `FundsOut`, M-of-N signatures are required. For `FundsIn` (signature verification at deposit time), a single TEE signature is sufficient (1-of-N).

**Federation signers (governance)** — authorize administrative operations: signer rotation, configuration changes, commission withdrawal. All federation operations go through a two-phase timelock (propose → wait → execute), except emergency pause/unpause which are instant.

Private keys are held inside Nitro Enclaves and cannot be extracted. Key persistence is handled through attested enclave-to-enclave cloning.

### Signing scope by direction

| Direction | FundsIn (source side) | FundsOut (destination side) |
| :---- | :---- | :---- |
| EVM → RGB | 1-of-N TEE signature verified on EVM contract | M-of-N PSBT signing inside TEE enclaves |
| RGB → EVM |  | M-of-N ECDSA verified on EVM contract via `MultisigProxy` |

### Commission

Each transfer deducts a service commission on the source side and a blockchain fee on the destination side. Commission accumulates in per-token pools on the bridge contract. Withdrawal is controlled by federation governance through the timelock.

### Replay protection

Each network enforces replay protection at the smart-contract level. EVM contracts use nonce mappings for `FundsIn` and per-selector sequential nonces for `FundsOut`.
