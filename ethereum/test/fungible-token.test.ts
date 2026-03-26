import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
    Bridge,
    FungibleToken,
    BridgeContractProxyAdmin,
    TransparentProxy,
    MockContractV1,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('FungibleToken contract', function () {
    let bridgeContract: Bridge;
    let fungibleTokenContract: FungibleToken;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');

    this.beforeAll(async () => {
        // @ts-ignore
        [owner, user1, user2] = (await ethers.getSigners()) as SignerWithAddress;
        const BridgeContract = await ethers.getContractFactory('Bridge');
        const FungibleTokenContract = await ethers.getContractFactory('FungibleToken');

        // Deploy the Bridge contract implementation using a proxy pattern
        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');
        const mockContractV1 = (await MockContractV1.deploy()) as MockContractV1;

        const bridgeContractProxyAdmin =
            (await BridgeContractProxyAdmin.deploy()) as BridgeContractProxyAdmin;
        const transparentProxy = (await TransparentProxy.deploy(
            await mockContractV1.getAddress()
        )) as TransparentProxy;

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;

        // Set up the proxy and upgrade it to the Bridge implementation
        await transparentProxy.changeAdmin(await bridgeContractProxyAdmin.getAddress());
        const upgradeTx = await bridgeContractProxyAdmin.upgrade(
            await transparentProxy.getAddress(),
            await bridgeContractImplementation.getAddress()
        );
        await upgradeTx.wait(1);

        bridgeContract = await ethers.getContractAt('Bridge', await transparentProxy.getAddress());
        await bridgeContract.initialize(ethers.ZeroAddress);

        // Deploy the FungibleToken contract and transfer some tokens to user1
        fungibleTokenContract = (await FungibleTokenContract.deploy(
            'A',
            'B',
            await bridgeContract.getAddress(),
            initialSupply
        )) as FungibleToken;
        await fungibleTokenContract.transfer(await user1.getAddress(), amountToTransfer);
    });

    it('bridge fungibleToken should be deployed with correct values', async () => {
        expect(await fungibleTokenContract.balanceOf(await user1.getAddress())).to.equal(
            amountToTransfer
        );
        expect(await fungibleTokenContract.decimals()).to.equal(18);
    });

    it('should not mint fungible token for unauthorized user', async () => {
        const bridgeRole = ethers.keccak256(ethers.toUtf8Bytes('BRIDGE_ROLE'));
        const BRIDGE_ROLE = await fungibleTokenContract.hasRole(
            bridgeRole,
            await bridgeContract.getAddress()
        );
        expect(BRIDGE_ROLE).to.equal(true);

        // Try to give and revoke minting role from the bridge and user1
        await fungibleTokenContract.revokeRole(bridgeRole, await bridgeContract.getAddress());
        await fungibleTokenContract.grantRole(bridgeRole, await user1.getAddress());
        const BRIDGE_ROLE2 = await fungibleTokenContract.hasRole(
            bridgeRole,
            await user1.getAddress()
        );
        expect(BRIDGE_ROLE2).to.equal(true);

        await fungibleTokenContract.revokeRole(bridgeRole, await user1.getAddress());
        await fungibleTokenContract.grantRole(bridgeRole, await bridgeContract.getAddress());
        const BRIDGE_ROLE3 = await fungibleTokenContract.hasRole(
            bridgeRole,
            await bridgeContract.getAddress()
        );
        expect(BRIDGE_ROLE3).to.equal(true);

        // Try to mint tokens as an unauthorized user (user2) and expect it to revert
        await expect(
            fungibleTokenContract.connect(user2).mint(await user1.getAddress(), 1)
        ).to.be.revertedWith('Caller is not authorized');

        // Check and change the bridge contract address
        const bridgeContractGet = await fungibleTokenContract.getBridgeContract();
        expect(bridgeContractGet).to.equal(await bridgeContract.getAddress());
        await fungibleTokenContract.setBridgeContract(await user2.getAddress());
        const bridgeContractGet2 = await fungibleTokenContract.getBridgeContract();
        expect(bridgeContractGet2).to.equal(await user2.getAddress());
    });
});
