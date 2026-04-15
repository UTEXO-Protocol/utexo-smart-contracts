// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { Bridge } from '../../src/Bridge.sol';

/// @title BridgeFundsIn
/// @notice Approves and calls Bridge.fundsIn() as the current signer. Useful for
///         manual testing against a deployed Bridge.
///
/// Env:
///   PRIVATE_KEY, BRIDGE_ADDRESS, AMOUNT (wei),
///   DESTINATION_CHAIN, DESTINATION_ADDRESS, OP_NONCE, TX_ID
contract BridgeFundsIn is Script {
    function run() external {
        uint256 pk           = vm.envUint('PRIVATE_KEY');
        address bridgeAddr   = vm.envAddress('BRIDGE_ADDRESS');
        uint256 amount       = vm.envUint('AMOUNT');
        string memory dChain = vm.envString('DESTINATION_CHAIN');
        string memory dAddr  = vm.envString('DESTINATION_ADDRESS');
        uint256 opNonce      = vm.envUint('OP_NONCE');
        uint256 txId         = vm.envUint('TX_ID');

        Bridge bridge = Bridge(bridgeAddr);
        address token = bridge.token();

        vm.startBroadcast(pk);
        IERC20(token).approve(bridgeAddr, amount);
        bridge.fundsIn(amount, dChain, dAddr, opNonce, txId);
        vm.stopBroadcast();

        console2.log('fundsIn succeeded. Bridge balance:', IERC20(token).balanceOf(bridgeAddr));
    }
}
