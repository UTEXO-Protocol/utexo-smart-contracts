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
struct BridgeInParams {
    address token;
    uint256 amount;
    uint256 commission;
    string destinationChain;
    string destinationAddress;
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
struct BridgeInNativeParams {
    uint256 commission;
    string destinationChain;
    string destinationAddress;
    uint256 deadline;
    uint256 nonce;
    uint256 transactionId;
}

/// @notice bridgeIn method parameters
/// @param token Token address
/// @param tokenId Token Id
/// @param amount Token amount
/// @param gasCommission Commission which is calculated in transferred token.
/// @param destinationChain Chain where we transfer tokens
/// @param destinationAddress Address where we transfer tokens on the chain mentioned above
/// @param deadline Timestamp until transaction is valid
/// @param nonce Parameter to avoid repeat transaction attack
struct BridgeInERC1155Params {
    address token;
    uint256 tokenId;
    uint256 amount;
    uint256 gasCommission;
    string destinationChain;
    string destinationAddress;
    uint256 deadline;
    uint256 nonce;
    uint256 transactionId;
}
