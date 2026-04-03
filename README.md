## UTEXO Bridge

Cross-chain ERC-20 token bridge built with Foundry.

## Requirements

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

## Setup

```shell
cp .env.example .env
# Fill in PRIVATE_KEY, RPC_URL, ETHERSCAN_API_KEY, SUPPORTED_TOKENS
```

## Build

```shell
forge build
```

## Test

```shell
forge test
```

## Deploy

```shell
source .env
forge script script/Bridge.s.sol --rpc-url $RPC_URL --broadcast
```

## Deploy & Verify

```shell
source .env
forge script script/Bridge.s.sol --rpc-url $RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

## Other

```shell
# Format
forge fmt

# Gas snapshot
forge snapshot

# Local node
anvil

# Interact with deployed contract
cast <subcommand>
```
