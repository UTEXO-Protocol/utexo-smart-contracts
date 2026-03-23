var MultiToken = artifacts.require("./MultiToken.sol");

module.exports = function(deployer) {
    const args = process.argv.slice(2);
    const bridgeArg = args.find(arg => arg.includes('--bridge-address='));

    if (!bridgeArg) {
        throw new Error("Error: Please specify a bridge address using --bridge-address=<address>");
    }
    const bridgeAddress = bridgeArg.split('=')[1];
  
    deployer.deploy(MultiToken).then(function (instance) {
      return instance.initialize(bridgeAddress);
    });
  };