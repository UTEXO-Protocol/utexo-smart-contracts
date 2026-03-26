import { ethers } from 'hardhat';
import { expect } from 'chai';
import { TypedDataDomain, HDNodeWallet } from 'ethers';
import {
    Bridge,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
    MultisigProxy,
} from '../typechain-types';
import { getCurrentTimeFromNetwork } from './util';
import { FundsInCircleParamsStruct } from '../typechain-types/contracts/Bridge';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { signFundsInCircle } from './helpers/bridge-setup';
import { buildBitmapAndSignatures, BridgeOperationTypes } from './helpers/multisig-helpers';

describe('Bridge Circle test', function () {
    let bridgeContract: Bridge;
    let multisigContract: MultisigProxy;
    let teeSigner: HDNodeWallet;
    let domain: TypedDataDomain;
    let user: SignerWithAddress;

    const bridgeInTransactionId = 111;

    const destinationChainCircle = 1;
    const destinationAddressCircle = '0x29ca1d320A36cBEce54fD5A75e4E707Ab5C8493B';
    const amountToTransferCircle = ethers.parseUnits('100', 6);
    const commissionCircle = ethers.parseUnits('1', 6);

    // A dummy token address used in validation tests (no real ERC-20 needed for revert checks)
    const DUMMY_TOKEN_ADDRESS = '0x07865c6E87B9F70255377e024ace6630C1Eaa37F';

    this.beforeAll(async () => {
        const [deployer] = await ethers.getSigners();

        teeSigner = ethers.Wallet.createRandom() as HDNodeWallet;
        const federationSigner = ethers.Wallet.createRandom();

        // Deploy Bridge via proxy
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

        // initialize() takes no arguments
        await bridgeContract.initialize(ethers.ZeroAddress);

        // Set commissionCollector BEFORE transferring ownership
        await bridgeContract.setCommissionCollector(deployer.address);

        // Set circle contract BEFORE transferring ownership
        const circleContractAddress = '0xD0C3da58f55358142b8d3e06C1C30c5C6114EFE8';
        await bridgeContract.setCircleContract(circleContractAddress);

        // Deploy MultisigProxy with the TEE signer
        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisigContract = (await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            [teeSigner.address],
            1, // enclave threshold
            [federationSigner.address],
            1, // federation threshold
            deployer.address, // commission recipient
            3600 // timelock duration
        )) as MultisigProxy;
        await multisigContract.waitForDeployment();

        // Transfer Bridge ownership to MultisigProxy
        await bridgeContract.transferOwnership(await multisigContract.getAddress());

        const chainId = await bridgeContract.getChainId();

        domain = {
            name: 'MultisigProxy',
            version: '1',
            chainId,
            verifyingContract: await multisigContract.getAddress(),
        };

        const signers = await ethers.getSigners();
        user = signers[0];
    });

    it('should set circle contract address', async function () {
        // setCircleContract is onlyOwner — ownership is now with MultisigProxy.
        // The address was already set in beforeAll; verify the stored value here.
        const testAddress = '0xD0C3da58f55358142b8d3e06C1C30c5C6114EFE8';
        expect(await bridgeContract.getCircleContract()).to.equal(testAddress);
    });

    it('should revert if token address is 0', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const emptyAddress = '0x0000000000000000000000000000000000000000';
        const destinationAddressBytes32 = ethers.zeroPadBytes(emptyAddress, 32);
        const nonce = 1;

        const signature = await signFundsInCircle(teeSigner, domain, {
            sender: user.address,
            token: emptyAddress,
            amount: amountToTransferCircle,
            commission: commissionCircle,
            destinationChain: destinationChainCircle,
            destinationAddress: destinationAddressBytes32,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: emptyAddress,
                    amount: amountToTransferCircle,
                    commission: commissionCircle,
                    destinationChain: destinationChainCircle,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signature,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidTokenAddress');
    });

    it('should revert if destinationChain > 10', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const destinationAddressBytes32 = ethers.zeroPadBytes(destinationAddressCircle, 32);
        const invalidDestinationChain = 11;
        const nonce = 1;

        const signature = await signFundsInCircle(teeSigner, domain, {
            sender: user.address,
            token: DUMMY_TOKEN_ADDRESS,
            amount: amountToTransferCircle,
            commission: commissionCircle,
            destinationChain: invalidDestinationChain,
            destinationAddress: destinationAddressBytes32,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: DUMMY_TOKEN_ADDRESS,
                    amount: amountToTransferCircle,
                    commission: commissionCircle,
                    destinationChain: invalidDestinationChain,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signature,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationChain');
    });

    it('should revert if total commission is greater than or equal to amount', async () => {
        const deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const destinationAddressBytes32 = ethers.zeroPadBytes(destinationAddressCircle, 32);
        const amount = ethers.parseUnits('100', 6);
        const excessiveGasCommission = ethers.parseUnits('100', 6);
        const nonce = 2;

        const signature = await signFundsInCircle(teeSigner, domain, {
            sender: user.address,
            token: DUMMY_TOKEN_ADDRESS,
            amount,
            commission: excessiveGasCommission,
            destinationChain: destinationChainCircle,
            destinationAddress: destinationAddressBytes32,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: DUMMY_TOKEN_ADDRESS,
                    amount: amount,
                    commission: excessiveGasCommission,
                    destinationChain: destinationChainCircle,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signature,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'CommissionGreaterThanAmount');
    });

    it('should revert if the signature is expired', async () => {
        const nonce = 4;

        // deadline intentionally set in the past
        const deadline = (await getCurrentTimeFromNetwork()) - 10;
        const destinationAddressBytes32 = ethers.zeroPadBytes(destinationAddressCircle, 32);

        const signature = await signFundsInCircle(teeSigner, domain, {
            sender: user.address,
            token: DUMMY_TOKEN_ADDRESS,
            amount: amountToTransferCircle,
            commission: commissionCircle,
            destinationChain: destinationChainCircle,
            destinationAddress: destinationAddressBytes32,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

        await expect(
            bridgeContract.connect(user).fundsInCircle(
                {
                    token: DUMMY_TOKEN_ADDRESS,
                    amount: amountToTransferCircle,
                    commission: commissionCircle,
                    destinationChain: destinationChainCircle,
                    destinationAddress: destinationAddressBytes32,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signature,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'ExpiredSignature');
    });
});
