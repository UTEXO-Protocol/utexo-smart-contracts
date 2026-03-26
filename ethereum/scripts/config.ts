import { ethers } from 'hardhat';
import { Wallet, TypedDataDomain } from 'ethers';

// =========================================================================
// CONTRACT ADDRESSES (replace after deployment to Sepolia)
// =========================================================================

export const BRIDGE_PROXY = '0x0000000000000000000000000000000000000001'; // TODO: replace
export const MULTISIG_PROXY = '0x0000000000000000000000000000000000000002'; // TODO: replace

// =========================================================================
// TEST SIGNER KEYS (Sepolia only! Never use on mainnet)
// =========================================================================

// TEE enclave signers — these must match what was passed to MultisigProxy constructor
export const TEE_SIGNER_KEYS = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // hardhat account #0
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // hardhat account #1
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // hardhat account #2
];

// Federation signers
export const FEDERATION_SIGNER_KEYS = [
    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // hardhat account #3
    '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // hardhat account #4
    '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // hardhat account #5
];

export const ENCLAVE_THRESHOLD = 2;
export const FEDERATION_THRESHOLD = 2;

// =========================================================================
// HELPERS
// =========================================================================

export function getTeeSigners(): Wallet[] {
    return TEE_SIGNER_KEYS.map(key => new Wallet(key, ethers.provider));
}

export function getFederationSigners(): Wallet[] {
    return FEDERATION_SIGNER_KEYS.map(key => new Wallet(key, ethers.provider));
}

export async function getMultisigDomain(): Promise<TypedDataDomain> {
    const multisig = await ethers.getContractAt('MultisigProxy', MULTISIG_PROXY);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    return {
        name: 'MultisigProxy',
        version: '1',
        chainId,
        verifyingContract: MULTISIG_PROXY,
    };
}

export async function buildBitmapAndSign(
    signers: Wallet[],
    indices: number[],
    domain: TypedDataDomain,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, any>
): Promise<{ bitmap: bigint; signatures: string[] }> {
    let bitmap = 0n;
    const signatures: string[] = [];
    const sorted = [...indices].sort((a, b) => a - b);

    for (const idx of sorted) {
        bitmap |= 1n << BigInt(idx);
        const sig = await signers[idx].signTypedData(domain, types, value);
        signatures.push(sig);
    }

    return { bitmap, signatures };
}

export function log(label: string, value: any) {
    console.log(`  ${label}: ${value}`);
}
