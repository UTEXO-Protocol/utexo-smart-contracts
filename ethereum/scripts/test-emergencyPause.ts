/**
 * Test emergencyPause on Sepolia.
 * Federation signs, calls MultisigProxy.emergencyPause (instant, no timelock).
 *
 * Usage: npx hardhat run scripts/test-emergencyPause.ts --network sepolia
 */
import { ethers } from 'hardhat';
import {
    BRIDGE_PROXY,
    MULTISIG_PROXY,
    getFederationSigners,
    getMultisigDomain,
    buildBitmapAndSign,
    FEDERATION_THRESHOLD,
    log,
} from './config';

const EmergencyPauseTypes = {
    EmergencyPause: [
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

async function main() {
    const [sender] = await ethers.getSigners();
    const multisig = await ethers.getContractAt('MultisigProxy', MULTISIG_PROXY);
    const bridge = await ethers.getContractAt('Bridge', BRIDGE_PROXY);
    const fedSigners = getFederationSigners();
    const domain = await getMultisigDomain();

    const nonce = await multisig.proposalNonce();
    const block = await ethers.provider.getBlock('latest');
    const deadline = block!.timestamp + 3600;

    const pausedBefore = await bridge.paused();

    console.log('\n=== emergencyPause ===');
    log('proposalNonce', nonce.toString());
    log('paused before', pausedBefore);

    const signerIndices = Array.from({ length: FEDERATION_THRESHOLD }, (_, i) => i);
    const { bitmap, signatures } = await buildBitmapAndSign(
        fedSigners, signerIndices, domain,
        EmergencyPauseTypes,
        { nonce, deadline }
    );

    console.log('\n  Sending transaction...');
    const tx = await multisig.connect(sender).emergencyPause(nonce, deadline, bitmap, signatures);
    const receipt = await tx.wait();
    console.log(`  TX hash: ${receipt!.hash}`);

    const pausedAfter = await bridge.paused();
    log('paused after', pausedAfter);
    console.log('  Done!\n');
}

main().catch(console.error);
