import { ethers } from 'hardhat';
import { Wallet, TypedDataDomain } from 'ethers';

// =========================================================================
// CONTRACT ADDRESSES (replace after deployment to Sepolia)
// =========================================================================

export const BRIDGE_PROXY = '0x725601D6A543FC420048538b4659F641Bb01d4E4';
export const MULTISIG_PROXY = '0x13C99Ab551c8f768EAc754DA2AC66221B8BfB017';

// =========================================================================
// TEST SIGNER KEYS (Sepolia only! Never use on mainnet)
// =========================================================================

// TEE enclave signers — these must match what was passed to MultisigProxy constructor
export const TEE_SIGNER_KEYS = [
    '0xc6b3bee477ac0c1795ad5d683f96a5d7418de78d773909d7492d61279df9463b', // hardhat account #0
    '0x43c672934b7b47d628237a77fb521a01df3cde7ef29862266f8b1e9cafdd36c9', // hardhat account #1
];

// Federation signers
export const FEDERATION_SIGNER_KEYS = [
    '0xb18517451ee282b20804c202d7943625baedbd391b2863c0378539772af0e9dc', // hardhat account #3
    '0x5518a0aef697e66c174c57fbc11cf1037c64d9486d6d15a7e96616aea38ee724', // hardhat account #4
];

export const ENCLAVE_THRESHOLD = 1;
export const FEDERATION_THRESHOLD = 1;

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
