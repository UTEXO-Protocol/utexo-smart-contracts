/**
 * Test proposeUpdateEnclaveSigners + executeProposal on Sepolia.
 * Full two-phase timelock flow: propose → wait → execute.
 *
 * Usage:
 *   Phase 1 (propose): npx hardhat run scripts/test-proposeUpdateEnclaveSigners.ts --network sepolia
 *   Phase 2 (execute): npx hardhat run scripts/test-proposeUpdateEnclaveSigners.ts --network sepolia
 *
 * The script detects which phase to run automatically:
 * - If PROPOSAL_ID is empty → creates proposal (Phase 1)
 * - If PROPOSAL_ID is set → executes proposal (Phase 2)
 */
import { ethers } from 'hardhat';
import {
    MULTISIG_PROXY,
    getFederationSigners,
    getMultisigDomain,
    buildBitmapAndSign,
    FEDERATION_THRESHOLD,
    log,
} from './config';

const ProposeUpdateEnclaveSignersTypes = {
    ProposeUpdateEnclaveSigners: [
        { name: 'newSigners', type: 'address[]' },
        { name: 'newThreshold', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

// =========================================================================
// CONFIGURATION — edit these values
// =========================================================================

// New enclave signers to set (replace with actual addresses)
const NEW_ENCLAVE_SIGNERS = [
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
];
const NEW_ENCLAVE_THRESHOLD = 2;

// After Phase 1, paste the proposalId here and re-run for Phase 2
const PROPOSAL_ID = ''; // e.g. '0xabc123...'

async function main() {
    const [sender] = await ethers.getSigners();
    const multisig = await ethers.getContractAt('MultisigProxy', MULTISIG_PROXY);
    const fedSigners = getFederationSigners();
    const domain = await getMultisigDomain();

    if (!PROPOSAL_ID) {
        // =====================================================================
        // PHASE 1: Propose
        // =====================================================================
        const nonce = await multisig.proposalNonce();
        const block = await ethers.provider.getBlock('latest');
        const deadline = block!.timestamp + 7 * 24 * 3600; // 7 days

        console.log('\n=== proposeUpdateEnclaveSigners (Phase 1: Propose) ===');
        log('proposalNonce', nonce.toString());
        log('newSigners', NEW_ENCLAVE_SIGNERS.join(', '));
        log('newThreshold', NEW_ENCLAVE_THRESHOLD);
        log('deadline', new Date(deadline * 1000).toISOString());

        const signerIndices = Array.from({ length: FEDERATION_THRESHOLD }, (_, i) => i);
        const { bitmap, signatures } = await buildBitmapAndSign(
            fedSigners, signerIndices, domain,
            ProposeUpdateEnclaveSignersTypes,
            { newSigners: NEW_ENCLAVE_SIGNERS, newThreshold: NEW_ENCLAVE_THRESHOLD, nonce, deadline }
        );

        console.log('\n  Sending propose transaction...');
        const tx = await multisig.connect(sender).proposeUpdateEnclaveSigners(
            NEW_ENCLAVE_SIGNERS, NEW_ENCLAVE_THRESHOLD, nonce, deadline, bitmap, signatures
        );
        const receipt = await tx.wait();
        console.log(`  TX hash: ${receipt!.hash}`);

        // Extract proposalId from event
        const iface = multisig.interface;
        const proposalCreatedLog = receipt!.logs.find(
            (l: any) => {
                try { return iface.parseLog(l)?.name === 'ProposalCreated'; } catch { return false; }
            }
        );
        const parsed = iface.parseLog(proposalCreatedLog!);
        const proposalId = parsed!.args[0];

        console.log(`\n  PROPOSAL CREATED!`);
        console.log(`  proposalId: ${proposalId}`);
        console.log(`\n  Next steps:`);
        console.log(`  1. Wait for timelock to expire`);
        console.log(`  2. Set PROPOSAL_ID = '${proposalId}' in this script`);
        console.log(`  3. Re-run this script\n`);

    } else {
        // =====================================================================
        // PHASE 2: Execute
        // =====================================================================
        console.log('\n=== proposeUpdateEnclaveSigners (Phase 2: Execute) ===');
        log('proposalId', PROPOSAL_ID);

        const proposal = await multisig.getProposal(PROPOSAL_ID);
        log('status', ['None', 'Pending', 'Executed', 'Cancelled'][Number(proposal.status)]);
        log('proposedAt', new Date(Number(proposal.proposedAt) * 1000).toISOString());
        log('deadline', new Date(Number(proposal.deadline) * 1000).toISOString());

        const timelockDuration = await multisig.timelockDuration();
        const readyAt = Number(proposal.proposedAt) + Number(timelockDuration);
        const now = (await ethers.provider.getBlock('latest'))!.timestamp;

        if (now < readyAt) {
            const waitSec = readyAt - now;
            console.log(`\n  Timelock not expired yet. Wait ${waitSec} seconds (${Math.ceil(waitSec / 60)} min).`);
            console.log(`  Ready at: ${new Date(readyAt * 1000).toISOString()}\n`);
            return;
        }

        const opData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address[]', 'uint256'],
            [NEW_ENCLAVE_SIGNERS, NEW_ENCLAVE_THRESHOLD]
        );

        console.log('\n  Sending execute transaction...');
        const tx = await multisig.connect(sender).executeProposal(PROPOSAL_ID, opData);
        const receipt = await tx.wait();
        console.log(`  TX hash: ${receipt!.hash}`);

        const newSigners = await multisig.getEnclaveSigners();
        const newThreshold = await multisig.enclaveThreshold();
        console.log(`\n  Enclave signers updated!`);
        log('newSigners', newSigners.join(', '));
        log('newThreshold', newThreshold.toString());
        console.log('  Done!\n');
    }
}

main().catch(console.error);
