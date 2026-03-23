//OK
// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract TestToken is ERC20 {
    constructor(uint256 initialSupply) ERC20('tUSDT Token', 'tUSDT') {
        _mint(msg.sender, initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
