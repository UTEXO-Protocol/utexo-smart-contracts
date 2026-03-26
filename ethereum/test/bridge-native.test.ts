import { ethers } from 'hardhat';
import { expect } from 'chai';
import { HDNodeWallet, Interface } from 'ethers';
import { Bridge, MultisigProxy } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork } from './util';
import { signFundsInNative } from './helpers/bridge-setup';
import {
    buildBitmapAndSignatures,
    BridgeOperationTypes,
} from './helpers/multisig-helpers';
import { TypedDataDomain } from 'ethers';

describe('Bridge Native Coin test', function () {
    let bridgeContract: Bridge;
    let multisigProxy: MultisigProxy;
    let teeSigner: HDNodeWallet;
    let domain: TypedDataDomain;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;
    let chainId: bigint;

    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('140');
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4bridgeContractzAPRds5PQUG1dyqLLvib2xu';

    // Function to simulate a user bridging in native currency
    async function bridgeInNative(nonce: number, commission = testCommission) {
        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signature = await signFundsInNative(teeSigner, domain, {
            sender: await user1.getAddress(),
            commission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

        return bridgeContract.connect(user1).fundsInNative(
            {
                commission,
                destinationChain,
                destinationAddress,
                deadline,
                nonce,
                transactionId: bridgeInTransactionId,
            },
            signature,
            0, // signerIndex
            { value: amountToTransfer }
        );
    }

    // Helper to call fundsOutNative via MultisigProxy.execute() with TEE signatures
    async function fundsOutNative(
        recipient: string,
        amount: bigint,
        commission: bigint,
        transactionId: number,
        sourceChain: string,
        sourceAddress: string
    ) {
        const bridgeIface = new Interface([
            'function fundsOutNative(address payable,uint256,uint256,uint256,string,string)',
        ]);
        const callData = bridgeIface.encodeFunctionData('fundsOutNative', [
            recipient,
            amount,
            commission,
            transactionId,
            sourceChain,
            sourceAddress,
        ]);
        const selector = callData.slice(0, 10) as `0x${string}`;
        const nonce = await multisigProxy.getNonce(selector);
        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;

        const { bitmap, signatures } = await buildBitmapAndSignatures(
            [teeSigner],
            [0],
            domain,
            BridgeOperationTypes,
            { selector, callData, nonce, deadline }
        );

        return multisigProxy.execute(callData, nonce, deadline, bitmap, signatures);
    }

    // Helper to calculate total commission and amount to return
    function getAmountToReturnAndTotalCommission() {
        const totalCommission = testCommission;
        const amountToReturn = amountToTransfer - totalCommission;
        return [totalCommission, amountToReturn];
    }

    // Setup before running tests
    this.beforeAll(async () => {
        [, user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress[];

        teeSigner = ethers.Wallet.createRandom();
        const federationSigner = ethers.Wallet.createRandom();

        // Deploy Bridge via proxy
        const BridgeContract = await ethers.getContractFactory('Bridge');
        const BridgeContractProxyAdmin = await ethers.getContractFactory('BridgeContractProxyAdmin');
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');

        const bridgeImpl = await BridgeContract.deploy();
        const mockV1 = await MockContractV1.deploy();
        const proxyAdmin = await BridgeContractProxyAdmin.deploy();
        const transparentProxy = await TransparentProxy.deploy(await mockV1.getAddress());

        await transparentProxy.changeAdmin(await proxyAdmin.getAddress());
        await proxyAdmin.upgrade(await transparentProxy.getAddress(), await bridgeImpl.getAddress());

        bridgeContract = await ethers.getContractAt('Bridge', await transparentProxy.getAddress());
        await bridgeContract.initialize(ethers.ZeroAddress);

        chainId = await bridgeContract.getChainId();

        // Set commission collector while deployer is still the owner
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());

        // Deploy MultisigProxy
        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisigProxy = await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            [teeSigner.address],
            1, // enclave threshold
            [federationSigner.address],
            1, // federation threshold
            await commissionCollector.getAddress(), // commission recipient
            3600 // timelock duration
        ) as MultisigProxy;
        await multisigProxy.waitForDeployment();

        // Transfer Bridge ownership to MultisigProxy
        await bridgeContract.transferOwnership(await multisigProxy.getAddress());

        domain = {
            name: 'MultisigProxy',
            version: '1',
            chainId,
            verifyingContract: await multisigProxy.getAddress(),
        };
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
        const [, amountToReturn] = getAmountToReturnAndTotalCommission();
        const outboundCommission = ethers.parseEther('50');
        const userReceiveAmount = amountToReturn - outboundCommission;
        const totalAmountOut = userReceiveAmount + outboundCommission;

        await expect(
            fundsOutNative(
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
            bridgeContract
                .connect(commissionCollector)
                .withdrawNativeCommission(actualCommission, await commissionCollector.getAddress())
        )
            .to.emit(bridgeContract, 'WithdrawNativeCommission')
            .withArgs(actualCommission, await commissionCollector.getAddress());

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
        const outboundCommission = ethers.parseEther('0');

        await expect(
            fundsOutNative(
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
