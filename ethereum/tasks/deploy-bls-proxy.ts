import { task, types } from 'hardhat/config';
import { ZERO_ADDRESS } from './util';

task('deploy-bls-proxy', 'Deploy a BlsProxy contract and update Bridge owner')
    .addParam('proxy', 'Address of the transparent proxy contract', ZERO_ADDRESS, types.string)
    .addParam('proxyadmin', 'Address of the proxy admin', ZERO_ADDRESS, types.string)
    .addParam('x0', 'First coordinate of the G2 point X', '', types.string)
    .addParam('x1', 'Second coordinate of the G2 point X', '', types.string)
    .addParam('y0', 'First coordinate of the G2 point Y', '', types.string)
    .addParam('y1', 'Second coordinate of the G2 point Y', '', types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;
        const { proxy, proxyadmin, x0, x1, y0, y1 } = taskArgs;

        const [deployer] = await ethers.getSigners();
        console.log('----------------------------------------------------');
        console.log(`Deployer account: ${deployer.address}`);
        console.log(
            'Deployer balance:',
            (await ethers.provider.getBalance(deployer.address)).toString()
        );

        if (!ethers.isAddress(proxy) || proxy === ZERO_ADDRESS) {
            console.error('Invalid proxy address provided');
            return;
        }

        if (!ethers.isAddress(proxyadmin) || proxyadmin === ZERO_ADDRESS) {
            console.error('Invalid proxy admin address provided');
            return;
        }

        if (!x0 || !x1 || !y0 || !y1) {
            console.error('Invalid G2 coordinates provided');
            return;
        }

        //
        // DEPLOYING BLS PROXY CONTRACT
        //
        console.log(`\nDeploying BLS Proxy with bridge ${proxy} and agg pub key...`);
        const blsProxyFactory = await ethers.getContractFactory('BlsProxy');
        const blsProxy = await blsProxyFactory.deploy(proxy, {
            X: [x0, x1],
            Y: [y0, y1],
        });
        await blsProxy.waitForDeployment();
        const blsProxyAddress = await blsProxy.getAddress();
        console.log(`Deployed BLS Proxy contract at ${blsProxyAddress}`);
        console.log('----------------------------------------------------');

        //
        // TRANSFERRING OWNERSHIP OF BRIDGE CONTRACT
        //
        console.log(`Transferring Bridge ownership to BLS Proxy...`);
        const bridgeContract = await ethers.getContractAt('Bridge', proxy);
        const transferOwnershipTx = await bridgeContract.transferOwnership(blsProxyAddress);
        await transferOwnershipTx.wait();
        console.log(`Bridge ownership transferred to BLS Proxy at ${blsProxyAddress}`);
        console.log('----------------------------------------------------');

        //
        // CHANGE ADMIN OF PROXY ADMIN
        //
        console.log(`\nChange admin from ProxyAdmin to BLS Proxy...`);
        const bridgeContractProxyAdmin = await ethers.getContractAt(
            'BridgeContractProxyAdmin',
            proxyadmin
        );
        const transferProxyAdminTx = await bridgeContractProxyAdmin.changeProxyAdmin(
            proxy,
            blsProxyAddress
        );
        await transferProxyAdminTx.wait();
        console.log(`Proxy Admin ownership transferred to BLS Proxy at ${blsProxyAddress}`);
        console.log('----------------------------------------------------');

        //
        // VERIFYING BLS PROXY CONTRACT
        //
        console.log(`Starting verification process...`);
        try {
            await run('verify:verify', {
                address: blsProxyAddress,
                constructorArguments: [proxy, { X: [x0, x1], Y: [y0, y1] }],
            });
            console.log(`Verified BLS Proxy contract at ${blsProxyAddress}`);
        } catch (error) {
            console.error(`Verification failed: ${error}`);
        }
        console.log('----------------------------------------------------');
    });
