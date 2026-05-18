// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { Bridge } from '../../src/Bridge.sol';
import { CommissionManager } from '../../src/CommissionManager.sol';
import { MultisigProxy } from '../../src/MultisigProxy.sol';

/// @title DeployAll
/// @notice Full production flow:
///           1. Predict Bridge address (deployer nonce + 1).
///           2. Deploy CommissionManager with predicted Bridge as `bridgeAddress`.
///           3. Deploy Bridge with the already-deployed CommissionManager.
///           4. Deploy MultisigProxy owning both.
///           5. Transfer Bridge and CommissionManager ownership to MultisigProxy.
///
/// Env:
///   PRIVATE_KEY, USDT0_ADDRESS, BTC_RELAY_ADDRESS,
///   ENCLAVE_SIGNERS, ENCLAVE_THRESHOLD,
///   FEDERATION_SIGNERS, FEDERATION_THRESHOLD,
///   COMMISSION_RECIPIENT, TIMELOCK_DURATION
///
///   ETH_USD_FEED      — Optional Chainlink ETH/USD aggregator address. When
///                       supplied (non-zero) together with `ETH_USD_HEARTBEAT`
///                       it is wired in *before* CM ownership transfer, so the
///                       NATIVE-currency commission path is live the moment the
///                       proxy takes over. If omitted, NATIVE commission quotes
///                       revert `EthUsdFeedNotSet` until federation runs
///                       `proposeAdminExecuteCM(setEthUsdFeed(feed, hb))`.
///   ETH_USD_HEARTBEAT — Seconds before the feed answer is considered stale.
///
///
/// Usage:
///   forge script script/deploy/DeployAll.s.sol \
///     --rpc-url $RPC_URL --broadcast --verify
contract DeployAll is Script {
    function run()
        external
        returns (Bridge bridge, CommissionManager cm, MultisigProxy proxy)
    {
        uint256 pk             = vm.envUint('PRIVATE_KEY');
        address usdt0          = vm.envAddress('USDT0_ADDRESS');
        address btcRelay       = vm.envAddress('BTC_RELAY_ADDRESS');
        address[] memory enc   = vm.envAddress('ENCLAVE_SIGNERS', ',');
        uint256 encThr         = vm.envUint('ENCLAVE_THRESHOLD');
        address[] memory fed   = vm.envAddress('FEDERATION_SIGNERS', ',');
        uint256 fedThr         = vm.envUint('FEDERATION_THRESHOLD');
        address commission     = vm.envAddress('COMMISSION_RECIPIENT');
        uint256 timelock       = vm.envUint('TIMELOCK_DURATION');
        address ethUsdFeed     = vm.envOr('ETH_USD_FEED', address(0));
        uint256 ethUsdHb       = vm.envOr('ETH_USD_HEARTBEAT', uint256(0));

        address deployer = vm.addr(pk);
        uint64 currentNonce = vm.getNonce(deployer);

        // In this script the deployer sends tx in order:
        //   nonce  n   → CommissionManager
        //   nonce n+1  → Bridge
        //   nonce n+2  → MultisigProxy
        //   nonce n+3  → (optional) CommissionManager.setEthUsdFeed
        //   nonce n+4  → CommissionManager.transferOwnership
        //   nonce n+5  → Bridge.transferOwnership
        address predictedBridge = vm.computeCreateAddress(deployer, currentNonce + 1);

        vm.startBroadcast(pk);

        cm     = new CommissionManager(predictedBridge);
        bridge = new Bridge(usdt0, btcRelay, payable(address(cm)), address(0));
        proxy  = new MultisigProxy(
            address(bridge),
            address(cm),
            enc, encThr,
            fed, fedThr,
            commission,
            timelock
        );

        // Wire the Chainlink feed *before* the proxy takes over. After
        // ownership transfer the only way to change it is via federation
        // governance (`proposeAdminExecuteCM(setEthUsdFeed)`).
        if (ethUsdFeed != address(0)) {
            require(ethUsdHb != 0, 'ETH_USD_HEARTBEAT must be set when ETH_USD_FEED is provided');
            cm.setEthUsdFeed(ethUsdFeed, ethUsdHb);
        }

        cm.transferOwnership(address(proxy));
        bridge.transferOwnership(address(proxy));

        vm.stopBroadcast();

        console2.log('CommissionManager deployed at:', address(cm));
        console2.log('Bridge deployed at:           ', address(bridge));
        console2.log('MultisigProxy deployed at:    ', address(proxy));
        if (ethUsdFeed != address(0)) {
            console2.log('ETH/USD feed wired:           ', ethUsdFeed);
            console2.log('ETH/USD heartbeat (s):        ', ethUsdHb);
        } else {
            console2.log('ETH/USD feed:                 ', 'UNSET (NATIVE quotes will revert until governance wires one)');
        }

        require(address(bridge) == predictedBridge, 'Bridge address prediction mismatch');
        require(cm.bridgeAddress() == address(bridge), 'CM.bridgeAddress mismatch');
        require(bridge.owner() == address(proxy), 'Bridge ownership transfer failed');
        require(cm.owner()     == address(proxy), 'CM ownership transfer failed');
        if (ethUsdFeed != address(0)) {
            require(cm.ethUsdFeed() == ethUsdFeed, 'CM.ethUsdFeed mismatch');
            require(cm.ethUsdHeartbeat() == ethUsdHb, 'CM.ethUsdHeartbeat mismatch');
        }
    }
}
