// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { Bridge } from '../../src/Bridge.sol';
import { MultisigProxy } from '../../src/MultisigProxy.sol';

/// @title DeployAll
/// @notice Full production flow: deploy Bridge → deploy MultisigProxy → transfer Bridge ownership.
///
/// Env (same set as individual scripts, minus BRIDGE_ADDRESS):
///   PRIVATE_KEY, USDT0_ADDRESS, BTC_RELAY_ADDRESS, ENCLAVE_SIGNERS, ENCLAVE_THRESHOLD,
///   FEDERATION_SIGNERS, FEDERATION_THRESHOLD, COMMISSION_RECIPIENT, TIMELOCK_DURATION
///
/// Usage:
///   forge script script/deploy/DeployAll.s.sol \
///     --rpc-url $RPC_URL --broadcast --verify
contract DeployAll is Script {
    function run() external returns (Bridge bridge, MultisigProxy proxy) {
        uint256 pk          = vm.envUint('PRIVATE_KEY');
        address usdt0       = vm.envAddress('USDT0_ADDRESS');
        address btcRelay    = vm.envAddress('BTC_RELAY_ADDRESS');
        address[] memory enc = vm.envAddress('ENCLAVE_SIGNERS', ',');
        uint256 encThr      = vm.envUint('ENCLAVE_THRESHOLD');
        address[] memory fed = vm.envAddress('FEDERATION_SIGNERS', ',');
        uint256 fedThr      = vm.envUint('FEDERATION_THRESHOLD');
        address commission  = vm.envAddress('COMMISSION_RECIPIENT');
        uint256 timelock    = vm.envUint('TIMELOCK_DURATION');

        vm.startBroadcast(pk);

        bridge = new Bridge(usdt0, btcRelay);
        proxy  = new MultisigProxy(
            address(bridge),
            enc, encThr,
            fed, fedThr,
            commission,
            timelock
        );
        bridge.transferOwnership(address(proxy));

        vm.stopBroadcast();

        console2.log('Bridge deployed at:       ', address(bridge));
        console2.log('MultisigProxy deployed at:', address(proxy));
        console2.log('Bridge owner:             ', bridge.owner());
        require(bridge.owner() == address(proxy), 'Ownership transfer failed');
    }
}
