var FungibleToken = artifacts.require("./FungibleToken.sol");

module.exports = function(deployer) {
  const args = process.argv.slice(2);
  const nameArg = args.find(arg => arg.includes('--name='));
  const bridgeAddressArg = args.find(arg => arg.includes('--bridge-address='));
  const initialSupplyArg = args.find(arg => arg.includes('--initial-supply='));

  if (!nameArg || !bridgeAddressArg || !initialSupplyArg) {
    throw new Error("Error: Please specify correct params: --name=<TokenName> --bridge-address=<BridgeAddress> --initial-supply=<InitialSupply>");
  }

  const name = 'TricornWrapped ' + nameArg.split('=')[1];
  const symbol = 't' + nameArg.split('=')[1];
  const bridgeAddress = bridgeAddressArg.split('=')[1];
  const initialSupply = initialSupplyArg.split('=')[1];

  deployer.deploy(FungibleToken, name, symbol, bridgeAddress, initialSupply);
};
