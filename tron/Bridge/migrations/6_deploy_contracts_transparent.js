var TransparentProxy = artifacts.require("./TransparentProxy.sol");
var Bridge = artifacts.require("./Bridge.sol");

module.exports = async function (deployer) {
  const args = process.argv.slice(2);
  const bridgeArg = args.find(arg => arg.includes('--bridge-address='));
  const proxyAdminArg = args.find(arg => arg.includes('--proxy-admin='));
  const signerArg = args.find(arg => arg.includes('--signer='));

  if (!bridgeArg || !proxyAdminArg || !signerArg) {
      throw new Error("Error: Please specify --bridge-address= --proxy-admin= --signer=");
  }

  const bridgeAddress = bridgeArg.split('=')[1];
  const proxyAdminAddress = proxyAdminArg.split('=')[1];
  const signer = signerArg.split('=')[1];

  await deployer.deploy(TransparentProxy, bridgeAddress);

  const proxyAddress = TransparentProxy.address;

  const proxy = await TransparentProxy.at(proxyAddress);

  await proxy.changeAdmin(proxyAdminAddress);

  const proxyAsBridge = await Bridge.at(proxyAddress);

  await proxyAsBridge.initialize(signer);

  console.log(`Proxy deployed at: ${proxyAddress}`);
  console.log(`Admin set to: ${proxyAdminAddress}`);
  console.log(`Bridge initialized with signer: ${signer}`);
};