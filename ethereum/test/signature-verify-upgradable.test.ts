import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/src/signers';
import { Wallet } from 'ethers';
import {
    Bridge,
    TestToken,
    TransparentProxy,
    BridgeContractProxyAdmin,
    MockContractV1,
} from '../typechain-types';
import { signMessage, getCurrentTimeFromNetwork } from './util';

describe('Signature Verification: Bridge Native', function () {
    let bridgeContract: Bridge;
    let tokenContract: TestToken;
    let tokenContract2: TestToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;

    const systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('100');
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';

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

    const emptyAddress = '0x0000000000000000000000000000000000000000';
    const emptyDestinationAddress = '';
    const emptyDestinationChain = '';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    let chainId: bigint;

    const getAmountToReturnAndTotalCommission = async () => {
        const totalCommission = testCommission;
        const amountToReturn = amountToTransfer - totalCommission;
        return [totalCommission, amountToReturn];
    };

    beforeEach(async () => {
        // @ts-ignore
        [owner, user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;

        // [owner, user1, commissionCollector] = await ethers.getSigners();

        const BridgeFactory = await ethers.getContractFactory('Bridge');
        const bridgeImpl = await BridgeFactory.deploy();
        await bridgeImpl.waitForDeployment();

        const TokenFactory = await ethers.getContractFactory('TestToken');
        tokenContract = await TokenFactory.deploy(initialSupply);
        await tokenContract.waitForDeployment();
        tokenContract2 = await TokenFactory.deploy(initialSupply);
        await tokenContract2.waitForDeployment();

        await tokenContract.transfer(await user1.getAddress(), amountToTransfer);

        const ProxyAdminFactory = await ethers.getContractFactory('BridgeContractProxyAdmin');
        const proxyAdmin = await ProxyAdminFactory.deploy();
        await proxyAdmin.waitForDeployment();

        const TransparentProxyFactory = await ethers.getContractFactory('TransparentProxy');
        const MockV1Factory = await ethers.getContractFactory('MockContractV1');
        const mock = await MockV1Factory.deploy();
        await mock.waitForDeployment();

        const proxy = await TransparentProxyFactory.deploy(await mock.getAddress());
        await proxy.waitForDeployment();
        await proxy.changeAdmin(await proxyAdmin.getAddress());
        await proxyAdmin.upgrade(await proxy.getAddress(), await bridgeImpl.getAddress());

        bridgeContract = await ethers.getContractAt('Bridge', await proxy.getAddress());
        await bridgeContract.initialize(await systemWallet.getAddress());

        chainId = await bridgeContract.getChainId();
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());
    });

    async function getSignatureBridgeInNative(
        commission = testCommission,
        _destinationChain = destinationChain,
        _destinationAddress = destinationAddress,
        deadline: number,
        nonce: number,
        transactionId = bridgeInTransactionId
    ) {
        const signature = signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_NATIVE,
            [
                await user1.getAddress(),
                await bridgeContract.getAddress(),
                commission,
                _destinationChain,
                _destinationAddress,
                deadline,
                nonce,
                transactionId,
                chainId,
            ],
            systemWallet
        );
        return signature;
    }

    async function bridgeInNative(
        _commission = testCommission,
        _destinationChain = destinationChain,
        _destinationAddress = destinationAddress,
        deadline: number,
        nonce: number,
        _bridgeInTransactionId = bridgeInTransactionId,
        signature: string | Uint8Array
    ) {
        return await bridgeContract.connect(user1).fundsInNative(
            {
                commission: _commission,
                destinationChain: _destinationChain,
                destinationAddress: _destinationAddress,
                deadline,
                nonce,
                transactionId: _bridgeInTransactionId,
            },
            signature,
            { value: amountToTransfer }
        );
    }

    it('should revert if signature is expired', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) - 1000;
        const signature = await getSignatureBridgeInNative(
            testCommission,
            destinationChain,
            destinationAddress,
            deadline,
            0
        );

        await expect(
            bridgeInNative(
                testCommission,
                destinationChain,
                destinationAddress,
                deadline,
                0,
                bridgeInTransactionId,
                signature
            )
        ).to.be.revertedWith('ExpiredSignature');
    });

    it('should revert if nonce already used', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const nonce = 1;
        const signature = await getSignatureBridgeInNative(
            testCommission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce
        );

        await bridgeInNative(
            testCommission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce,
            bridgeInTransactionId,
            signature
        );

        await expect(
            bridgeInNative(
                testCommission,
                destinationChain,
                destinationAddress,
                deadline,
                nonce,
                bridgeInTransactionId,
                signature
            )
        ).to.be.revertedWith('AlreadyUsedSignature');
    });

    it('should revert if commission is greater than amount sent', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const nonce = 2;
        const highCommission = amountToTransfer + 1n;

        const signature = await getSignatureBridgeInNative(
            highCommission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce
        );

        await expect(
            bridgeContract.connect(user1).fundsInNative(
                {
                    commission: highCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signature,
                { value: amountToTransfer }
            )
        ).to.be.revertedWith('CommissionGreaterThanAmount');
    });

    it('should revert if destination chain is invalid', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const nonce = 3;

        const signature = await getSignatureBridgeInNative(
            testCommission,
            '',
            destinationAddress,
            deadline,
            nonce
        );

        await expect(
            bridgeInNative(
                testCommission,
                '',
                destinationAddress,
                deadline,
                nonce,
                bridgeInTransactionId,
                signature
            )
        ).to.be.revertedWith('InvalidDestinationChain');
    });

    it('should revert if destination address is invalid', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const nonce = 4;

        const signature = await getSignatureBridgeInNative(
            testCommission,
            destinationChain,
            '',
            deadline,
            nonce
        );

        await expect(
            bridgeInNative(
                testCommission,
                destinationChain,
                '',
                deadline,
                nonce,
                bridgeInTransactionId,
                signature
            )
        ).to.be.revertedWith('InvalidDestinationAddress');
    });
});
