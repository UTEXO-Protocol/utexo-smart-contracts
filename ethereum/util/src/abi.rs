use ethers::prelude::abigen;

abigen!(ERC20Contract, "./contract/abi/TestToken.abi");
abigen!(BridgeContract, "./contract/abi/Bridge.abi");
