// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import {FundsInParams} from "../ParamsStructs.sol";

interface IBridge {
    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidRecipientAddress();
    error InvalidTokenAddress();
    error AmountExceedTokenBalance();
    error ExpiredDeadline();
    error InvalidDestinationAddress();
    error InvalidDestinationChain();

    // =========================================================================
    // Events
    // =========================================================================

    /// @param sender Address who deposit tokens to the bridge
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param token Token we deposit to the bridge
    /// @param amount Amount of this token
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event FundsIn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        address token,
        uint256 amount,
        string destinationChain,
        string destinationAddress
    );

    /// @param recipient Recipient of the tokens
    /// @param token Token we fund out from the bridge
    /// @param amount Amount of this token
    /// @param transactionId Helper parameter to track
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    event FundsOut(
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );

    /// @notice Deposit tokens on the bridge
    /// @param params Parameters for the fundsIn transaction
    function fundsIn(FundsInParams calldata params) external;

    /// @notice Withdraw tokens from the bridge
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
    ) external;
}
