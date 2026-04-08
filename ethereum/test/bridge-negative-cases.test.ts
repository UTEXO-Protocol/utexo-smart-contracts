import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/src/signers';
import { TypedDataDomain, HDNodeWallet } from 'ethers';
import { Bridge, TestToken, MultisigProxy } from '../typechain-types';
import { getCurrentTimeFromNetwork } from './util';
import { signFundsIn } from './helpers/bridge-setup';
import {
    buildBitmapAndSignatures,
    BridgeOperationTypes,
} from './helpers/multisig-helpers';

describe('Bridge Negative Cases test', function () {
    let bridgeContract: Bridge;
    let multisigProxy: MultisigProxy;
    let tokenContract: TestToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;

    let teeSigner: HDNodeWallet;
    let federationSigner: HDNodeWallet;
    let domain: TypedDataDomain;

    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const destinationChain = 'rgb';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';
    const emptyAddress = '0x0000000000000000000000000000000000000000';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    let chainId: bigint;

    /**
     * Helper: encode Bridge callData and forward it through MultisigProxy.execute()
     * using the TEE signer (enclave signer at index 0).
     */
    async function executeOnBridge(callData: string) {
        const selectorBytes4 = callData.slice(0, 10) as string;
        const nonce = await multisigProxy.nonces(selectorBytes4 as any);
        const deadline = (await getCurrentTimeFromNetwork()) + 3600;

        const { bitmap, signatures } = await buildBitmapAndSignatures(
            [teeSigner],
            [0],
            domain,
            BridgeOperationTypes,
            { selector: selectorBytes4, callData, nonce, deadline }
        );

        return multisigProxy.execute(callData, nonce, deadline, bitmap, signatures);
    }

    this.beforeEach(async () => {
        [owner, user1] = (await ethers.getSigners()) as SignerWithAddress[];

        teeSigner = ethers.Wallet.createRandom();
        federationSigner = ethers.Wallet.createRandom();

        const BridgeFactory = await ethers.getContractFactory('Bridge');
        const TestTokenFactory = await ethers.getContractFactory('TestToken');

        bridgeContract = (await BridgeFactory.deploy()) as Bridge;
        await bridgeContract.waitForDeployment();

        tokenContract = (await TestTokenFactory.deploy(initialSupply)) as TestToken;
        await tokenContract.waitForDeployment();
        await tokenContract.transfer(await user1.getAddress(), amountToTransfer);

        chainId = await bridgeContract.getChainId();

        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisigProxy = (await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            [teeSigner.address],
            1,
            [federationSigner.address],
            1,
            await owner.getAddress(),
            3600
        )) as MultisigProxy;
        await multisigProxy.waitForDeployment();

        await bridgeContract.transferOwnership(await multisigProxy.getAddress());

        const multisigAddress = await multisigProxy.getAddress();
        domain = {
            name: 'MultisigProxy',
            version: '1',
            chainId,
            verifyingContract: multisigAddress,
        };
    });

    it('user can not cheat bridgeIn', async () => {
        async function getSignature(
            token: string,
            amount: bigint,
            destChain: string,
            destAddr: string,
            deadline: number,
            nonce: number,
            transactionId = bridgeInTransactionId
        ) {
            return signFundsIn(teeSigner, domain, {
                sender: await user1.getAddress(),
                token,
                amount,
                destinationChain: destChain,
                destinationAddress: destAddr,
                deadline,
                nonce,
                transactionId,
            });
        }

        async function bridgeIn(
            destChain: string,
            destAddr: string,
            deadline: number,
            nonce: number,
            signature: string | Uint8Array,
            transactionId = bridgeInTransactionId
        ) {
            return bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    destinationChain: destChain,
                    destinationAddress: destAddr,
                    deadline,
                    nonce,
                    transactionId,
                },
                signature,
                0
            );
        }

        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const tokenAddress = await tokenContract.getAddress();

        // should revert if deadline has passed
        const expiredSig = await getSignature(tokenAddress, amountToTransfer, 'rgb', destinationAddress, deadline - 2000, 0);
        await expect(
            bridgeIn('rgb', destinationAddress, deadline - 2000, 0, expiredSig)
        ).to.be.revertedWithCustomError(bridgeContract, 'ExpiredSignature');

        // should revert if nonce already used
        await tokenContract.connect(user1).approve(await bridgeContract.getAddress(), amountToTransfer);
        const validSig = await getSignature(tokenAddress, amountToTransfer, 'rgb', destinationAddress, deadline, 1);
        await bridgeIn('rgb', destinationAddress, deadline, 1, validSig);

        await expect(
            bridgeIn('rgb', destinationAddress, deadline, 1, validSig)
        ).to.be.revertedWithCustomError(bridgeContract, 'AlreadyUsedSignature');

        // should revert if destination chain is empty
        const noChainSig = await getSignature(tokenAddress, amountToTransfer, '', destinationAddress, deadline, 4);
        await expect(
            bridgeIn('', destinationAddress, deadline, 4, noChainSig)
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationChain');

        // should revert if destination address is empty
        const noAddrSig = await getSignature(tokenAddress, amountToTransfer, 'rgb', '', deadline, 5);
        await expect(
            bridgeIn('rgb', '', deadline, 5, noAddrSig)
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationAddress');

        // should revert with invalid signature (signed different params)
        const wrongSig = await getSignature(tokenAddress, amountToTransfer, 'rgb', destinationAddress, deadline, 10);
        await tokenContract.connect(user1).approve(await bridgeContract.getAddress(), amountToTransfer);
        await expect(
            bridgeIn('rgb', 'DIFFERENT_ADDRESS', deadline, 10, wrongSig)
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');
    });

    it('arbitrary user can not bridge tokens out', async () => {
        await expect(
            bridgeContract.connect(user1).fundsOut(
                await tokenContract.getAddress(),
                await user1.getAddress(),
                amountToTransfer,
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'OwnableUnauthorizedAccount');
    });

    it('arbitrary user can provide wrong addresses to bridge tokens out', async () => {
        const fundsOutBadToken = bridgeContract.interface.encodeFunctionData('fundsOut', [
            emptyAddress,
            await user1.getAddress(),
            amountToTransfer,
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(fundsOutBadToken)).to.be.revertedWithCustomError(
            bridgeContract,
            'InvalidTokenAddress'
        );

        const fundsOutBadRecipient = bridgeContract.interface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            emptyAddress,
            amountToTransfer,
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(fundsOutBadRecipient)).to.be.revertedWithCustomError(
            bridgeContract,
            'InvalidRecipientAddress'
        );
    });

    it('owner can not bridge out more tokens than in bridge', async () => {
        // Bridge has 0 tokens at this point
        const callData = bridgeContract.interface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            await user1.getAddress(),
            amountToTransfer,
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(callData)).to.be.revertedWithCustomError(
            bridgeContract,
            'AmountExceedBridgePool'
        );
    });
});
