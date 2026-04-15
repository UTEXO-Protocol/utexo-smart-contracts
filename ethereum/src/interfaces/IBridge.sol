// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IBridge {
    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidDestinationAddress();
    error InvalidDestinationChain();

    // =========================================================================
    // Events
    // =========================================================================

    /// @param sender             Address that deposited the tokens.
    /// @param transactionId      Backend-assigned transaction identifier.
    /// @param nonce              Caller-provided nonce (for backend correlation).
    /// @param amount             Amount deposited.
    /// @param destinationChain   Target chain identifier (e.g. "rgb").
    /// @param destinationAddress Target address on the destination chain.
    event BridgeFundsIn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        uint256 amount,
        string  destinationChain,
        string  destinationAddress
    );

    /// @param recipient        Recipient on this chain.
    /// @param amount           Amount transferred to recipient.
    /// @param transactionId    Backend-assigned transaction identifier.
    /// @param sourceChain      Source chain identifier.
    /// @param sourceAddress    Sender address on the source chain.
    event BridgeFundsOut(
        address indexed recipient,
        uint256 amount,
        uint256 transactionId,
        string  sourceChain,
        string  sourceAddress
    );

    // =========================================================================
    // External — user-facing
    // =========================================================================

    /// @notice Lock USDT0 in the bridge to initiate a transfer to another chain.
    function fundsIn(
        uint256 amount,
        string  calldata destinationChain,
        string  calldata destinationAddress,
        uint256 nonce,
        uint256 transactionId
    ) external;

    // =========================================================================
    // External — owner-only (called via MultisigProxy.execute)
    // =========================================================================

    /// @notice Release tokens to a recipient.
    ///         Only callable by owner (MultisigProxy via execute()).
    function fundsOut(
        address token,
        address recipient,
        uint256 amount,
        uint256 transactionId,
        string  calldata sourceChain,
        string  calldata sourceAddress
    ) external;

    /// @notice Permanently blocked — ownership cannot be renounced.
    function renounceOwnership() external view;
}
