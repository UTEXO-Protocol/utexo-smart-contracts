export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

//add BNB testnet
export function getNetworkScanUrl(networkName: string) {
    switch (networkName) {
        case 'mainnet':
            return 'https://etherscan.io';
        case 'sepolia':
            return 'https://sepolia.etherscan.io';
        default:
            return 'https://sepolia.etherscan.io';
        //return 'https://etherscan.io';
    }
}
