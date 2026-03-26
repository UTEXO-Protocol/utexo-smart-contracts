/**
 * Test fundsOutNative on Sepolia.
 * TEE signs BridgeOperation (M-of-N bitmap), calls MultisigProxy.execute.
 *
 * Usage: npx hardhat run scripts/test-fundsOutNative.ts --network sepolia
 */
import { ethers } from 'hardhat';
import { Interface } from 'ethers';
import {
    BRIDGE_PROXY,
    MULTISIG_PROXY,
    getTeeSigners,
    getMultisigDomain,
    buildBitmapAndSign,
    ENCLAVE_THRESHOLD,
    log,
} from './config';

const BridgeOperationTypes = {
    BridgeOperation: [
        { name: 'selector', type: 'bytes4' },
        { name: 'callData', type: 'bytes' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ],
};

async function main() {
    const [sender] = await ethers.getSigners();
    const multisig = await ethers.getContractAt('MultisigProxy', MULTISIG_PROXY);
    const teeSigners = getTeeSigners();
    const domain = await getMultisigDomain();

    // Build fundsOutNative callData
    const recipient = sender.address; // send back to ourselves for testing
    const amount = ethers.parseEther('0.0005');
    const commission = 0n;
    const transactionId = Date.now();
    const sourceChain = 'Tron';
    const sourceAddress = 'TXYZabc123testAddress';

    const bridgeIface = new Interface([
        'function fundsOutNative(address payable,uint256,uint256,uint256,string,string)',
    ]);
    const callData = bridgeIface.encodeFunctionData('fundsOutNative', [
        recipient, amount, commission, transactionId, sourceChain, sourceAddress,
    ]);
    const selector = callData.slice(0, 10) as `0x${string}`;

    const nonce = await multisig.getNonce(selector);
    const block = await ethers.provider.getBlock('latest');
    const deadline = block!.timestamp + 3600;

    console.log('\n=== fundsOutNative via MultisigProxy.execute ===');
    log('recipient', recipient);
    log('amount', ethers.formatEther(amount) + ' ETH');
    log('selector nonce', nonce.toString());
    log('deadline', deadline);

    // TEE signers sign (use first ENCLAVE_THRESHOLD signers)
    const signerIndices = Array.from({ length: ENCLAVE_THRESHOLD }, (_, i) => i);
    const { bitmap, signatures } = await buildBitmapAndSign(
        teeSigners, signerIndices, domain,
        BridgeOperationTypes,
        { selector, callData, nonce, deadline }
    );

    log('bitmap', '0b' + bitmap.toString(2));
    log('signatures count', signatures.length);

    console.log('\n  Sending transaction...');
    const tx = await multisig.connect(sender).execute(callData, nonce, deadline, bitmap, signatures);
    const receipt = await tx.wait();
    console.log(`  TX hash: ${receipt!.hash}`);
    console.log(`  Block: ${receipt!.blockNumber}`);
    console.log('  Done!\n');
}

main().catch(console.error);
