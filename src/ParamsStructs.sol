// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

/// @notice fundsIn method parameters
/// @param token Token address
/// @param amount Token amount
/// @param destinationChain Chain where we transfer tokens
/// @param destinationAddress Address where we transfer tokens on the chain mentioned above
/// @param deadline Timestamp until transaction is valid
/// @param nonce Parameter to avoid repeat transaction attack
struct FundsInParams {
    address token;
    uint256 amount;
    string destinationChain;
    string destinationAddress;
    uint256 deadline;
    uint256 nonce;
    uint256 transactionId;
}
