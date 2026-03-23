import { task, types } from 'hardhat/config';

task('upgrade-bridge', 'Deploy a proxy contract')
    .addOptionalParam('pxadmin', 'Bridge contract proxy admin address', undefined, types.string)
    .addOptionalParam('proxy', 'Transparent proxy address', undefined, types.string)
    .addOptionalParam('newimpl', 'New implementation contract address', undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;

        let { pxadmin, proxy, newimpl } = taskArgs;

        const [deployer] = await ethers.getSigners();

        if (!ethers.isAddress(pxadmin)) {
            console.error('Invalid proxy admin address provided');
        }
        console.log(`using ${pxadmin} as BridgeContractProxyAdmin`);

        if (!newimpl) {
            console.log(`No 'newimpl' bridge contract address provided, deploying new...`);

            const bridgeContractFactory = await ethers.getContractFactory('Bridge');
            const bridge = await bridgeContractFactory.deploy();
            await bridge.waitForDeployment();
            newimpl = await bridge.getAddress();
            console.log(`new Bridge contract implementation deployed at: ${newimpl}`);
        }

        const bridgeContractProxyAdmin = await ethers.getContractAt(
            'BridgeContractProxyAdmin',
            pxadmin
        );

        // test px admin validity
        const OWNER_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
        console.log(`reading owner slot from proxy to check...`);
        const slotInfo = await ethers.provider.getStorage(proxy, OWNER_SLOT);
        console.log(slotInfo.slice(26));
        const truePxAdmin = ethers.getAddress(slotInfo.slice(26));
        if (truePxAdmin != pxadmin) {
            console.error(`Invalid proxy admin for provided proxy, ${truePxAdmin} != ${pxadmin}`);
            return;
        }

        // test pxAdmin owner validity
        const truePxAdminOwner = await bridgeContractProxyAdmin.owner();
        if (truePxAdminOwner != (await deployer.getAddress())) {
            console.error(
                `Invalid signer used for provided proxy admin, ${truePxAdminOwner}!=${await deployer.getAddress()}`
            );
            return;
        }

        const result = await bridgeContractProxyAdmin.upgrade(proxy, newimpl);
        await result.wait();
        console.log(`UPGRADE IS DONE!`);

        //
        // VERIFYING PROXY CONTRACTS
        //
        console.log(`Verifying new implementation...`);
        try {
            await run('verify:verify', {
                address: newimpl,
                constructorArguments: [],
            });
        } catch (error) {
            console.error(`Verification failed: ${error}`);
        }
        console.log('----------------------------------------------------');
    });
