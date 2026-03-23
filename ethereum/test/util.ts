import { ethers } from 'hardhat';
import { Wallet } from 'ethers';

export async function addSecondsToNetwork(time: any) {
    await setTimeToNetwork((await getCurrentTimeFromNetwork()) + time);
}

export async function setTimeToNetwork(time: Number) {
    await ethers.provider.send('evm_mine', [time]);
}

export async function getCurrentTimeFromNetwork() {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore.timestamp;
}

export async function signMessage(
    types: ReadonlyArray<string>,
    values: ReadonlyArray<any>,
    wallet: Wallet
) {
    const data = ethers.solidityPackedKeccak256(types, values);
    return ethers.getBytes(await wallet.signMessage(ethers.getBytes(data)));
}

export function ethToWei(wei: bigint) {
    return wei * (BigInt(10) ^ BigInt(18));
}

export function getPercent(value: bigint, percent: string) {
    let bigPercent = (BigInt(33_00000) * BigInt(percent)) / BigInt(33);
    return (value * bigPercent) / BigInt(100_00000);
}
