var BridgeContractProxyAdmin = artifacts.require("./BridgeContractProxyAdmin.sol");

module.exports = function(deployer) {
    deployer.deploy(BridgeContractProxyAdmin);    
};