import { ethers } from 'hardhat';
import { Wallet, TypedDataDomain } from 'ethers';
import { Bridge, MultisigProxy } from '../../typechain-types';

export interface BridgeTestEnv {
    bridge: Bridge;
    multisig: MultisigProxy;
    teeSigner: Wallet;
    domain: TypedDataDomain;
    chainId: bigint;
}

/**
 * Deploys Bridge (behind TransparentProxy) + MultisigProxy.
 * Transfers Bridge ownership to MultisigProxy.
 * Uses a single TEE signer with threshold 1 and a single federation signer with threshold 1.
 */
export async function deployBridgeWithMultisig(): Promise<BridgeTestEnv> {
    const [deployer] = await ethers.getSigners();

    const teeSigner = Wallet.createRandom();
    const federationSigner = Wallet.createRandom();

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

    const bridge = await ethers.getContractAt('Bridge', await transparentProxy.getAddress()) as Bridge;
    await bridge.initialize(ethers.ZeroAddress);

    const chainId = await bridge.getChainId();

    // Deploy MultisigProxy with single TEE signer (threshold 1) and single federation signer
    const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
    const multisig = await MultisigFactory.deploy(
        await bridge.getAddress(),
        [teeSigner.address],
        1,  // enclave threshold
        [federationSigner.address],
        1,  // federation threshold
        await deployer.getAddress(),  // commission recipient
        3600  // timelock
    ) as MultisigProxy;
    await multisig.waitForDeployment();

    // Transfer Bridge ownership to MultisigProxy
    await bridge.transferOwnership(await multisig.getAddress());

    const domain: TypedDataDomain = {
        name: 'MultisigProxy',
        version: '1',
        chainId,
        verifyingContract: await multisig.getAddress(),
    };

    return { bridge, multisig, teeSigner, domain, chainId };
}

// =========================================================================
// EIP-712 signing helpers for fundsIn operations
// =========================================================================

const FundsInTypes = {
    FundsIn: [
        { name: 'sender', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'commission', type: 'uint256' },
        { name: 'destinationChain', type: 'string' },
        { name: 'destinationAddress', type: 'string' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'transactionId', type: 'uint256' },
    ],
};

const FundsInNativeTypes = {
    FundsInNative: [
        { name: 'sender', type: 'address' },
        { name: 'commission', type: 'uint256' },
        { name: 'destinationChain', type: 'string' },
        { name: 'destinationAddress', type: 'string' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'transactionId', type: 'uint256' },
    ],
};

const FundsInCircleTypes = {
    FundsInCircle: [
        { name: 'sender', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'commission', type: 'uint256' },
        { name: 'destinationChain', type: 'uint32' },
        { name: 'destinationAddress', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'transactionId', type: 'uint256' },
    ],
};

export async function signFundsIn(
    signer: Wallet,
    domain: TypedDataDomain,
    params: {
        sender: string;
        token: string;
        amount: bigint;
        commission: bigint;
        destinationChain: string;
        destinationAddress: string;
        deadline: number;
        nonce: number;
        transactionId: number;
    }
): Promise<string> {
    return signer.signTypedData(domain, FundsInTypes, params);
}

export async function signFundsInNative(
    signer: Wallet,
    domain: TypedDataDomain,
    params: {
        sender: string;
        commission: bigint;
        destinationChain: string;
        destinationAddress: string;
        deadline: number;
        nonce: number;
        transactionId: number;
    }
): Promise<string> {
    return signer.signTypedData(domain, FundsInNativeTypes, params);
}

export async function signFundsInCircle(
    signer: Wallet,
    domain: TypedDataDomain,
    params: {
        sender: string;
        token: string;
        amount: bigint;
        commission: bigint;
        destinationChain: number;
        destinationAddress: string;
        deadline: number;
        nonce: number;
        transactionId: number;
    }
): Promise<string> {
    return signer.signTypedData(domain, FundsInCircleTypes, params);
}
