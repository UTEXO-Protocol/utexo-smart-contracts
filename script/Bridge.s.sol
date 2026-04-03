// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Bridge} from "../src/Bridge.sol";

contract BridgeScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Parse comma-separated token addresses, e.g. "0xAbc...,0xDef..."
        address[] memory supportedTokens = vm.envAddress("SUPPORTED_TOKENS", ",");

        console.log("Deployer:         ", vm.addr(deployerPrivateKey));
        console.log("Supported tokens: ", supportedTokens.length);
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            console.log("  Token[%d]: %s", i, supportedTokens[i]);
        }

        vm.startBroadcast(deployerPrivateKey);

        Bridge bridge = new Bridge(supportedTokens);

        vm.stopBroadcast();

        console.log("Bridge deployed at:", address(bridge));
    }
}
