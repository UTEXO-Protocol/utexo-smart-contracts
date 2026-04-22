// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { CommissionManager } from '../../src/CommissionManager.sol';

/// @title DeployCommissionManager
/// @notice Deploys CommissionManager for an already-known Bridge address.
///
/// Env:
///   PRIVATE_KEY     — deployer private key (becomes CM owner; transfer to multisig afterwards)
///   BRIDGE_ADDRESS  — Bridge contract that will send commissions (non-zero)
///
/// Usage:
///   forge script script/deploy/DeployCommissionManager.s.sol \
///     --rpc-url $RPC_URL --broadcast --verify
contract DeployCommissionManager is Script {
    function run() external returns (CommissionManager cm) {
        uint256 pk            = vm.envUint('PRIVATE_KEY');
        address bridgeAddress = vm.envAddress('BRIDGE_ADDRESS');

        vm.startBroadcast(pk);
        cm = new CommissionManager(bridgeAddress);
        vm.stopBroadcast();

        console2.log('CommissionManager deployed at:', address(cm));
        console2.log('Bridge address:               ', cm.bridgeAddress());
        console2.log('Owner (deployer):             ', cm.owner());
    }
}
