import { config as dotenvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import '@typechain/hardhat';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import { resolve } from 'path';
import '@nomicfoundation/hardhat-chai-matchers';

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

//TASKS
import './tasks/deploy-fungible-token';
import './tasks/deploy-bridge';
import './tasks/deploy-proxy-contracts';
import './tasks/upgrade-bridge';
import './tasks/deploy-multisig-proxy';
import './tasks/verify-contract';

/**
 * @type import('hardhat/config').HardhatUserConfig
 */

dotenvConfig({ path: resolve(__dirname, './.env') });

const config: HardhatUserConfig = {
    defaultNetwork: 'hardhat',
    solidity: {
        version: '0.8.20',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
                // details: {
                //     // only for coverage
                //     yul: true,
                // },
            },
        },
    },
    networks:
        process.env.DEPLOY_KEY !== undefined
            ? {
                  hardhat: {
                      chainId: 31337,
                      //   forking: {
                      //       url: 'https://ethereum-sepolia.blockpi.network/v1/rpc/7358eba070eaf9302581ba6522dce0af1b9746e0',
                      //   },
                  },
                  // Enable mainnet deploy only if URL is specified
                  mainnet:
                      process.env.MAINNET_URL !== undefined
                          ? {
                                url: process.env.MAINNET_URL,
                                accounts: [process.env.DEPLOY_KEY],
                            }
                          : {
                                url: '',
                                accounts: [process.env.DEPLOY_KEY],
                            },
                  sepolia: {
                      url: process.env.SEPOLIA_URL,
                      accounts: [process.env.DEPLOY_KEY],
                    //   gas: 2100000,
                    //   gasPrice: 120000000000,
                  },
              }
            : {
                  hardhat: {
                      chainId: 31337,
                      //   forking: {
                      //       url: 'https://ethereum-sepolia.blockpi.network/v1/rpc/7358eba070eaf9302581ba6522dce0af1b9746e0',
                      //   },
                  },
              },
    // If Etherscan's API key isn't specified, just don't configure `hardhat verify`
    etherscan: {
        // Use Etherscan V2 API key format (single key string).
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    sourcify: {
        enabled: false,
    },
    gasReporter: {
        currency: 'USD',
        // Report gas by default
        enabled: process.env.REPORT_GAS !== undefined ? !!process.env.REPORT_GAS : true,
    },
};

export default config;