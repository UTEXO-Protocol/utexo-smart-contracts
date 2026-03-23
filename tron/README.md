## Deploy commands

First of all, you need to deploy a migration contract

```
npx tronbox migrate --reset --network <Network> --f 1 --to 1
```

**Bridge**

```
npx tronbox migrate --reset --network <Network> --f 2 --to 2
```

**Fungible Token**

```
npx tronbox migrate --reset --network <Network> --f 3 --to 3 --name=<TokenName> --initial-supply=<Supply> --bridge-address=<Address>
```

**Multi Token**

```
npx tronbox migrate --reset --network <Network> --f 4 --to 4 --bridge-address=<Address>
```

**Proxy admin**

```
npx tronbox migrate --reset --network <Network> --f 5 --to 5
```

**Transparent Proxy**

```
npx tronbox migrate --reset --network <Network> --f 6 --to 6 --bridge-address=<Address> --proxy-admin=<Address> --signer=<SignerAddress>
```

## Upgrade

**Upgrade with implementation address**

```
npx tronbox migrate --reset --network <Network> --f 7 --to 7 --pxadmin=<Address> --proxy=<Address> --newimpl=<Address>
```

**Upgrade without implementation address**

```
npx tronbox migrate --reset --network <Network> --f 7 --to 7 --pxadmin=<Address> --proxy=<Address>
```

> `--reset`: Run all migrations from the beginning, instead of running from the last completed migration.
> `--f <number>`: Run contracts from a specific migration. The number refers to the prefix of the migration file.
> `--to <number>`: Run contracts to a specific migration. The number refers to the prefix of the migration file.

> For more information [here](https://developers.tron.network/reference/tronbox-command-line).
