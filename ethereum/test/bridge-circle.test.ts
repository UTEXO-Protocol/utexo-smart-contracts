import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Wallet } from 'ethers';
import {
    Bridge,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
} from '../typechain-types';
import usdcAbi from './abis/Usdc.json';
import messageAbi from './abis/cctp/Message.json';
import tokenMessengerAbi from './abis/cctp/TokenMessenger.json';
import { getCurrentTimeFromNetwork, signMessage } from './util';
import { BridgeInParamsCircleStruct } from '../typechain-types/contracts/Bridge';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('Bridge Circle test', function () {
    let bridgeContract: Bridge;
    let chainId: number;
    let user: SignerWithAddress;

    let systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const bridgeInTransactionId = 111;
    const TYPES_FOR_SIGNATURE_BRIDGE_IN_CIRCLE = [
        'address',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint32',
        'bytes32',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
    ];

    const USDC_ETH_CONTRACT_ADDRESS = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F';
    const ETH_MESSAGE_CONTRACT_ADDRESS = '0x1a9695e9dbdb443f4b20e3e4ce87c8d963fda34f';
    const CIRCLE_CONTRACT_ADDRESS = '0xD0C3da58f55358142b8d3e06C1C30c5C6114EFE8';
    const destinationChainCircle = 1;
    const destinationAddressCircle = '0x29ca1d320A36cBEce54fD5A75e4E707Ab5C8493B';
    const impersonatedSignerAddress = '0x2380482cAF3B44dDcfAF1c127a3A2A4AeE3f03Ae';
    const amountToTransferCircle = ethers.parseUnits('100', 6);
    const commissionCircle = ethers.parseUnits('1', 6);

    const usdcEthContract = new ethers.Contract(
        USDC_ETH_CONTRACT_ADDRESS,
        usdcAbi,
        ethers.provider
    );
    const ethMessageContract = new ethers.Contract(
        ETH_MESSAGE_CONTRACT_ADDRESS,
        messageAbi,
        ethers.provider
    );
    const circleContract = new ethers.Contract(
        CIRCLE_CONTRACT_ADDRESS,
        tokenMessengerAbi,
        ethers.provider
    );

    const getDestinationAddressInBytes32 = async (destinationAddress: any) =>
        ethMessageContract.addressToBytes32(destinationAddress);

    const bridgeInTokensCircle = async (nonce: number) => {
        const impersonatedSigner = await ethers.getImpersonatedSigner(impersonatedSignerAddress);

        const destinationAddressInBytes32 = await getDestinationAddressInBytes32(
            destinationAddressCircle
        );

        await usdcEthContract
            .connect(impersonatedSigner)
            .approve(await bridgeContract.getAddress(), amountToTransferCircle);

        // Not working: - Burn amount exceeds per tx limit
        await usdcEthContract
            .connect(impersonatedSigner)
            .approve(await bridgeContract.getAddress(), amountToTransferCircle);

        const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
        const signature = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_CIRCLE,
            [
                impersonatedSigner.address,
                await bridgeContract.getAddress(),
                usdcEthContract.address,
                amountToTransferCircle,
                commissionCircle,
                destinationChainCircle,
                destinationAddressInBytes32,
                deadline,
                nonce,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        return bridgeContract.connect(impersonatedSigner).fundsInCircle(
            {
                token: await usdcEthContract.getAddress(),
                amount: amountToTransferCircle,
                commission: commissionCircle,
                destinationChain: destinationChainCircle,
                destinationAddress: destinationAddressInBytes32,
                deadline,
                nonce,
                transactionId: bridgeInTransactionId,
            },
            signature
        );
    };

    this.beforeAll(async () => {
        const BridgeContract = await ethers.getContractFactory('Bridge');

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        await bridgeContractImplementation.waitForDeployment();

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

        await transparentProxy.changeAdmin(await bridgeContractProxyAdmin.getAddress());
        const upgradeTx = await bridgeContractProxyAdmin.upgrade(
            await transparentProxy.getAddress(),
            await bridgeContractImplementation.getAddress()
        );
        await upgradeTx.wait(1);

        bridgeContract = await ethers.getContractAt('Bridge', await transparentProxy.getAddress());
        await bridgeContract.initialize(systemWallet.address);

        const signers = await ethers.getSigners();
        user = signers[0];
    });

    it('should set circle contract address', async function () {
        const testAddress = '0x7e0f5A592322Bc973DDE62dF3f91604D21d37446';
        await bridgeContract.setCircleContract(testAddress);
        expect(await bridgeContract.getCircleContract()).to.equal(testAddress);
    });

    it('should revert if token address is 0', async () => {
        chainId = 1;

        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const emptyAddress = '0x0000000000000000000000000000000000000000';
        const destinationAddressBytes32 = ethers.zeroPadBytes(emptyAddress, 32);

        const signature = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_CIRCLE,
            [
                user.address,
                await bridgeContract.getAddress(),
                emptyAddress,
                amountToTransferCircle,
                commissionCircle,
                destinationChainCircle,
                destinationAddressBytes32,
                deadline,
                1,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: emptyAddress,
                    amount: amountToTransferCircle,
                    commission: commissionCircle,
                    destinationChain: destinationChainCircle,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce: 1,
                    transactionId: bridgeInTransactionId,
                },
                signature
            )
        ).to.be.revertedWith('InvalidTokenAddress');
    });

    it('should revert if destinationChain > 10', async () => {
        chainId = 1;

        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const destinationAddressBytes32 = ethers.zeroPadBytes(destinationAddressCircle, 32);
        const invalidDestinationChain = 11;

        const signature = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_CIRCLE,
            [
                user.address,
                await bridgeContract.getAddress(),
                USDC_ETH_CONTRACT_ADDRESS,
                amountToTransferCircle,
                commissionCircle,
                invalidDestinationChain,
                destinationAddressBytes32,
                deadline,
                1,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: USDC_ETH_CONTRACT_ADDRESS,
                    amount: amountToTransferCircle,
                    commission: commissionCircle,
                    destinationChain: invalidDestinationChain,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce: 1,
                    transactionId: bridgeInTransactionId,
                },
                signature
            )
        ).to.be.revertedWith('InvalidDestinationChain');
    });

    it('should revert if total commission is greater than or equal to amount', async () => {
        chainId = 1;

        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const destinationAddressBytes32 = ethers.zeroPadBytes(destinationAddressCircle, 32);
        const amount = ethers.parseUnits('100', 6);
        const excessiveGasCommission = ethers.parseUnits('100', 6);

        const signature = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_CIRCLE,
            [
                user.address,
                await bridgeContract.getAddress(),
                USDC_ETH_CONTRACT_ADDRESS,
                amount,
                excessiveGasCommission,
                destinationChainCircle,
                destinationAddressBytes32,
                deadline,
                2,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: USDC_ETH_CONTRACT_ADDRESS,
                    amount: amount,
                    commission: excessiveGasCommission,
                    destinationChain: destinationChainCircle,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce: 2,
                    transactionId: bridgeInTransactionId,
                },
                signature
            )
        ).to.be.revertedWith('CommissionGreaterThanAmount');
    });

    it('should revert if the signature is expired', async () => {
        chainId = 1;
        const nonce = 4;

        // deadline intentionally set in the past
        const deadline = (await getCurrentTimeFromNetwork()) - 10;
        const destinationAddressBytes32 = ethers.zeroPadBytes(destinationAddressCircle, 32);

        const signature = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_CIRCLE,
            [
                user.address,
                await bridgeContract.getAddress(),
                USDC_ETH_CONTRACT_ADDRESS,
                amountToTransferCircle,
                commissionCircle,
                destinationChainCircle,
                destinationAddressBytes32,
                deadline,
                nonce,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: USDC_ETH_CONTRACT_ADDRESS,
                    amount: amountToTransferCircle,
                    commission: commissionCircle,
                    destinationChain: destinationChainCircle,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signature
            )
        ).to.be.revertedWith('ExpiredSignature');
    });
});
