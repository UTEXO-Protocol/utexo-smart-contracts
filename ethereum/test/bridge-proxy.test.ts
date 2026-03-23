import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Bridge, BridgeContractProxyAdmin, TransparentProxy } from '../typechain-types';

describe('BridgeContractProxyAdmin', function () {
    let bridgeContractProxyAdmin: BridgeContractProxyAdmin;
    let transparentProxy: TransparentProxy;
    let bridgeImplementation: Bridge;

    beforeEach(async () => {
        // Deploy the initial implementation contract
        const BridgeImplementation = await ethers.getContractFactory('Bridge');
        bridgeImplementation = await BridgeImplementation.deploy();

        // Deploy the proxy, passing the implementation addressF
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        transparentProxy = await TransparentProxy.deploy(await bridgeImplementation.getAddress());

        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        bridgeContractProxyAdmin = await BridgeContractProxyAdmin.deploy();

        // Transfer proxy admin rights to BridgeContractProxyAdmin
        await transparentProxy.changeAdmin(await bridgeContractProxyAdmin.getAddress());
    });

    it('should deploy with the correct owner', async () => {
        const [owner] = await ethers.getSigners();
        expect(await bridgeContractProxyAdmin.owner()).to.equal(await owner.getAddress());
    });

    it('should get the proxy admin', async () => {
        const adminAddress = await bridgeContractProxyAdmin.getProxyAdmin(
            await transparentProxy.getAddress()
        );
        expect(adminAddress).to.equal(await bridgeContractProxyAdmin.getAddress());
    });

    it('should get the proxy implementation', async () => {
        const implementationAddress = await bridgeContractProxyAdmin.getProxyImplementation(
            await transparentProxy.getAddress()
        );
        expect(implementationAddress).to.equal(await bridgeImplementation.getAddress());
    });

    it('should change proxy admin', async () => {
        // Get the account that will become the new proxy admin
        const [newAdmin] = await ethers.getSigners();

        // Call the admin contract to change the proxy's admin to the new address
        await bridgeContractProxyAdmin.changeProxyAdmin(
            await transparentProxy.getAddress(),
            await newAdmin.getAddress()
        );

        // EIP-1967 specifies this fixed storage slot for the proxy admin address:
        // bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
        const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

        // Read the raw storage at the admin slot from the proxy contract
        const adminSlot = await ethers.provider.getStorage(
            await transparentProxy.getAddress(),
            ADMIN_SLOT
        );

        // Extract the last 20 bytes (40 hex characters) to get the actual address
        const admin = ethers.getAddress('0x' + adminSlot.slice(26));

        // Ensure the new admin was correctly set
        expect(await newAdmin.getAddress()).to.equal(admin);
    });

    it('should allow only the owner to upgrade the proxy', async () => {
        const [owner, notOwner] = await ethers.getSigners();

        // Deploy a new implementation contract
        const NewBridgeImplementation = await ethers.getContractFactory('Bridge');
        const newImplementation = await NewBridgeImplementation.deploy();

        await expect(
            bridgeContractProxyAdmin
                .connect(notOwner)
                .upgrade(await transparentProxy.getAddress(), await newImplementation.getAddress())
        ).to.be.revertedWith('not owner');

        await bridgeContractProxyAdmin.upgrade(
            await transparentProxy.getAddress(),
            await newImplementation.getAddress()
        );
        const implementationAddress = await bridgeContractProxyAdmin.getProxyImplementation(
            await transparentProxy.getAddress()
        );
        expect(implementationAddress).to.equal(await newImplementation.getAddress());
    });
});
