import { task, types } from 'hardhat/config';
import { getNetworkScanUrl, ZERO_ADDRESS } from './util';

task('deploy-bridge', 'Deploy the bridge contract').setAction(async (taskArgs, hre) => {
    const { ethers, run } = hre;
    const [deployer] = await ethers.getSigners();

    console.log('Deploying bridge contract ...');

    console.log('----------------------------------------------------');
    console.log(`Deployer account: ${deployer.address}`);
    console.log(
        'Deployer balance:',
        (await ethers.provider.getBalance(deployer.address)).toString()
    );

    const bridgeContractFactory = await ethers.getContractFactory('Bridge');
    const bridge = await bridgeContractFactory.deploy();
    await bridge.waitForDeployment();

    console.log(`Bridge contract deployed at: ${await bridge.getAddress()}`);

    try {
        console.log('----------------------------------------------------');
        console.log('Starting verification process...');

        console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);

        await run('verify:verify', {
            address: `${await bridge.getAddress()}`,
            constructorArguments: [],
        });
    } catch (error) {
        console.error(error);
    }
});
