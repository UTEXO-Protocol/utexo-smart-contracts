import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Wallet } from 'ethers';
import {
    Bridge,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork, signMessage } from './util';

describe('Bridge Native Coin test', function () {
    let bridgeContract: Bridge;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;
    let chainId: bigint;

    // System wallet used for signing messages
    const systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('140');
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4bridgeContractzAPRds5PQUG1dyqLLvib2xu';

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

    // Function to simulate a user bridging in native currency!
    async function bridgeInNative(nonce: number, commission = testCommission) {
        const deadline = (await getCurrentTimeFromNetwork()) + 84_000; // Set deadline for the transaction
        const signatureBridgeInNative = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_NATIVE,
            [
                await user1.getAddress(),
                await bridgeContract.getAddress(),
                commission,
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

    // Helper function to calculate the total commission and the amount to return after commission is deducted
    function getAmountToReturnAndTotalCommission() {
        const totalCommission = testCommission;
        const amountToReturn = amountToTransfer - totalCommission;

        return [totalCommission, amountToReturn];
    }

    // Setup before running tests
    this.beforeAll(async () => {
        // @ts-ignore
        // Get signers
        [user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;

        // Get contracts factories
        const BridgeContract = await ethers.getContractFactory('Bridge');
        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');

        // Deploy contracts
        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        const mockContractV1 = (await MockContractV1.deploy()) as MockContractV1;
        const bridgeContractProxyAdmin =
            (await BridgeContractProxyAdmin.deploy()) as BridgeContractProxyAdmin;
        const transparentProxy = (await TransparentProxy.deploy(
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
    });

    it('bridge contract should be deployed with correct values', async () => {
        expect(await bridgeContract.getCommissionCollector()).to.equal(
            await commissionCollector.getAddress()
        );
        expect(await bridgeContract.getChainId()).to.equal(chainId);
    });

    it('should allow user to bridge coin in - transfer', async () => {
        await expect(bridgeInNative(1))
            .to.emit(bridgeContract, 'BridgeFundsInNative')
            .withArgs(
                await user1.getAddress(),
                bridgeInTransactionId,
                1,
                amountToTransfer,
                testCommission,
                destinationChain,
                destinationAddress
            );

        // Ensure the contract balance reflects the amount transferred
        expect(parseInt(ethers.formatEther(await bridgeContract.getContractBalance()))).to.equal(
            1000
        );
    });

    it('owner should can bridge coin in and out', async () => {
        const [totalCommission, amountToReturn] = getAmountToReturnAndTotalCommission();
        const outboundCommission = ethers.parseEther('50'); // Commission for outbound transfer
        const userReceiveAmount = amountToReturn - outboundCommission; // Amount user actually receives
        const totalAmountOut = userReceiveAmount + outboundCommission; // Total amount processed

        await expect(
            bridgeContract.fundsOutNative(
                await user1.getAddress(),
                totalAmountOut,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        )
            .to.emit(bridgeContract, 'BridgeFundsOutNative')
            .withArgs(
                await user1.getAddress(),
                totalAmountOut,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );

        const contractBalanceAfterCoinOut = amountToTransfer - userReceiveAmount;

        expect(await bridgeContract.getContractBalance()).to.equal(contractBalanceAfterCoinOut);
    });

    it('withdraw coin commission', async () => {
        // Native commission should include:
        // 1. Inbound commission from fundsInNative: 140 ETH
        // 2. Outbound commission from fundsOutNative: 50 ETH
        // Total: 190 ETH
        const actualCommission = await bridgeContract.getNativeCommission();

        // The actual commission should be 190 ETH (140 inbound + 50 outbound)
        expect(actualCommission).to.equal(ethers.parseEther('190'));

        await expect(
            bridgeContract.connect(commissionCollector).withdrawNativeCommission(actualCommission)
        )
            .to.emit(bridgeContract, 'WithdrawNativeCommission')
            .withArgs(actualCommission);

        // Ensure that the commission balance is reset to 0 after the withdrawal
        const commission2 = await bridgeContract.getNativeCommission();
        expect(commission2).to.equal(0);
    });

    it('bridgeInNative with 0 commission', async () => {
        await expect(bridgeInNative(2, 0n))
            .to.emit(bridgeContract, 'BridgeFundsInNative')
            .withArgs(
                await user1.getAddress(),
                bridgeInTransactionId,
                2,
                amountToTransfer,
                0n,
                destinationChain,
                destinationAddress
            );

        // Ensure the contract balance reflects the amount transferred
        expect(parseInt(ethers.formatEther(await bridgeContract.getContractBalance()))).to.equal(
            1000
        );
        expect(await bridgeContract.getNativeCommission()).to.equal(0);
    });

    it('bridgeOutNative with 0 commission', async () => {
        const outboundCommission = ethers.parseEther('0'); // Commission for outbound transfer

        await expect(
            bridgeContract.fundsOutNative(
                await user1.getAddress(),
                amountToTransfer,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        )
            .to.emit(bridgeContract, 'BridgeFundsOutNative')
            .withArgs(
                await user1.getAddress(),
                amountToTransfer,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );

        expect(await bridgeContract.getContractBalance()).to.equal(0n);
        expect(await bridgeContract.getNativeCommission()).to.equal(0);
    });
});
