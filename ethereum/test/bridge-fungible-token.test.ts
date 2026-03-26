import { ethers } from 'hardhat';
import { expect } from 'chai';
import { HDNodeWallet, Interface, TypedDataDomain } from 'ethers';
import {
    Bridge,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
    TestToken,
    FungibleToken,
    MultisigProxy,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork } from './util';
import { signFundsIn } from './helpers/bridge-setup';
import { buildBitmapAndSignatures, BridgeOperationTypes } from './helpers/multisig-helpers';

describe('Bridge FungibleToken test', function () {
    let bridgeContract: Bridge;
    let multisigProxy: MultisigProxy;
    let tokenContract: TestToken;
    let fungibleTokenContract: FungibleToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let commissionCollectorWallet: SignerWithAddress;
    let chainId: bigint;
    let domain: TypedDataDomain;
    let multisigAddress: string;

    let teeSigner: HDNodeWallet = ethers.Wallet.createRandom() as HDNodeWallet;

    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('140');
    const testIncorrectCommission = ethers.parseEther('1000');
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;

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
        const signature = await signFundsIn(teeSigner, domain, {
            sender: await user1.getAddress(),
            token: await tokenContract.getAddress(),
            amount: amountToTransfer,
            commission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

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
            signature,
            0
        );
    };

    const bridgeInTokensBurn = async (nonce: number, commission = testCommission) => {
        await fungibleTokenContract
            .connect(user1)
            .approve(await bridgeContract.getAddress(), amountToTransfer);

        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signature = await signFundsIn(teeSigner, domain, {
            sender: await user1.getAddress(),
            token: await fungibleTokenContract.getAddress(),
            amount: amountToTransfer,
            commission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

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
            signature,
            0
        );
    };

    const executeViaTee = async (callData: string) => {
        const selector = callData.slice(0, 10) as `0x${string}`;
        const nonce = await multisigProxy.getNonce(selector as any);
        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const { bitmap, signatures } = await buildBitmapAndSignatures(
            [teeSigner],
            [0],
            domain,
            BridgeOperationTypes,
            { selector, callData, nonce, deadline }
        );
        return multisigProxy.execute(callData, nonce, deadline, bitmap, signatures);
    };

    this.beforeAll(async () => {
        // @ts-ignore
        [owner, user1, commissionCollectorWallet] = (await ethers.getSigners()) as SignerWithAddress[];

        const BridgeContract = await ethers.getContractFactory('Bridge');
        const TestTokenContract = await ethers.getContractFactory('TestToken');
        const FungibleTokenContract = await ethers.getContractFactory('FungibleToken');

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        await bridgeContractImplementation.waitForDeployment();
        tokenContract = (await TestTokenContract.deploy(initialSupply)) as TestToken;

        await tokenContract.transfer(await user1.getAddress(), amountToTransfer);

        const BridgeContractProxyAdmin = await ethers.getContractFactory('BridgeContractProxyAdmin');
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
        // initialize() takes no arguments
        await bridgeContract.initialize(ethers.ZeroAddress);

        chainId = await bridgeContract.getChainId();

        // Deploy MultisigProxy with teeSigner as enclave signer, owner as federation signer
        // timelockDuration = 0 so proposals can be executed immediately in tests
        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisigProxy = (await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            [teeSigner.address],
            1,
            [owner.address],
            1,
            await commissionCollectorWallet.getAddress(),
            0
        )) as MultisigProxy;
        await multisigProxy.waitForDeployment();
        multisigAddress = await multisigProxy.getAddress();

        domain = {
            name: 'MultisigProxy',
            version: '1',
            chainId,
            verifyingContract: multisigAddress,
        };

        // Set commissionCollector on Bridge to MultisigProxy BEFORE transferring ownership
        await bridgeContract.setCommissionCollector(multisigAddress);

        // Transfer Bridge ownership to MultisigProxy
        await bridgeContract.transferOwnership(multisigAddress);

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

        const [totalCommission] = getAmountToReturnAndTotalCommission();

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

        const bridgeIface = new Interface([
            'function fundsOut(address,address,uint256,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            await user1.getAddress(),
            totalAmount,
            outboundCommission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(await executeViaTee(callData))
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

        const bridgeIface = new Interface([
            'function fundsOut(address,address,uint256,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            await user1.getAddress(),
            totalAmount,
            outboundCommission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(await executeViaTee(callData))
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

        const bridgeIface = new Interface([
            'function fundsOutMint(address,address,uint256,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOutMint', [
            await fungibleTokenContract.getAddress(),
            await user1.getAddress(),
            userReceiveAmount,
            outboundCommission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(executeViaTee(callData))
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

        const bridgeIface = new Interface([
            'function fundsOutMint(address,address,uint256,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOutMint', [
            await fungibleTokenContract.getAddress(),
            await user1.getAddress(),
            userReceiveAmount,
            outboundCommission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(executeViaTee(callData))
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
        const commissionRecipientAddress = await commissionCollectorWallet.getAddress();
        const initialBalance = await tokenContract.balanceOf(commissionRecipientAddress);
        // Total commission pool for TestToken: 140 (inbound) + 50 (outbound) = 190 ETH
        const totalCommissionToWithdraw = ethers.parseEther('190');

        // withdrawCommission is called by commissionCollector (MultisigProxy) via Bridge.
        // MultisigProxy.commissionRecipient is set to commissionCollectorWallet.
        // Use the WithdrawCommission proposal flow (timelockDuration = 0, so execute immediately).
        const ProposeWithdrawCommissionTypes = {
            ProposeWithdrawCommission: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
            ],
        };

        const proposeNonce = await multisigProxy.proposalNonce();
        const proposeDeadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const tokenAddress = await tokenContract.getAddress();

        const { bitmap: fedBitmap, signatures: fedSigs } = await buildBitmapAndSignatures(
            // owner is the federation signer (index 0)
            [owner as any],
            [0],
            domain,
            ProposeWithdrawCommissionTypes,
            {
                token: tokenAddress,
                amount: totalCommissionToWithdraw,
                nonce: proposeNonce,
                deadline: proposeDeadline,
            }
        );

        const proposalId = await multisigProxy
            .connect(owner)
            .proposeWithdrawCommission.staticCall(
                tokenAddress,
                totalCommissionToWithdraw,
                proposeNonce,
                proposeDeadline,
                fedBitmap,
                fedSigs
            );

        await multisigProxy
            .connect(owner)
            .proposeWithdrawCommission(
                tokenAddress,
                totalCommissionToWithdraw,
                proposeNonce,
                proposeDeadline,
                fedBitmap,
                fedSigs
            );

        // timelockDuration = 0, execute immediately
        const opData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256'],
            [tokenAddress, totalCommissionToWithdraw]
        );

        await expect(multisigProxy.executeProposal(proposalId, opData))
            .to.emit(bridgeContract, 'WithdrawCommission')
            .withArgs(tokenAddress, totalCommissionToWithdraw, commissionRecipientAddress);

        expect(await tokenContract.balanceOf(commissionRecipientAddress)).to.equal(
            initialBalance + totalCommissionToWithdraw
        );
        // After withdrawal, commission pool should be empty
        expect(
            await bridgeContract.getCommissionPoolAmount(tokenAddress)
        ).to.equal(0);
    });

    it('should not allow transaction if total commission greater than transferred amount', async () => {
        await expect(bridgeInTokens(1, testIncorrectCommission)).to.be.revertedWithCustomError(
            bridgeContract, 'CommissionGreaterThanAmount'
        );
        await expect(bridgeInTokensBurn(1, testIncorrectCommission)).to.be.revertedWithCustomError(
            bridgeContract, 'CommissionGreaterThanAmount'
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

        const bridgeIface = new Interface([
            'function fundsOut(address,address,uint256,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            await user1.getAddress(),
            excessiveAmount,
            commission,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(executeViaTee(callData)).to.be.revertedWithCustomError(bridgeContract, 'AmountExceedBridgePool');
    });

    it('should pause/unpause contract', async () => {
        // pause
        await fungibleTokenContract.connect(owner).pause();
        expect(await fungibleTokenContract.paused()).to.equal(true);

        // unpause
        await fungibleTokenContract.connect(owner).unpause();
        expect(await fungibleTokenContract.paused()).to.equal(false);
    });
});
