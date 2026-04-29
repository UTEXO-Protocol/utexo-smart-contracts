// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IBridge {
    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidDestinationAddress();
    error InvalidDestinationChain();
    error InvalidBtcRelayAddress();
    error InvalidCommissionManagerAddress();
    error InvalidSourceChainName();
    error DuplicateTransactionId();
    error BurnIdAlreadyConsumed(uint256 burnId);
    error FundsInNotFound(uint256 transactionId);
    error FundsOutAmountExceedsFundsIn();
    error NativeCommissionNotAllowedOnFundsOut();
    error NativeValueMismatch();

    // =========================================================================
    // Events
    // =========================================================================

    /// @param sender             Address that deposited the tokens.
    /// @param transactionId      Backend-assigned transaction identifier.
    /// @param nonce              Caller-provided nonce (for backend correlation).
    /// @param amount             Gross amount the user supplied (pre-commission).
    /// @param netAmount          Amount actually bridged after token commission is taken.
    /// @param tokenCommission    Fee charged in the bridged token (deducted from `amount`).
    /// @param nativeCommission   Fee charged in native wei (paid via `msg.value`).
    /// @param destinationChain   Target chain identifier (e.g. "rgb").
    /// @param destinationAddress Target address on the destination chain.
    event BridgeFundsIn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        uint256 amount,
        uint256 netAmount,
        uint256 tokenCommission,
        uint256 nativeCommission,
        string  destinationChain,
        string  destinationAddress
    );

    /// @param recipient        Recipient on this chain.
    /// @param amount           Gross amount released from the bridge pool (pre-commission).
    /// @param netAmount        Amount actually delivered to `recipient`.
    /// @param tokenCommission  Fee taken in the bridged token (sent to the CommissionManager).
    /// @param transactionId    Backend-assigned transaction identifier.
    /// @param burnId           Identifier extracted from the burn consignment on the
    ///                         source side. Stored on-chain to block fundsOut replays.
    /// @param sourceChain      Source chain identifier.
    /// @param destChain        Destination chain identifier (used for commission routing).
    /// @param sourceAddress    Sender address on the source chain.
    /// @param blockHeight      Bitcoin block height verified via BtcRelay.
    /// @param commitmentHash   Bitcoin block commitment hash verified via BtcRelay.
    event BridgeFundsOut(
        address indexed recipient,
        uint256 amount,
        uint256 netAmount,
        uint256 tokenCommission,
        uint256 transactionId,
        uint256 burnId,
        string  sourceChain,
        string  destChain,
        string  sourceAddress,
        uint256 blockHeight,
        bytes32 commitmentHash
    );

    // =========================================================================
    // External — user-facing
    // =========================================================================

    /// @notice Lock USDT0 in the bridge to initiate a transfer to another chain.
    /// @dev Payable: if the active route uses NATIVE commission currency, `msg.value`
    ///      must equal the quoted native commission; otherwise `msg.value` must be 0.
    function fundsIn(
        uint256 amount,
        string  calldata destinationChain,
        string  calldata destinationAddress,
        uint256 nonce,
        uint256 transactionId
    ) external payable;

    // =========================================================================
    // External — owner-only (called via MultisigProxy.execute)
    // =========================================================================

    /// @notice Release tokens to a recipient. Verifies the Bitcoin block header
    ///         is known to BtcRelay and that the referenced fundsIn operations
    ///         exist on-chain before releasing.
    ///         Only callable by owner (MultisigProxy via execute()).
    /// @dev `destChain` is part of the CommissionManager route key and lets the
    ///      same Bridge serve multi-hop routes (e.g. BTC→Arbitrum→ETH via LayerZero).
    /// @dev `burnId` is the identifier the backend extracts from the burn
    ///      consignment on the source side. The contract records it on success
    ///      and rejects any future call referencing the same `burnId` — this is
    ///      the on-chain replay guard for fundsOut.
    function fundsOut(
        address recipient,
        uint256 amount,
        uint256 transactionId,
        uint256 burnId,
        string  calldata sourceChain,
        string  calldata destChain,
        string  calldata sourceAddress,
        uint256 blockHeight,
        bytes32 commitmentHash,
        uint256[] calldata fundsInIds
    ) external;

    /// @notice Permanently blocked — ownership cannot be renounced.
    function renounceOwnership() external view;
}
