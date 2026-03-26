// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

/// @notice bridgeIn method parameters
/// @param token Token address
/// @param amount Token amount
/// @param commission Commission is charged to the user
/// @param destinationChain Chain where we transfer tokens
/// @param destinationAddress Address where we transfer tokens on the chain mentioned above
/// @param deadline Timestamp until transaction is valid
/// @param nonce Parameter to avoid repeat transaction attack
struct FundsInParams {
    address token;
    uint256 amount;
    uint256 commission;
    string destinationChain;
    string destinationAddress;
    uint256 deadline;
    uint256 nonce;
    uint256 transactionId;
}

/// @notice bridgeIn method parameters
/// @param token Token address
/// @param amount Token amount
/// @param commission Commission is charged to the user
/// @param destinationChain Chain where we transfer tokens
/// @param destinationAddress Address where we transfer tokens on the chain mentioned above
/// @param deadline Timestamp until transaction is valid
/// @param nonce Parameter to avoid repeat transaction attack
struct FundsInCircleParams {
    address token;
    uint256 amount;
    uint256 commission;
    uint32 destinationChain;
    bytes32 destinationAddress;
    uint256 deadline;
    uint256 nonce;
    uint256 transactionId;
}

/// @notice bridgeInCoin method parameters
/// @param commission Commission is charged to the user
/// @param destinationChain Chain where we transfer tokens
/// @param destinationAddress Address where we transfer tokens on the chain mentioned above
/// @param deadline Timestamp until transaction is valid
/// @param nonce Parameter to avoid repeat transaction attack
struct FundsInNativeParams {
    uint256 commission;
    string destinationChain;
    string destinationAddress;
    uint256 deadline;
    uint256 nonce;
    uint256 transactionId;
}
