// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { BaseBridge } from '../../src/BaseBridge.sol';

/// @title BaseBridgeFundsOut
/// @notice Calls BaseBridge.fundsOut() as the current signer (must be owner).
///
/// Env:
///   PRIVATE_KEY, BASE_BRIDGE_ADDRESS, RECIPIENT,
///   AMOUNT (wei), OPERATION_ID, SOURCE_ADDRESS
contract BaseBridgeFundsOut is Script {
    function run() external {
        uint256 pk           = vm.envUint('PRIVATE_KEY');
        address bridgeAddr   = vm.envAddress('BASE_BRIDGE_ADDRESS');
        address recipient    = vm.envAddress('RECIPIENT');
        uint256 amount       = vm.envUint('AMOUNT');
        uint256 opId         = vm.envUint('OPERATION_ID');
        string memory srcAddr = vm.envString('SOURCE_ADDRESS');

        BaseBridge bridge = BaseBridge(bridgeAddr);

        vm.startBroadcast(pk);
        bridge.fundsOut(recipient, amount, opId, srcAddr);
        vm.stopBroadcast();

        console2.log('fundsOut succeeded. Released to:', recipient);
    }
}
