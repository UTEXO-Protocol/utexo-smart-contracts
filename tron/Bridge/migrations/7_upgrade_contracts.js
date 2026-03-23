const Bridge = artifacts.require('Bridge');
const BridgeContractProxyAdmin = artifacts.require('BridgeContractProxyAdmin');
const TransparentProxy = artifacts.require('TransparentProxy');
const tronWeb = require('tronweb');

module.exports = async function (deployer, network, accounts) {
  const args = process.argv.slice(2);
  const proxyAdminArg = args.find(arg => arg.includes('--pxadmin='));
  const proxyArg = args.find(arg => arg.includes('--proxy='));
  const newImplArg = args.find(arg => arg.includes('--newimpl='));

  if (!proxyAdminArg || !proxyArg) {
    console.error("Both --pxadmin (proxy admin address) and --proxy (proxy contract address) are required.");
    return;
  }

  const proxyAdminAddress = proxyAdminArg.split('=')[1];
  const proxyAddress = proxyArg.split('=')[1];
  let newImplAddress = newImplArg ? newImplArg.split('=')[1] : null;

  console.log(`\nUsing ${proxyAdminAddress} as BridgeContractProxyAdmin`);
  console.log(`Using ${proxyAddress} as TransparentProxy`);

  const signerAddress = accounts;  // Use first account for deploy
  console.log(`Deployer address: ${signerAddress}\n`);

  if (!newImplAddress) {
    console.log(`No 'newimpl' provided, deploying new Bridge implementation...\n`);
    await deployer.deploy(Bridge);
    const bridge = await Bridge.deployed();
    newImplAddress = bridge.address;
    console.log(`\nNew Bridge implementation deployed at: ${tronWeb.address.fromHex(newImplAddress)}`);
  } else {
    console.log(`Using provided new implementation address: ${newImplAddress}\n`);
  }

  const proxyAdminContract = await BridgeContractProxyAdmin.at(proxyAdminAddress);

  const proxyContract = await TransparentProxy.at(proxyAddress);
  const trueProxyAdmin = await proxyContract.getProxyAdmin();

  if (tronWeb.address.fromHex(trueProxyAdmin) !== proxyAdminAddress) {
    console.error(`Invalid proxy admin: ${tronWeb.address.fromHex(trueProxyAdmin)} != ${proxyAdminAddress}`);
    return;
  }  

  // Check owner of proxyAdmin contract
  const trueProxyAdminOwner = tronWeb.address.fromHex(await proxyAdminContract.owner());
  if (trueProxyAdminOwner !== signerAddress) {
    console.error(`Invalid signer: ${trueProxyAdminOwner} != ${signerAddress}`);
    return;
  }

  // Upgrade
  console.log(`Upgrading proxy to new implementation at ${tronWeb.address.fromHex(newImplAddress)}...`);
  await proxyAdminContract.upgrade(proxyAddress, newImplAddress);
  console.log(`Upgrade successful!`);

  console.log('----------------------------------------------------');
};

