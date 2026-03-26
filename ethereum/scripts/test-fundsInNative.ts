/**
 * Test fundsInNative on Sepolia.
 * TEE signs EIP-712 message, user calls Bridge.fundsInNative.
 *
 * Usage: npx hardhat run scripts/test-fundsInNative.ts --network sepolia
 */
import { ethers } from 'hardhat';
import { BRIDGE_PROXY, getTeeSigners, getMultisigDomain, log } from './config';

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

async function main() {
    const [sender] = await ethers.getSigners();
    const bridge = await ethers.getContractAt('Bridge', BRIDGE_PROXY);
    const teeSigners = getTeeSigners();
    const domain = await getMultisigDomain();

    const signerIndex = 0;
    const amount = ethers.parseEther('0.001');
    const commission = 0n;
    const destinationChain = 'Tron';
    const destinationAddress = 'TXYZabc123testAddress';
    const nonce = Date.now(); // unique nonce
    const transactionId = Date.now();
    const block = await ethers.provider.getBlock('latest');
    const deadline = block!.timestamp + 3600;

    console.log('\n=== fundsInNative ===');
    log('sender', sender.address);
    log('amount', ethers.formatEther(amount) + ' ETH');
    log('commission', commission.toString());
    log('destinationChain', destinationChain);
    log('destinationAddress', destinationAddress);
    log('nonce', nonce);
    log('deadline', deadline);
    log('signerIndex', signerIndex);
    log('TEE signer', teeSigners[signerIndex].address);

    // TEE signs the message
    const signature = await teeSigners[signerIndex].signTypedData(domain, FundsInNativeTypes, {
        sender: sender.address,
        commission,
        destinationChain,
        destinationAddress,
        deadline,
        nonce,
        transactionId,
    });

    console.log('\n  Sending transaction...');
    const tx = await bridge.connect(sender).fundsInNative(
        { commission, destinationChain, destinationAddress, deadline, nonce, transactionId },
        signature,
        signerIndex,
        { value: amount }
    );

    const receipt = await tx.wait();
    console.log(`  TX hash: ${receipt!.hash}`);
    console.log(`  Block: ${receipt!.blockNumber}`);
    console.log('  Done!\n');
}

main().catch(console.error);
