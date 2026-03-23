// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

contract MockContractV2 {
    event CreateString(
        address indexed from,
        uint256 paddingStart,
        string value,
        uint256 paddingEnd
    );

    function emitStringNoParam() external {
        emit CreateString(msg.sender, 1000, 'Emited hardcoded string', 2000);
    }

    function emitString(string memory value) external {
        emit CreateString(msg.sender, 1000, value, 2000);
    }

    function version() public pure returns (uint256) {
        return 2;
    }
}
