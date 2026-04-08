import { ethers } from 'hardhat';
import { expect } from 'chai';
import { HDNodeWallet, Interface, TypedDataDomain } from 'ethers';
import { Bridge, TestToken, MultisigProxy } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork } from './util';
import { signFundsIn } from './helpers/bridge-setup';
import { buildBitmapAndSignatures, BridgeOperationTypes } from './helpers/multisig-helpers';

describe('Bridge FungibleToken test', function () {
    let bridgeContract: Bridge;
    let multisigProxy: MultisigProxy;
    let tokenContract: TestToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let chainId: bigint;
    let domain: TypedDataDomain;
    let multisigAddress: string;

    let teeSigner: HDNodeWallet = ethers.Wallet.createRandom() as HDNodeWallet;

    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const destinationChain = 'rgb';
    const destinationAddress = 'rgb:asset1qp0y3mq6h5k8d9f2e4j7n6c3w/utxo1abc123';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;

    const bridgeInTokens = async (nonce: number) => {
        await tokenContract
            .connect(user1)
            .approve(await bridgeContract.getAddress(), amountToTransfer);

        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signature = await signFundsIn(teeSigner, domain, {
            sender: await user1.getAddress(),
            token: await tokenContract.getAddress(),
            amount: amountToTransfer,
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
        [owner, user1] = (await ethers.getSigners()) as SignerWithAddress[];

        const BridgeFactory = await ethers.getContractFactory('Bridge');
        const TestTokenFactory = await ethers.getContractFactory('TestToken');

        bridgeContract = (await BridgeFactory.deploy()) as Bridge;
        await bridgeContract.waitForDeployment();

        tokenContract = (await TestTokenFactory.deploy(initialSupply)) as TestToken;
        await tokenContract.waitForDeployment();

        await tokenContract.transfer(await user1.getAddress(), amountToTransfer);

        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisigProxy = (await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            [teeSigner.address],
            1,
            [owner.address],
            1,
            await owner.getAddress(),
            0 // timelockDuration = 0 so proposals execute immediately in tests
        )) as MultisigProxy;
        await multisigProxy.waitForDeployment();
        multisigAddress = await multisigProxy.getAddress();

        chainId = await bridgeContract.getChainId();
        domain = {
            name: 'MultisigProxy',
            version: '1',
            chainId,
            verifyingContract: multisigAddress,
        };

        await bridgeContract.transferOwnership(multisigAddress);
    });

    it('bridge should be deployed with correct values', async () => {
        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(amountToTransfer);
        expect(await bridgeContract.owner()).to.equal(multisigAddress);
    });

    it('should allow user to bridge tokens in', async () => {
        await expect(await bridgeInTokens(1112))
            .to.emit(bridgeContract, 'BridgeFundsIn')
            .withArgs(
                await user1.getAddress(),
                bridgeInTransactionId,
                1112,
                await tokenContract.getAddress(),
                amountToTransfer,
                destinationChain,
                destinationAddress
            );

        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(0);
        expect(await tokenContract.balanceOf(await bridgeContract.getAddress())).to.equal(
            amountToTransfer
        );
    });

    it('owner bridges tokens out', async () => {
        const amountOut = ethers.parseEther('800');

        const bridgeIface = new Interface([
            'function fundsOut(address,address,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            await user1.getAddress(),
            amountOut,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(await executeViaTee(callData))
            .to.emit(bridgeContract, 'BridgeFundsOut')
            .withArgs(
                await user1.getAddress(),
                await tokenContract.getAddress(),
                amountOut,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );

        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(amountOut);
    });

    it('owner can not bridge out more tokens than available', async () => {
        const bridgeBalance = await tokenContract.balanceOf(await bridgeContract.getAddress());
        const excessiveAmount = bridgeBalance + 1n;

        const bridgeIface = new Interface([
            'function fundsOut(address,address,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            await user1.getAddress(),
            excessiveAmount,
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);

        await expect(executeViaTee(callData)).to.be.revertedWithCustomError(
            bridgeContract,
            'AmountExceedBridgePool'
        );
    });

    it('should not allow transaction if bridge is paused', async () => {
        // Pause via federation emergency pause
        const {
            buildBitmapAndSignatures: _b,
            EmergencyPauseTypes,
        } = await import('./helpers/multisig-helpers');

        const federationSigner = ethers.Wallet.createRandom();
        // We set owner as the single federation signer at deploy, so use owner
        const pauseNonce = await multisigProxy.proposalNonce();
        const pauseDeadline = (await getCurrentTimeFromNetwork()) + 84_000;

        const { bitmap, signatures } = await buildBitmapAndSignatures(
            [owner as any],
            [0],
            domain,
            EmergencyPauseTypes,
            { nonce: pauseNonce, deadline: pauseDeadline }
        );

        await multisigProxy.emergencyPause(pauseNonce, pauseDeadline, bitmap, signatures);
        expect(await bridgeContract.paused()).to.be.true;

        await tokenContract.connect(user1).approve(await bridgeContract.getAddress(), amountToTransfer);
        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signature = await signFundsIn(teeSigner, domain, {
            sender: await user1.getAddress(),
            token: await tokenContract.getAddress(),
            amount: amountToTransfer,
            destinationChain,
            destinationAddress,
            deadline,
            nonce: 9999,
            transactionId: 9999,
        });

        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce: 9999,
                    transactionId: 9999,
                },
                signature,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'EnforcedPause');

        // Unpause
        const unpauseNonce = await multisigProxy.proposalNonce();
        const unpauseDeadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const { EmergencyUnpauseTypes } = await import('./helpers/multisig-helpers');
        const { bitmap: ub, signatures: us } = await buildBitmapAndSignatures(
            [owner as any],
            [0],
            domain,
            EmergencyUnpauseTypes,
            { nonce: unpauseNonce, deadline: unpauseDeadline }
        );
        await multisigProxy.emergencyUnpause(unpauseNonce, unpauseDeadline, ub, us);
        expect(await bridgeContract.paused()).to.be.false;
    });
});
