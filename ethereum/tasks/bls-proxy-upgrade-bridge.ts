import { task, types } from 'hardhat/config';

task('upgrade-bls', 'Upgrade contract through BLS Proxy')
    .addParam('blsproxy', 'BLS Proxy contract address', undefined, types.string)
    .addParam('newimpl', 'New implementation contract address', undefined, types.string)
    .addParam('nonce', 'Current nonce for the upgrade', undefined, types.string)
    .addParam('calldata', 'Upgrade calldata', undefined, types.string)
    .addParam('signerPubkeyX', 'Signer public key X', undefined, types.string)
    .addParam('signerPubkeyY', 'Signer public key Y', undefined, types.string)
    .addParam('apkX0', 'Aggregated public key G2 X0', undefined, types.string)
    .addParam('apkX1', 'Aggregated public key G2 X1', undefined, types.string)
    .addParam('apkY0', 'Aggregated public key G2 Y0', undefined, types.string)
    .addParam('apkY1', 'Aggregated public key G2 Y1', undefined, types.string)
    .addParam('sigmaX', 'Signature X', undefined, types.string)
    .addParam('sigmaY', 'Signature Y', undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers } = hre;
        let {
            blsproxy,
            newimpl,
            nonce,
            calldata,
            signerPubkeyX,
            signerPubkeyY,
            apkX0,
            apkX1,
            apkY0,
            apkY1,
            sigmaX,
            sigmaY,
        } = taskArgs;

        console.log(`Upgrading bridge via blsProxy ${blsproxy} to new implementation ${newimpl}`);

        const blsProxyContract = await ethers.getContractAt('BlsProxy', blsproxy);

        if (newimpl) {
            const iface = new ethers.Interface(['function upgradeTo(address newImplementation)']);
            calldata = iface.encodeFunctionData('upgradeTo', [newimpl]);
        }

        const upgradeSig = {
            signerPubkeys: [
                {
                    X: BigInt(signerPubkeyX),
                    Y: BigInt(signerPubkeyY),
                },
            ],
            apkG2: {
                X: [BigInt(apkX0), BigInt(apkX1)],
                Y: [BigInt(apkY0), BigInt(apkY1)],
            },
            sigma: {
                X: BigInt(sigmaX),
                Y: BigInt(sigmaY),
            },
        };

        try {
            const tx = await blsProxyContract.execute(calldata, nonce, upgradeSig);
            await tx.wait();
            console.log(`Upgrade successful.`);
        } catch (error) {
            console.error(`Upgrade failed: ${error}`);
        }
    });
