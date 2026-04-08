// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { FundsInParams } from '../ParamsStructs.sol';

interface IBridge {
    // =========================================================================
    // Errors
    // =========================================================================

    error AlreadyUsedSignature();
    error ExpiredSignature();
    error AmountExceedBridgePool();
    error InvalidRecipientAddress();
    error InvalidTokenAddress();
    error InvalidDestinationAddress();
    error InvalidDestinationChain();
    error InvalidSignature();
    error RenounceOwnershipBlocked();

    // =========================================================================
    // Events
    // =========================================================================

    /// @param sender Address who deposit tokens to the bridge
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param token Token we deposit to the bridge
    /// @param amount Amount of this token
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event BridgeFundsIn(
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
    event BridgeFundsOut(
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external;

    /// @notice Withdraw tokens from the bridge. Can be initiated only by the owner
    function fundsOut(
        address token,
        address recipient,
        uint256 amount,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external;

    /// @notice Stop all contract functionality allowed to the user
    function pause() external;

    /// @notice Resume all contract functionality allowed to the user
    function unpause() external;

    /// @notice Block renounce ownership functionality
    function renounceOwnership() external view;

    /// @notice Get chain id
    function getChainId() external view returns (uint256);

    /// @notice Get balance on the current contract
    function getContractBalance() external view returns (uint256);
}
