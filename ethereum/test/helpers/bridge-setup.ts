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
 * Deploys Bridge + MultisigProxy.
 * Transfers Bridge ownership to MultisigProxy.
 * Uses a single TEE signer with threshold 1 and a single federation signer with threshold 1.
 */
export async function deployBridgeWithMultisig(): Promise<BridgeTestEnv> {
    const [deployer] = await ethers.getSigners();

    const teeSigner = Wallet.createRandom();
    const federationSigner = Wallet.createRandom();

    const BridgeFactory = await ethers.getContractFactory('Bridge');
    const bridge = await BridgeFactory.deploy() as Bridge;
    await bridge.waitForDeployment();

    const chainId = await bridge.getChainId();

    const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
    const multisig = await MultisigFactory.deploy(
        await bridge.getAddress(),
        [teeSigner.address],
        1,
        [federationSigner.address],
        1,
        await deployer.getAddress(),
        3600
    ) as MultisigProxy;
    await multisig.waitForDeployment();

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

/**
 * EIP-712 type definition for FundsIn.
 * Must match Bridge._FUNDS_IN_TYPEHASH exactly.
 *
 * Domain: { name: "MultisigProxy", version: "1", chainId, verifyingContract: <MultisigProxy address> }
 *
 * Type string:
 *   FundsIn(address sender,address token,uint256 amount,string destinationChain,
 *           string destinationAddress,uint256 deadline,uint256 nonce,uint256 transactionId)
 */
const FundsInTypes = {
    FundsIn: [
        { name: 'sender',             type: 'address' },
        { name: 'token',              type: 'address' },
        { name: 'amount',             type: 'uint256' },
        { name: 'destinationChain',   type: 'string'  },
        { name: 'destinationAddress', type: 'string'  },
        { name: 'deadline',           type: 'uint256' },
        { name: 'nonce',              type: 'uint256' },
        { name: 'transactionId',      type: 'uint256' },
    ],
};

export async function signFundsIn(
    signer: Wallet,
    domain: TypedDataDomain,
    params: {
        sender: string;
        token: string;
        amount: bigint;
        destinationChain: string;
        destinationAddress: string;
        deadline: number;
        nonce: number;
        transactionId: number;
    }
): Promise<string> {
    return signer.signTypedData(domain, FundsInTypes, params);
}
