// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { BaseBridge } from '../../src/BaseBridge.sol';

/// @title BaseBridgeFundsIn
/// @notice Approves and calls BaseBridge.fundsIn(amount, operationId) as the current signer.
///
/// Env:
///   PRIVATE_KEY, BASE_BRIDGE_ADDRESS, AMOUNT (wei), OPERATION_ID
contract BaseBridgeFundsIn is Script {
    function run() external {
        uint256 pk         = vm.envUint('PRIVATE_KEY');
        address bridgeAddr = vm.envAddress('BASE_BRIDGE_ADDRESS');
        uint256 amount     = vm.envUint('AMOUNT');
        uint256 opId       = vm.envUint('OPERATION_ID');

        BaseBridge bridge = BaseBridge(bridgeAddr);
        address token = bridge.token();

        vm.startBroadcast(pk);
        IERC20(token).approve(bridgeAddr, amount);
        bridge.fundsIn(amount, opId);
        vm.stopBroadcast();

        console2.log('fundsIn succeeded. Bridge balance:', IERC20(token).balanceOf(bridgeAddr));
    }
}
