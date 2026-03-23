import { task, types } from 'hardhat/config';
import { ZERO_ADDRESS, getNetworkScanUrl } from './util';

task('deploy-fungible-token', 'Deploy a fungible token')
    .addParam('bridge', 'Address of the bridge contract', ZERO_ADDRESS, types.string)
    .addParam('name', 'Name of the token', undefined, types.string)
    .addOptionalParam('symbol', 'Symbol of the token', undefined, types.string)
    .addOptionalParam('initialsupply', 'Initial supply of the token', '0', types.string)
    .setAction(async (taskArgs, hre) => {
        const { ethers, run } = hre;
        const [deployer] = await ethers.getSigners();

        let { name, symbol, bridge, initialsupply } = taskArgs;

        try {
            ({ name, symbol } = transformTokenName(name, symbol));
        } catch (error) {
            console.error(error);
            return;
        }

        if (!ethers.isAddress(bridge))
            console.error('bridge token should be a valid address, instead: ', bridge);

        console.log(`Deploying token with name '${name}', symbol '${symbol}'...`);
        console.log(`The initial supply is '${initialsupply}'`);
        console.log('bridge contract: ', bridge);

        console.log('----------------------------------------------------');
        console.log(`Deployer account: ${deployer.address}`);
        console.log(
            'Deployer balance:',
            (await ethers.provider.getBalance(deployer.address)).toString()
        );

        const fungibleTokenContractFactory = await ethers.getContractFactory('FungibleToken');
        const fungibleToken = await fungibleTokenContractFactory.deploy(
            name,
            symbol,
            bridge,
            initialsupply
        );
        await fungibleToken.waitForDeployment();

        const fungibleTokenAddress = await fungibleToken.getAddress();
        console.log(`Fungible token deployed at address: ${fungibleTokenAddress}`);

        try {
            console.log('----------------------------------------------------');
            console.log('Starting verification process...');

            console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);

            await run('verify:verify', {
                address: fungibleTokenAddress,
                constructorArguments: [name, symbol, bridge, initialsupply],
            });
            console.log('----------------------------------------------------');
        } catch (error) {
            console.error('Verification failed:', error);
        }
    });

function transformTokenName(name: string, symbol: string) {
    if (name == undefined) throw new Error('Name of token must be specified.');

    if (symbol === undefined) symbol = 't' + name;
    name = 'Tricorn wrapped ' + name;

    return { name, symbol };
}
