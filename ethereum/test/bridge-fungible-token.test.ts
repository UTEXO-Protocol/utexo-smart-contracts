import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Wallet } from 'ethers';
import {
    Bridge,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
    TestToken,
    FungibleToken,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork, signMessage } from './util';

describe('Bridge FungibleToken test', function () {
    let bridgeContract: Bridge;
    let tokenContract: TestToken;
    let fungibleTokenContract: FungibleToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;
    let chainId: bigint;

    let systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('140');
    const testIncorrectCommission = ethers.parseEther('1000');
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    const TYPES_FOR_SIGNATURE_BRIDGE_IN = [
        'address',
        'address',
        'address',
        'uint256',
        'uint256',
        'string',
        'string',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
    ];

    const getAmountToReturnAndTotalCommission = () => {
        const totalCommission = testCommission;
        const amountToReturn = amountToTransfer - totalCommission;
        return [totalCommission, amountToReturn];
    };

    const bridgeInTokens = async (nonce: number, commission = testCommission) => {
        await tokenContract
            .connect(user1)
            .approve(await bridgeContract.getAddress(), amountToTransfer);

        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signatureBridgeIn = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN,
            [
                await user1.getAddress(),
                await bridgeContract.getAddress(),
                await tokenContract.getAddress(),
                amountToTransfer,
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

        return bridgeContract.connect(user1).fundsIn(
            {
                token: await tokenContract.getAddress(),
                amount: amountToTransfer,
                commission,
                destinationChain,
                destinationAddress,
                deadline,
                nonce,
                transactionId: bridgeInTransactionId,
            },
            signatureBridgeIn
        );
    };

    const bridgeInTokensBurn = async (nonce: number, commission = testCommission) => {
        await fungibleTokenContract
            .connect(user1)
            .approve(await bridgeContract.getAddress(), amountToTransfer);

        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signatureBridgeIn = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN,
            [
                user1.address,
                await bridgeContract.getAddress(),
                await fungibleTokenContract.getAddress(),
                amountToTransfer,
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

        return bridgeContract.connect(user1).fundsInBurn(
            {
                token: await fungibleTokenContract.getAddress(),
                amount: amountToTransfer,
                commission,
                destinationChain,
                destinationAddress,
                deadline,
                nonce,
                transactionId: bridgeInTransactionId,
            },
            signatureBridgeIn
        );
    };

    this.beforeAll(async () => {
        // @ts-ignore
        [owner, user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;
        const BridgeContract = await ethers.getContractFactory('Bridge');
        const TestTokenContract = await ethers.getContractFactory('TestToken');
        const FungibleTokenContract = await ethers.getContractFactory('FungibleToken');

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        await bridgeContractImplementation.waitForDeployment();
        tokenContract = (await TestTokenContract.deploy(initialSupply)) as TestToken;

        await tokenContract.transfer(await user1.getAddress(), amountToTransfer);

        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');
        const mockContractV1 = (await MockContractV1.deploy()) as MockContractV1;
        await mockContractV1.waitForDeployment();

        const bridgeContractProxyAdmin =
            (await BridgeContractProxyAdmin.deploy()) as BridgeContractProxyAdmin;
        await bridgeContractProxyAdmin.waitForDeployment();

        const transparentProxy = (await TransparentProxy.deploy(
            await mockContractV1.getAddress()
        )) as TransparentProxy;
        await transparentProxy.waitForDeployment();
        await transparentProxy.changeAdmin(bridgeContractProxyAdmin.getAddress());

        const upgradeTx = await bridgeContractProxyAdmin.upgrade(
            transparentProxy.getAddress(),
            await bridgeContractImplementation.getAddress()
        );
        await upgradeTx.wait(1);

        bridgeContract = await ethers.getContractAt('Bridge', await transparentProxy.getAddress());
        await bridgeContract.initialize(await systemWallet.getAddress());

        chainId = await bridgeContract.getChainId();
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());

        fungibleTokenContract = (await FungibleTokenContract.deploy(
            'A',
            'B',
            await bridgeContract.getAddress(),
            initialSupply
        )) as FungibleToken;
        await fungibleTokenContract.waitForDeployment();

        await fungibleTokenContract.transfer(await user1.getAddress(), amountToTransfer);
    });

    it('bridge fungibletoken should be deployed with correct values', async () => {
        expect(await fungibleTokenContract.balanceOf(await user1.getAddress())).to.equal(
            amountToTransfer
        );
    });

    it('should allow user to bridge tokens in - transfer', async () => {
        await expect(await bridgeInTokens(1112))
            .to.emit(bridgeContract, 'BridgeFundsIn')
            .withArgs(
                await user1.getAddress(),
                bridgeInTransactionId,
                1112,
                await tokenContract.getAddress(),
                amountToTransfer,
                testCommission,
                destinationChain,
                destinationAddress
            );
        // Tokens transferred and accounted to the Bridge contract
        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(0);
        expect(await tokenContract.balanceOf(await bridgeContract.getAddress())).to.equal(
            amountToTransfer
        );
    });

    it('should allow user to bridge tokens in - burn', async () => {
        await expect(bridgeInTokensBurn(111))
            .to.emit(bridgeContract, 'BridgeFundsInBurn')
            .withArgs(
                await user1.getAddress(),
                bridgeInTransactionId,
                111,
                await fungibleTokenContract.getAddress(),
                amountToTransfer,
                testCommission,
                destinationChain,
                destinationAddress
            );

        const [totalCommission, amountToReturn] = getAmountToReturnAndTotalCommission();

        // Tokens transferred and accounted to the Bridge contract
        expect(await fungibleTokenContract.balanceOf(await user1.getAddress())).to.equal(0);

        // Check that tokens burned
        expect(await fungibleTokenContract.balanceOf(await bridgeContract.getAddress())).to.equal(
            totalCommission
        );
    });

    it('owner bridge tokens out', async () => {
        // For fundsOut with TestToken:
        // Bridge has 1000 TestTokens, commission pool has 140 TestTokens
        // Available balance for withdrawal = 1000 - 140 = 860 TestTokens
        const userTransferAmount = ethers.parseEther('800'); // Amount user will receive
        const outboundCommission = ethers.parseEther('50'); // Commission for outbound transfer
        const totalAmount = userTransferAmount + outboundCommission; // Total debited from bridge = 850

        await expect(
            await bridgeContract.fundsOut(
                await tokenContract.getAddress(),
                await user1.getAddress(),
                totalAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        )
            .to.emit(bridgeContract, 'BridgeFundsOut')
            .withArgs(
                await user1.getAddress(),
                await tokenContract.getAddress(),
                totalAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(
            userTransferAmount
        );
    });

    it('owner bridge tokens out with 0 commission', async () => {
        // For fundsOut with TestToken:
        // Bridge has 200 TestTokens, commission pool has 190 TestTokens
        // Available balance for withdrawal = 200 - 190 = 10 TestTokens
        const userTransferAmount = ethers.parseEther('10'); // Amount user will receive
        const outboundCommission = ethers.parseEther('0'); // Commission for outbound transfer
        const totalAmount = userTransferAmount + outboundCommission; // Total debited from bridge = 10
        const userBalanceBefore = await tokenContract.balanceOf(await user1.getAddress()); // User balance 800 TestTokens

        await expect(
            await bridgeContract.fundsOut(
                await tokenContract.getAddress(),
                await user1.getAddress(),
                totalAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        )
            .to.emit(bridgeContract, 'BridgeFundsOut')
            .withArgs(
                await user1.getAddress(),
                await tokenContract.getAddress(),
                totalAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(
            userBalanceBefore + userTransferAmount
        );
    });

    it('owner bridge tokens out by mint', async () => {
        const userInitialBalance = await fungibleTokenContract.balanceOf(await user1.getAddress());
        const userReceiveAmount = ethers.parseEther('900'); // Amount user will receive
        const outboundCommission = ethers.parseEther('100'); // Commission for outbound transfer

        await expect(
            bridgeContract.fundsOutMint(
                await fungibleTokenContract.getAddress(),
                await user1.getAddress(),
                userReceiveAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        )
            .to.emit(bridgeContract, 'BridgeFundsOutMint')
            .withArgs(
                await user1.getAddress(),
                await fungibleTokenContract.getAddress(),
                userReceiveAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
        expect(await fungibleTokenContract.balanceOf(await user1.getAddress())).to.equal(
            userInitialBalance + userReceiveAmount - outboundCommission
        );
    });

    it('owner bridge tokens out by mint with 0 commission', async () => {
        const userInitialBalance = await fungibleTokenContract.balanceOf(await user1.getAddress());
        const userReceiveAmount = ethers.parseEther('900'); // Amount user will receive
        const outboundCommission = ethers.parseEther('0'); // Commission for outbound transfer

        await expect(
            bridgeContract.fundsOutMint(
                await fungibleTokenContract.getAddress(),
                await user1.getAddress(),
                userReceiveAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        )
            .to.emit(bridgeContract, 'BridgeFundsOutMint')
            .withArgs(
                await user1.getAddress(),
                await fungibleTokenContract.getAddress(),
                userReceiveAmount,
                outboundCommission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
        expect(await fungibleTokenContract.balanceOf(await user1.getAddress())).to.equal(
            userInitialBalance + userReceiveAmount - outboundCommission
        );
    });

    it('should return correct commission in pool', async () => {
        // Commission pool for TestToken should include:
        // 1. Initial commission from fundsIn: 140 ETH
        // 2. Outbound commission from fundsOut: 50 ETH
        // Total expected: 190 ETH
        const expectedCommissionPool = ethers.parseEther('190');
        const commissionInPool = await bridgeContract.getCommissionPoolAmount(
            await tokenContract.getAddress()
        );
        expect(commissionInPool).to.equal(expectedCommissionPool);
    });

    it('should withdraw commission', async () => {
        const initialCommissionCollectorBalance = await tokenContract.balanceOf(
            await commissionCollector.getAddress()
        );
        // Total commission pool for TestToken: 140 (inbound) + 50 (outbound) = 190 ETH
        const totalCommissionToWithdraw = ethers.parseEther('190');

        await expect(
            bridgeContract
                .connect(commissionCollector)
                .withdrawCommission(await tokenContract.getAddress(), totalCommissionToWithdraw)
        )
            .to.emit(bridgeContract, 'WithdrawCommission')
            .withArgs(await tokenContract.getAddress(), totalCommissionToWithdraw);
        expect(await tokenContract.balanceOf(await commissionCollector.getAddress())).to.equal(
            initialCommissionCollectorBalance + totalCommissionToWithdraw
        );
        // After withdrawal, commission pool should be empty
        expect(
            await bridgeContract.getCommissionPoolAmount(await tokenContract.getAddress())
        ).to.equal(0);
    });

    it('should not allow transaction if total commission greater than transferred amount', async () => {
        await expect(bridgeInTokens(1, testIncorrectCommission)).to.be.revertedWith(
            'CommissionGreaterThanAmount'
        );
        await expect(bridgeInTokensBurn(1, testIncorrectCommission)).to.be.revertedWith(
            'CommissionGreaterThanAmount'
        );
    });

    it('Owner can not bridge out more tokens than available in pool', async () => {
        // Get current bridge balance and commission pool
        const bridgeBalance = await tokenContract.balanceOf(await bridgeContract.getAddress());
        const commissionPool = await bridgeContract.getCommissionPoolAmount(
            await tokenContract.getAddress()
        );
        const availableBalance = bridgeBalance - commissionPool;

        // Try to withdraw more than available (availableBalance + 1)
        const excessiveAmount = availableBalance + 1n;
        const commission = ethers.parseEther('10');

        await expect(
            bridgeContract.fundsOut(
                await tokenContract.getAddress(),
                await user1.getAddress(),
                excessiveAmount,
                commission,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        ).to.be.revertedWith('AmountExceedBridgePool');
    });

    it('should pause/unpause contract', async () => {
        // pause
        await fungibleTokenContract.connect(owner).pause();
        expect(await fungibleTokenContract.paused()).to.equal(true);

        // unpause
        await fungibleTokenContract.connect(owner).unpause();
        expect(await fungibleTokenContract.paused()).to.equal(false);
    });

    it('should set commission collector address', async () => {
        const testAddress = '0x7e0f5A592322Bc973DDE62dF3f91604D21d37446';
        await bridgeContract.setCommissionCollector(testAddress);
        expect(await bridgeContract.getCommissionCollector()).to.equal(testAddress);
    });
});
