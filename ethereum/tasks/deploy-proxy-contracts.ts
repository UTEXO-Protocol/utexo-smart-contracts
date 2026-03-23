import { task, types } from 'hardhat/config';
import { ZERO_ADDRESS, getNetworkScanUrl } from './util';

task('deploy-proxies', 'Deploy a proxy contract')
    .addParam('bridge', 'Address of the bridged contract', ZERO_ADDRESS, types.string)
    .addOptionalParam('admin', 'Address of the proxy admin', undefined, types.string)
    .addOptionalParam('systemsigner', 'Address of the proxy admin', undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;
        let { bridge, admin, systemsigner } = taskArgs;
        const [deployer] = await ethers.getSigners();
        console.log('----------------------------------------------------');
        console.log(`Deployer account: ${deployer.address}`);
        console.log(
            'Deployer balance:',
            (await ethers.provider.getBalance(deployer.address)).toString()
        );

        if (!systemsigner) {
            systemsigner = deployer.address;
            console.log(
                `No systemsigner provided, default signer (${systemsigner}) will be used...`
            );
        }

        let proxyAdmin;
        if (admin === undefined) {
            console.log('No proxy admin address provided, deploying a new one...');

            const adminContractFactory = await ethers.getContractFactory(
                'BridgeContractProxyAdmin'
            );
            const bridgeContractProxyAdmin = await adminContractFactory.deploy();
            await bridgeContractProxyAdmin.waitForDeployment();
            admin = await bridgeContractProxyAdmin.getAddress();
            proxyAdmin = true;
            console.log(`Deployed new proxy admin at ${admin}`);
        } else if (!ethers.isAddress(admin)) {
            console.error('Invalid proxy admin address provided');
            return;
        } else {
            console.error(`Using provided proxy admin at ${admin}...`);
        }
        console.log('----------------------------------------------------');

        //
        // DEPLOYING TRANSPARENT PROXY CONTRACT
        //
        console.log(`Deploying transparent proxy contract for bridge ${bridge}...`);
        const transparentProxyContractFactory = await ethers.getContractFactory('TransparentProxy');
        const transparentProxy = await transparentProxyContractFactory.deploy(bridge);
        await transparentProxy.waitForDeployment();
        console.log(
            `Deployed transparent proxy contract at ${await transparentProxy.getAddress()}`
        );
        console.log('----------------------------------------------------');
        console.log(`Changing proxy admin to ${admin}`);
        const changeAdminTx = await transparentProxy.changeAdmin(admin);
        await changeAdminTx.wait();
        console.log('----------------------------------------------------');

        //
        // INITIALIZING BRIDGE CONTRACT VIA PROXY
        //
        console.log(`Initializing with Bridge address...`);
        const bridgeContract = await ethers.getContractAt(
            'Bridge',
            await transparentProxy.getAddress()
        );
        const initializeTx = await bridgeContract.initialize(systemsigner);
        await initializeTx.wait();
        console.log(
            `Initialized bridge contract via proxy at ${await transparentProxy.getAddress()} with signer ${systemsigner}`
        );
        console.log('----------------------------------------------------');

        //
        // VERIFYING PROXY CONTRACTS
        //
        console.log(`Starting verification process... `);
        const network = hre.network.name;
        try {
            console.log(`Verifying transparent proxy contract...`);
            await run('verify:verify', {
                address: `${await transparentProxy.getAddress()}`,
                constructorArguments: [bridge],
            });
        } catch (error) {
            console.error(`Verification failed: ${error}`);
        }
        console.log('----------------------------------------------------');
        if (proxyAdmin)
            try {
                console.log(`Verifying proxy admin contract...`);
                await run('verify:verify', {
                    address: admin,
                    constructorArguments: [],
                });
            } catch (error) {
                console.error(`Verification failed: ${error}`);
            }
    });
