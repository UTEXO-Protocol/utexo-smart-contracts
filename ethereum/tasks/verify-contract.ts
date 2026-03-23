import { task } from 'hardhat/config';
// import '@nomiclabs/hardhat-etherscan';

task('verify-contract', 'Verifies a contract on Etherscan')
    .addParam('address', 'The deployed contract address')
    .addOptionalVariadicPositionalParam('constructorArgs', 'Constructor arguments')
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;

        const { address, constructorArgs } = taskArgs;

        try {
            console.log('------------------------------------------------------------');
            console.log('Starting verification process...');

            console.log(`Network:\t`, (await ethers.provider.getNetwork()).name);
            console.log(`Chain ID:\t`, (await ethers.provider.getNetwork()).chainId);
            console.log('Address:\t', address);
            console.log('Arguments:\t', constructorArgs);

            if (constructorArgs === undefined) {
                await run('verify:verify', {
                    address: address,
                    constructorArguments: [],
                });
            } else {
                await run('verify:verify', {
                    address: address,
                    constructorArguments: constructorArgs,
                });
            }

            console.log('Contract verified successfully!');
            console.log('------------------------------------------------------------');
        } catch (error) {
            console.error('Error during verification:', error);
        }
    });
