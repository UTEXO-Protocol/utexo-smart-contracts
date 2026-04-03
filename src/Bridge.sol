// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IBridge} from "./interfaces/IBridge.sol";
import {FundsInParams} from "./ParamsStructs.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Bridge is IBridge, Ownable {
    using SafeERC20 for IERC20;

    mapping(uint256 => bool) private _usedNonces;
    mapping(address => bool) private _supportedTokens;

    constructor(address[] memory supportedTokens_) Ownable(msg.sender) {
        for (uint256 i = 0; i < supportedTokens_.length; i++) {
            if (supportedTokens_[i] == address(0)) {
                revert InvalidTokenAddress();
            }

            _supportedTokens[supportedTokens_[i]] = true;
        }
    }

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    /// @dev Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(FundsInParams calldata params) external {
        _fundsInCommonOperations(params);

        IERC20(params.token).safeTransferFrom(_msgSender(), address(this), params.amount);

        emit FundsIn(
            _msgSender(),
            params.transactionId,
            params.nonce,
            params.token,
            params.amount,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Withdraw tokens from the bridge. Can be initiated only by the owner
    /// @param token Token address
    /// @param recipient Recipient address
    /// @param amount Token amount
    /// @param transactionId ID of the transaction - helper parameter
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    function fundsOut(
        address token,
        address recipient,
        uint256 amount,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external onlyOwner {
        _fundsOutVerify(token, recipient, amount);

        IERC20(token).safeTransfer(recipient, amount);

        emit FundsOut(recipient, token, amount, transactionId, sourceChain, sourceAddress);
    }

    // =========================================================================
    // Internal — fundsIn common operations
    // =========================================================================

    /// @notice Performs common validations and operations for `fundsIn` function
    function _fundsInCommonOperations(FundsInParams calldata params) private {
        if (!_supportedTokens[params.token]) {
            revert InvalidTokenAddress();
        }

        if (bytes(params.destinationAddress).length == 0) {
            revert InvalidDestinationAddress();
        }

        if (bytes(params.destinationChain).length == 0) {
            revert InvalidDestinationChain();
        }

        if (block.timestamp > params.deadline) {
            revert ExpiredDeadline();
        }

        _usedNonces[params.nonce] = true;
    }

    // =========================================================================
    // Internal — fundsOut verification
    // =========================================================================

    function _fundsOutVerify(address token, address recipient, uint256 amount) private view {
        if (recipient == address(0)) {
            revert InvalidRecipientAddress();
        }

        if (token == address(0)) {
            revert InvalidTokenAddress();
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) {
            revert AmountExceedTokenBalance();
        }
    }
}
