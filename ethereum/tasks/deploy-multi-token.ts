import { task, types } from 'hardhat/config';
import { ZERO_ADDRESS, getNetworkScanUrl } from './util';

// NOTE: This is deployment of implementation contract. Proxy is needed
task('deploy-multi-token', 'Deploy MultiToken contract')
    .addOptionalParam('bridge', 'Address of bridge contract', undefined, types.string)
    .addOptionalParam('b', 'Alias for --bridge', ZERO_ADDRESS, types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;
        const [deployer] = await ethers.getSigners();

        const bridge = taskArgs.bridge || taskArgs.b;

        if (!ethers.isAddress(bridge)) {
            console.error('bridgeAddress should be a valid address, instead: ', bridge);
            return;
        }

        console.log(`Deploying MultiToken with bridge contract at ${bridge}...`);
        console.log(`Deploye account: ${deployer.address}`);
        console.log(`Deployer balance: ${await ethers.provider.getBalance(deployer.address)}`);

        const multiTokenContractFactory = (await ethers.getContractFactory('MultiToken')).connect(
            deployer
        );
        const multiToken = await multiTokenContractFactory.deploy({ from: deployer.address });
        await multiToken.waitForDeployment();

        const multiTokenAddress = await multiToken.getAddress();
        console.log(`Multi token deployed at address: ${multiTokenAddress}`);

        try {
            console.log('Starting verification process...');
            const network = ethers.provider.getNetwork();
            const url = getNetworkScanUrl((await network).name);

            await run('verify:verify', {
                address: multiTokenAddress,
                constructorArguments: [],
            });
            console.log(`Multi token verified on ${url}/address/${multiTokenAddress}`);
        } catch (error) {
            console.error('Verification failed: ', error);
        }
    });
