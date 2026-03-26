import { Wallet, TypedDataDomain, TypedDataField } from 'ethers';

export function getMultisigDomain(verifyingContract: string, chainId: bigint): TypedDataDomain {
    return {
        name: 'MultisigProxy',
        version: '1',
        chainId,
        verifyingContract,
    };
}

/**
 * Build bitmap and collect EIP-712 signatures from selected signers.
 * Signatures are ordered by ascending signer index (matching bitmap bit order).
 */
export async function buildBitmapAndSignatures(
    signers: Wallet[],
    signerIndices: number[],
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, any>
): Promise<{ bitmap: bigint; signatures: string[] }> {
    let bitmap = 0n;
    const signatures: string[] = [];

    const sortedIndices = [...signerIndices].sort((a, b) => a - b);

    for (const idx of sortedIndices) {
        bitmap |= 1n << BigInt(idx);
        const sig = await signers[idx].signTypedData(domain, types, value);
        signatures.push(sig);
    }

    return { bitmap, signatures };
}

// =========================================================================
// EIP-712 type definitions (must match MultisigProxy.sol type hashes)
// =========================================================================

export const BridgeOperationTypes = {
    BridgeOperation: [
        { name: 'selector', type: 'bytes4' },
        { name: 'callData', type: 'bytes' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeAdminExecuteTypes = {
    ProposeAdminExecute: [
        { name: 'selector', type: 'bytes4' },
        { name: 'callData', type: 'bytes' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeUpdateEnclaveSignersTypes = {
    ProposeUpdateEnclaveSigners: [
        { name: 'newSigners', type: 'address[]' },
        { name: 'newThreshold', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeUpdateFederationSignersTypes = {
    ProposeUpdateFederationSigners: [
        { name: 'newSigners', type: 'address[]' },
        { name: 'newThreshold', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeUpdateBridgeTypes = {
    ProposeUpdateBridge: [
        { name: 'newBridge', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeSetCommissionRecipientTypes = {
    ProposeSetCommissionRecipient: [
        { name: 'newRecipient', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeSetTeeSelectorTypes = {
    ProposeSetTeeAllowedSelector: [
        { name: 'selector', type: 'bytes4' },
        { name: 'allowed', type: 'bool' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const ProposeSetTimelockDurationTypes = {
    ProposeSetTimelockDuration: [
        { name: 'newDuration', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const CancelProposalTypes = {
    CancelProposal: [
        { name: 'proposalId', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const EmergencyPauseTypes = {
    EmergencyPause: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

export const EmergencyUnpauseTypes = {
    EmergencyUnpause: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};
