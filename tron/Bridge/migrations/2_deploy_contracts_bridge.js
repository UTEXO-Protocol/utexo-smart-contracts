var Bridge = artifacts.require("./Bridge.sol");

module.exports = function(deployer, network, accounts) {
  deployer.deploy(Bridge);
};