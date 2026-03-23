import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
    BlsProxy,
    Bridge,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
    TestToken,
    FungibleToken,
} from '../typechain-types';
import { Wallet } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork, signMessage } from './util';
import { Interface } from 'ethers';
import { getSig } from './helpers/signatures';

describe('BlsProxy', function () {
    let bridgeContract: Bridge;
    let bridgeContractProxyAdmin: BridgeContractProxyAdmin;
    let transparentProxy: TransparentProxy;
    let user1: SignerWithAddress;
    let tokenContract: TestToken;
    let fungibleTokenContract: FungibleToken;
    let commissionCollector: SignerWithAddress;
    let proxy: BlsProxy;
    const validNonce = 0;
    let chainId: bigint;

    const systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const commission = ethers.parseEther('100');
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4bridgeContractzAPRds5PQUG1dyqLLvib2xu';
    const testAddress = '0x1234567890123456789012345678901234567890';

    // Types used for message signing in the `bridgeInNative` function
    const TYPES_FOR_SIGNATURE_BRIDGE_IN_NATIVE = [
        'address',
        'address',
        'uint256',
        'string',
        'string',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
    ];

    beforeEach(async () => {
        const sig = getSig('setAggPubKey');
        [user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;

        // Get contracts factories
        const BridgeContract = await ethers.getContractFactory('Bridge');
        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');

        const TestTokenContract = await ethers.getContractFactory('TestToken');
        const FungibleTokenContract = await ethers.getContractFactory('FungibleToken');

        // Deploy contracts
        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        const mockContractV1 = (await MockContractV1.deploy()) as MockContractV1;
        bridgeContractProxyAdmin =
            (await BridgeContractProxyAdmin.deploy()) as BridgeContractProxyAdmin;
        transparentProxy = (await TransparentProxy.deploy(
            await mockContractV1.getAddress()
        )) as TransparentProxy;

        await transparentProxy.changeAdmin(await bridgeContractProxyAdmin.getAddress());
        // Update TransparentProxy by specifying a new implementation - a deployed Bridge contract
        const upgradeTx = await bridgeContractProxyAdmin.upgrade(
            await transparentProxy.getAddress(),
            await bridgeContractImplementation.getAddress()
        );
        await upgradeTx.wait(1); // Waiting for confirmation of the update transaction

        bridgeContract = await ethers.getContractAt('Bridge', await transparentProxy.getAddress());
        await bridgeContract.initialize(await systemWallet.getAddress());

        chainId = await bridgeContract.getChainId();
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());

        const ProxyFactory = await ethers.getContractFactory('BlsProxy');
        proxy = await ProxyFactory.deploy(await transparentProxy.getAddress(), [
            sig.apkG2.X,
            sig.apkG2.Y,
        ]);
        await proxy.waitForDeployment();

        await bridgeContract.transferOwnership(await proxy.getAddress());

        await bridgeInNative(validNonce);

        tokenContract = (await TestTokenContract.deploy(initialSupply)) as TestToken;

        fungibleTokenContract = (await FungibleTokenContract.deploy(
            'A',
            'B',
            await bridgeContract.getAddress(),
            initialSupply
        )) as FungibleToken;
        await fungibleTokenContract.waitForDeployment();

        await fungibleTokenContract.transfer(await bridgeContract.getAddress(), amountToTransfer);

        const [defaultSigner] = await ethers.getSigners();
        await network.provider.send('hardhat_setBalance', [
            await defaultSigner.getAddress(),
            '0x10000000000000000000000000000000',
        ]);
    });

    // Helper function to calculate the total commission and the amount to return after commission is deducted
    async function getAmountToReturnAndTotalCommission() {
        const totalCommission = commission;
        const amountToReturn = amountToTransfer - totalCommission;

        return [totalCommission, amountToReturn];
    }

    // Function to simulate a user bridging in native currency!
    async function bridgeInNative(nonce: number, gasCommission = commission) {
        const deadline = (await getCurrentTimeFromNetwork()) + 84_000; // Set deadline for the transaction
        const signatureBridgeInNative = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_NATIVE,
            [
                await user1.getAddress(),
                await bridgeContract.getAddress(),
                gasCommission,
                destinationChain,
                destinationAddress,
                deadline,
                nonce,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        // Call the `fundsInNative` function on the `Bridge` contract
        return bridgeContract.connect(user1).fundsInNative(
            {
                commission,
                destinationChain,
                destinationAddress,
                deadline,
                nonce,
                transactionId: bridgeInTransactionId,
            },
            signatureBridgeInNative,
            { value: amountToTransfer } // Transfer value sent with the transaction
        );
    }

    it('should set new pubKey', async () => {
        const sig = getSig('setAggPubKey');

        // new agg pub key
        const apkG2 = {
            X: [
                BigInt(
                    '7467927233405390927031423874841495767425584200869291752941010754945638990873'
                ),
                BigInt(
                    '14579283613228967050537423180568717098657107541179853455888422208039060985996'
                ),
            ],
            Y: [
                BigInt(
                    '21434257586298280837001853951579489501349966382492018881269723711802678458545'
                ),
                BigInt(
                    '7517314995537951355857044278128810357386990072842632986187853153586953568824'
                ),
            ],
        };

        await proxy.setAggPubKey(apkG2, validNonce, sig);
    });

    it('should set new bridge address with valid BLS signature', async () => {
        const sig = getSig('setBridge');

        // Call the contract method
        const tx = await proxy.setBridgeAddress(testAddress, validNonce, sig);
        await tx.wait();

        // Check new bridge value
        const updatedBridge = await proxy.bridge();
        expect(updatedBridge).to.equal(testAddress);
    });

    it('owner(blsProxy) should can fundsOutNative', async () => {
        const sig = getSig('fundsOutNative');

        const [, amountToReturn] = await getAmountToReturnAndTotalCommission();

        const bridgeIface = new Interface([
            'function fundsOutNative(address payable recipient, uint256 amount, uint256 commission, uint256 transactionId, string sourceChain, string sourceAddress) external',
        ]);

        const callData = bridgeIface.encodeFunctionData('fundsOutNative', [
            await user1.getAddress(),
            amountToReturn,
            commission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(proxy.execute(callData, validNonce, sig))
            .to.emit(bridgeContract, 'BridgeFundsOutNative')
            .withArgs(
                await user1.getAddress(),
                amountToReturn,
                commission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );

        const contractBalanceAfterCoinOut = amountToTransfer - amountToReturn;
        expect(await bridgeContract.getContractBalance()).to.equal(
            contractBalanceAfterCoinOut + commission
        );
    });

    it('should revert if aggregated pub key does not match stored key', async () => {
        const sig = getSig('fundsOutNative');

        const [, amountToReturn] = await getAmountToReturnAndTotalCommission();

        const bridgeIface = new Interface([
            'function fundsOutNative(address payable recipient, uint256 amount, uint256 transactionId, string sourceChain, string sourceAddress) external',
        ]);

        const callData = bridgeIface.encodeFunctionData('fundsOutNative', [
            await user1.getAddress(),
            amountToReturn,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        // Clone signature and tamper with apkG2 to make it invalid
        const tamperedSig = structuredClone(sig);
        tamperedSig.apkG2.X = [
            BigInt('0'), // invalid X[0]
            sig.apkG2.X[1], // keep X[1] unchanged
        ];

        // Expect transaction to revert with specific error message
        await expect(proxy.execute(callData, validNonce, tamperedSig)).to.be.revertedWith(
            'Invalid aggregated pubkey'
        );
    });

    it('should set circle contract address', async () => {
        const sig = getSig('setCircleContract');

        const bridgeIface = new Interface(['function setCircleContract(address) external']);
        const callData = bridgeIface.encodeFunctionData('setCircleContract', [testAddress]);

        const tx = await proxy.execute(callData, validNonce, sig);
        await tx.wait();

        expect(await bridgeContract.getCircleContract()).to.equal(testAddress);
    });

    it('should set comission collector address', async () => {
        const sig = getSig('setComissionCollector');

        const bridgeIface = new Interface(['function setCommissionCollector(address) external']);
        const callData = bridgeIface.encodeFunctionData('setCommissionCollector', [testAddress]);

        const tx = await proxy.execute(callData, validNonce, sig);
        await tx.wait();

        expect(await bridgeContract.getCommissionCollector()).to.equal(testAddress);
    });

    it('should pause and unpause the contract', async () => {
        let sig = getSig('pause');

        const bridgeIface = new Interface([
            'function pause() external',
            'function unpause() external',
        ]);

        // Pause the contract
        const pauseCallData = bridgeIface.encodeFunctionData('pause');
        const pauseTx = await proxy.execute(pauseCallData, validNonce, sig);
        await pauseTx.wait();
        expect(await bridgeContract.paused()).to.equal(true);

        sig = getSig('unpause');

        // Unpause the contract
        const unpauseCallData = bridgeIface.encodeFunctionData('unpause');
        const unpauseTx = await proxy.execute(unpauseCallData, validNonce, sig);
        await unpauseTx.wait();
        expect(await bridgeContract.paused()).to.equal(false);
    });

    it('should transfer ownership to a new address', async () => {
        const sig = getSig('transferOwnership');
        const newOwner = '0x1234567890123456789012345678901234567890';
        const oldOwner = await bridgeContract.owner();

        const bridgeIface = new Interface(['function transferOwnership(address) external']);
        const callData = bridgeIface.encodeFunctionData('transferOwnership', [newOwner]);

        await expect(proxy.execute(callData, validNonce, sig))
            .to.emit(bridgeContract, 'OwnershipTransferred')
            .withArgs(oldOwner, newOwner);

        expect(await bridgeContract.owner()).to.equal(newOwner);
    });

    it('should fundsOut token', async () => {
        const sig = getSig('fundsOut');

        const [, amountToReturn] = await getAmountToReturnAndTotalCommission();

        const bridgeIface = new Interface([
            'function fundsOut(address token, address recipient, uint256 amount, uint256 commission,uint256 transactionId, string calldata sourceChain, string calldata sourceAddress)',
        ]);

        const callData = bridgeIface.encodeFunctionData('fundsOut', [
            await fungibleTokenContract.getAddress(),
            await user1.getAddress(),
            amountToReturn,
            commission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(proxy.execute(callData, validNonce, sig))
            .to.emit(bridgeContract, 'BridgeFundsOut')
            .withArgs(
                await user1.getAddress(),
                await fungibleTokenContract.getAddress(),
                amountToReturn,
                commission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
    });

    it('should change proxyAdmin address to blsProxy', async () => {
        // Call the admin contract to change the proxy's admin to the new address
        await bridgeContractProxyAdmin.changeProxyAdmin(
            await transparentProxy.getAddress(),
            await proxy.getAddress()
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
        expect(await proxy.getAddress()).to.equal(admin);

        // Ensure that only the admin can change the proxy admin, expect a `NotAdmin` error if called by a non-admin.
        await expect(
            bridgeContractProxyAdmin.changeProxyAdmin(
                await transparentProxy.getAddress(),
                testAddress
            )
        ).to.be.revertedWithCustomError(transparentProxy, 'NotAdmin');
    });

    it('should upgrade the implementation via blsProxy', async () => {
        const sig = getSig('upgrade');

        // Deploy a new implementation contract
        const NewBridge = await ethers.getContractFactory('Bridge');
        const newImplementation = await NewBridge.deploy();

        // Transfer proxy ownership to the blsProxy contract (proxy.getAddress())
        await bridgeContractProxyAdmin.changeProxyAdmin(
            await transparentProxy.getAddress(),
            await proxy.getAddress()
        );

        // Preparing calldata for calling upgradeTo(newImplementation) on TransparentProxy
        const iface = new ethers.Interface(['function upgradeTo(address newImplementation)']);
        const callData = iface.encodeFunctionData('upgradeTo', [
            await newImplementation.getAddress(),
        ]);

        // Upgrade via blsProxy
        const tx = await proxy.execute(callData, validNonce, sig);
        await tx.wait();

        // Check that the implementation has been updated
        const IMPLEMENTATION_SLOT =
            '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
        const raw = await ethers.provider.getStorage(
            await transparentProxy.getAddress(),
            IMPLEMENTATION_SLOT
        );
        const impl = ethers.getAddress('0x' + raw.slice(26));

        expect(impl).to.equal(await newImplementation.getAddress());
    });

    it('should revert fundsOutNative with invalid signature & invalid nonce', async () => {
        let sig = getSig('invalid');

        const [, amountToReturn] = await getAmountToReturnAndTotalCommission();

        const bridgeIface = new Interface([
            'function fundsOutNative(address payable recipient, uint256 amount, uint256 commission,uint256 transactionId, string sourceChain, string sourceAddress) external',
        ]);

        const callData = bridgeIface.encodeFunctionData('fundsOutNative', [
            await user1.getAddress(),
            amountToReturn,
            commission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(proxy.execute(callData, validNonce, sig)).to.be.revertedWith(
            'Invalid BLS signature'
        );

        sig = getSig('fundsOutNative');

        const tx = await proxy.execute(callData, validNonce, sig);
        await tx.wait();

        await expect(proxy.execute(callData, validNonce, sig)).to.be.revertedWith('Invalid nonce');
    });

    it('should revert if withdrawCommission is called by an invalid commissionCollector address', async () => {
        let sig = getSig('withdrawCommission');

        const bridgeIface = new Interface([
            'function withdrawCommission(address token, uint256 amount) external',
        ]);

        const callData = bridgeIface.encodeFunctionData('withdrawCommission', [
            testAddress,
            100000,
        ]);

        await expect(proxy.execute(callData, validNonce, sig)).to.be.revertedWith(
            'InvalidCommissionCollectorAddress'
        );
    });

    it('should revert pause with invalid sig & invalid nonce', async () => {
        let sig = getSig('pause');

        const bridgeIface = new Interface([
            'function pause() external',
            'function unpause() external',
        ]);

        const invalidNonce = 666;

        // Pause the contract
        const pauseCallData = bridgeIface.encodeFunctionData('pause');

        await expect(proxy.execute(pauseCallData, invalidNonce, sig)).to.be.revertedWith(
            'Invalid nonce'
        );

        sig = getSig('invalid');

        await expect(proxy.execute(pauseCallData, validNonce, sig)).to.be.revertedWith(
            'Invalid BLS signature'
        );
    });

    it('should fundsOutMint', async () => {
        const sig = getSig('fundsOutMint');

        const userInitialBalance = await fungibleTokenContract.balanceOf(await user1.getAddress());
        const [, amountToReturn] = await getAmountToReturnAndTotalCommission();

        const bridgeIface = new Interface([
            'function fundsOutMint(address,address,uint256,uint256,uint256,string,string)',
        ]);

        const callData = bridgeIface.encodeFunctionData('fundsOutMint', [
            await fungibleTokenContract.getAddress(),
            await user1.getAddress(),
            amountToReturn,
            commission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(proxy.execute(callData, validNonce, sig))
            .to.emit(bridgeContract, 'BridgeFundsOutMint')
            .withArgs(
                await user1.getAddress(),
                await fungibleTokenContract.getAddress(),
                amountToReturn,
                commission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
    });

    it('should revert fundsOutMint if signature is incorrect', async () => {
        const sig = getSig('invalid');

        const [, amountToReturn] = await getAmountToReturnAndTotalCommission();

        const bridgeIface = new Interface([
            'function fundsOutMint(address,address,uint256,uint256,uint256,string,string)',
        ]);

        const callData = bridgeIface.encodeFunctionData('fundsOutMint', [
            await fungibleTokenContract.getAddress(),
            await user1.getAddress(),
            amountToReturn,
            0n, // commission
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(proxy.execute(callData, validNonce, sig)).to.be.revertedWith(
            'Invalid BLS signature'
        );
    });
});
