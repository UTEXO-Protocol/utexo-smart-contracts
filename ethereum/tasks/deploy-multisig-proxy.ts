import { task, types } from 'hardhat/config';
import { ZERO_ADDRESS } from './util';

task('deploy-multisig-proxy', 'Deploy MultisigProxy contract and transfer Bridge ownership')
    .addParam('bridge', 'Address of the Bridge proxy contract', ZERO_ADDRESS, types.string)
    .addParam('enclavesigners', 'Comma-separated enclave signer addresses', undefined, types.string)
    .addParam('enclavethreshold', 'Enclave M-of-N threshold', undefined, types.int)
    .addParam('federationsigners', 'Comma-separated federation signer addresses', undefined, types.string)
    .addParam('federationthreshold', 'Federation M-of-N threshold', undefined, types.int)
    .addParam('commissionrecipient', 'Address to receive withdrawn commission', undefined, types.string)
    .addParam('timelock', 'Timelock duration in seconds', undefined, types.int)
    .addOptionalParam('transferownership', 'Transfer Bridge ownership to MultisigProxy', true, types.boolean)
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;
        const [deployer] = await ethers.getSigners();

        const {
            bridge,
            enclavesigners,
            enclavethreshold,
            federationsigners,
            federationthreshold,
            commissionrecipient,
            timelock,
            transferownership,
        } = taskArgs;

        // Parse signer addresses
        const enclaveSignerList = enclavesigners.split(',').map((s: string) => s.trim());
        const federationSignerList = federationsigners.split(',').map((s: string) => s.trim());

        // Validate addresses
        if (!ethers.isAddress(bridge)) {
            console.error('Invalid bridge address:', bridge);
            return;
        }
        if (!ethers.isAddress(commissionrecipient)) {
            console.error('Invalid commission recipient address:', commissionrecipient);
            return;
        }
        for (const addr of enclaveSignerList) {
            if (!ethers.isAddress(addr)) {
                console.error('Invalid enclave signer address:', addr);
                return;
            }
        }
        for (const addr of federationSignerList) {
            if (!ethers.isAddress(addr)) {
                console.error('Invalid federation signer address:', addr);
                return;
            }
        }

        console.log('----------------------------------------------------');
        console.log(`Deployer account: ${deployer.address}`);
        console.log('Deployer balance:', (await ethers.provider.getBalance(deployer.address)).toString());
        console.log('----------------------------------------------------');
        console.log(`Bridge:                ${bridge}`);
        console.log(`Enclave signers (${enclaveSignerList.length}): ${enclaveSignerList.join(', ')}`);
        console.log(`Enclave threshold:     ${enclavethreshold}`);
        console.log(`Federation signers (${federationSignerList.length}): ${federationSignerList.join(', ')}`);
        console.log(`Federation threshold:  ${federationthreshold}`);
        console.log(`Commission recipient:  ${commissionrecipient}`);
        console.log(`Timelock duration:     ${timelock}s`);
        console.log('----------------------------------------------------');

        const multisigFactory = await ethers.getContractFactory('MultisigProxy');
        const multisig = await multisigFactory.deploy(
            bridge,
            enclaveSignerList,
            enclavethreshold,
            federationSignerList,
            federationthreshold,
            commissionrecipient,
            timelock
        );
        await multisig.waitForDeployment();

        const multisigAddress = await multisig.getAddress();
        console.log(`MultisigProxy deployed at: ${multisigAddress}`);

        if (transferownership) {
            console.log('----------------------------------------------------');
            console.log('Transferring Bridge ownership to MultisigProxy...');
            const bridgeContract = await ethers.getContractAt('Bridge', bridge);
            const currentOwner = await bridgeContract.owner();
            if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
                console.error(`Cannot transfer ownership: deployer (${deployer.address}) is not current owner (${currentOwner})`);
            } else {
                const tx = await bridgeContract.transferOwnership(multisigAddress);
                await tx.wait();
                console.log(`Bridge ownership transferred to ${multisigAddress}`);
            }
        }

        // Verify
        try {
            console.log('----------------------------------------------------');
            console.log('Starting verification process...');
            await run('verify:verify', {
                address: multisigAddress,
                constructorArguments: [
                    bridge,
                    enclaveSignerList,
                    enclavethreshold,
                    federationSignerList,
                    federationthreshold,
                    commissionrecipient,
                    timelock,
                ],
            });
            console.log('MultisigProxy verified successfully');
        } catch (error) {
            console.error('Verification failed:', error);
        }
    });
