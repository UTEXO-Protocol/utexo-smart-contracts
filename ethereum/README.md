# UTEXO(ToDo update readme)

- Tests from the box
- TypeChain typescript types for Smart Contracts generation upon compilation by `typechain`
- Docs - generation upon compilation by `dodoc`
- Autoformatting - added `prettier` tool for auto format smart contracts
- Lint - added `solhint` tool for auto format smart contracts
- Gar Reporter - will be generated upon tests execution
- Test Coverage Reporter - will be generated upon tests execution

# Development

Prerequisites:

- NodeJS v18. Use `nvm` or similar multi-node tools to set up

Setup:

```sh
npm i
```

Available actions:

- `npm run compile`: compile, generate TypeChain, docs
- `npm run test`: run contract tests locally
- `npm run coverage`: generate code coverage report
- `npm run clean`: deletes compiled smart contracts, coverage reports, HardHat cache etc.
- `npm run lint`: run Solidity linter
- `npm run deploy:<chain>`: deploy compiled smart contract to specified chain `<chain>`.
  Consult `package.json/scripts` for the list of supported chains.
  See [Deploy](#deploy) section for necessary setup steps

# Deploy

- Copy `.env.testnet` (or other `.env.*` template file) into `.env`
- Fill `DEPLOY_KEY` with private key of account who would be deploying contract
- Remove optional lines, like `ETHERSCAN_API_KEY`, if you don't need them
- Run `npm run deploy:<chain>`

# tasks

1.`npx hardhat deploy-bridge --network <NETWORK NAME>`

2.`npx hardhat deploy-proxies --network <NETWORK NAME> --bridge <BRIDGE_IMPLEMENTATION> --admin <PROXY_ADMIN_IF_EXISTS> --systemsigner <SIGNER_ADDRESS_IF_NOT_THE_SAME>`

3.`npx hardhat upgrade-bridge --network <NETWORK NAME> --pxadmin <PROXY_ADMIN> --proxy <PROXY> --newimpl <NEW_IMPLEMENTATION>`

### Deploy token

1. `npx hardhat deploy-fungible-token --network <NETWORK NAME> --name <ORIGINAL_TOKEN_SYMBOL> --bridge <BRIDGE>`
