// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMultisigProxy
/// @notice Two-level ECDSA multisig proxy that owns the Bridge.
///
/// @dev ENCLAVE SIGNERS (TEE / Nitro Enclave)
///      Authorise routine bridge value-transfer operations via `execute()`.
///      Restricted to a configurable allowlist of Bridge function selectors.
///      Uses per-selector nonces.
///
///      FEDERATION SIGNERS (governance / admin nodes)
///      All administrative operations go through a two-phase timelock:
///        Phase 1 — PROPOSE: federation signs, contract stores hash, emits full data.
///        Phase 2 — EXECUTE: after timelockDuration, anyone can call executeProposal().
///      Exception: emergencyPause / emergencyUnpause are instant (no timelock).
///
///      BITMAP ENCODING
///      Bit i of bitmap corresponds to signers[i]. sigs[] in ascending bit order.
///
///      EIP-712 DOMAIN
///      name: "MultisigProxy"  version: "1"  chainId  verifyingContract
interface IMultisigProxy {

    // =========================================================================
    // Types
    // =========================================================================

    enum OperationType {
        AdminExecute,
        UpdateEnclaveSigners,
        UpdateFederationSigners,
        UpdateBridge,
        SetCommissionRecipient,
        SetTeeAllowedSelector,
        WithdrawCommission,
        WithdrawNativeCommission,
        SetTimelockDuration
    }

    enum ProposalStatus { None, Pending, Executed, Cancelled }

    struct Proposal {
        bytes32 dataHash;
        uint256 proposedAt;
        uint256 deadline;
        OperationType opType;
        ProposalStatus status;
    }

    // =========================================================================
    // Events
    // =========================================================================

    // TEE
    event Executed(bytes4 indexed selector, uint256 nonce, uint256 enclaveBitmap);

    // Federation proposals
    event ProposalCreated(
        bytes32 indexed proposalId,
        OperationType indexed opType,
        bytes operationData,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap
    );
    event ProposalCancelled(bytes32 indexed proposalId);
    event ProposalExecuted(bytes32 indexed proposalId, OperationType indexed opType);

    // Federation emergency
    event EmergencyPaused(uint256 nonce, uint256 fedBitmap);
    event EmergencyUnpaused(uint256 nonce, uint256 fedBitmap);

    // Emitted when proposals are executed
    event EnclaveSignersUpdated(address[] newSigners, uint256 newThreshold);
    event FederationSignersUpdated(address[] newSigners, uint256 newThreshold);
    event BridgeAddressUpdated(address indexed oldBridge, address indexed newBridge);
    event CommissionRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TeeAllowedSelectorUpdated(bytes4 indexed selector, bool allowed);
    event CommissionWithdrawn(address indexed token, uint256 amount, address indexed recipient);
    event NativeCommissionWithdrawn(uint256 amount, address indexed recipient);
    event TimelockDurationUpdated(uint256 newDuration);

    // =========================================================================
    // TEE-authorized
    // =========================================================================

    /// @notice Execute a Bridge call authorised by M-of-N enclave signatures.
    ///         Selector must be in the TEE allowlist. Per-selector nonces.
    function execute(
        bytes calldata callData,
        uint256 nonce,
        uint256 deadline,
        uint256 enclaveBitmap,
        bytes[] calldata enclaveSigs
    ) external;

    // =========================================================================
    // Federation instant (no timelock)
    // =========================================================================

    /// @notice Emergency pause the Bridge. Instant, no timelock.
    function emergencyPause(
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external;

    /// @notice Emergency unpause the Bridge. Instant, no timelock.
    function emergencyUnpause(
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external;

    // =========================================================================
    // Federation propose (Phase 1 — timelock)
    // =========================================================================

    /// @notice Propose an arbitrary Bridge call (forwarded via bridge.call).
    /// @dev opData = raw ABI-encoded bridge callData (selector + args).
    function proposeAdminExecute(
        bytes calldata callData,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose replacing the enclave signer set.
    /// @dev opData = abi.encode(address[] newSigners, uint256 newThreshold)
    function proposeUpdateEnclaveSigners(
        address[] calldata newSigners,
        uint256 newThreshold,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose replacing the federation signer set.
    /// @dev opData = abi.encode(address[] newSigners, uint256 newThreshold)
    function proposeUpdateFederationSigners(
        address[] calldata newSigners,
        uint256 newThreshold,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose updating the Bridge address.
    /// @dev opData = abi.encode(address newBridge)
    function proposeUpdateBridge(
        address newBridge,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose changing the commission recipient.
    /// @dev opData = abi.encode(address newRecipient)
    function proposeSetCommissionRecipient(
        address newRecipient,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose adding/removing a TEE-allowed selector.
    /// @dev opData = abi.encode(bytes4 selector, bool allowed)
    function proposeSetTeeAllowedSelector(
        bytes4 selector,
        bool allowed,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose ERC-20 commission withdrawal.
    /// @dev opData = abi.encode(address token, uint256 amount)
    function proposeWithdrawCommission(
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose native commission withdrawal.
    /// @dev opData = abi.encode(uint256 amount)
    function proposeWithdrawNativeCommission(
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    /// @notice Propose changing the timelock duration.
    /// @dev opData = abi.encode(uint256 newDuration)
    function proposeSetTimelockDuration(
        uint256 newDuration,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32);

    // =========================================================================
    // Cancel & Execute
    // =========================================================================

    /// @notice Cancel a pending proposal. Requires M-of-N federation signatures.
    function cancelProposal(
        bytes32 proposalId,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external;

    /// @notice Execute a proposal after the timelock has elapsed. Permissionless.
    /// @param proposalId The proposal to execute.
    /// @param opData     The same operation data that was provided at propose time.
    function executeProposal(bytes32 proposalId, bytes calldata opData) external;

    // =========================================================================
    // View
    // =========================================================================

    function getNonce(bytes4 selector) external view returns (uint256);
    function bridge() external view returns (address);
    function getEnclaveSigners() external view returns (address[] memory);
    function enclaveThreshold() external view returns (uint256);
    function getFederationSigners() external view returns (address[] memory);
    function federationThreshold() external view returns (uint256);
    function commissionRecipient() external view returns (address);
    function teeAllowedSelectors(bytes4 selector) external view returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function proposalNonce() external view returns (uint256);
    function timelockDuration() external view returns (uint256);
    function getProposal(bytes32 proposalId) external view returns (Proposal memory);
}
