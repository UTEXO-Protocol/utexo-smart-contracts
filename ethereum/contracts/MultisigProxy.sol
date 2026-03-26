// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { IMultisigProxy } from './interfaces/IMultisigProxy.sol';

contract MultisigProxy is IMultisigProxy {
    using ECDSA for bytes32;

    // =========================================================================
    // State
    // =========================================================================

    address public bridge;

    address[] private _enclaveSigners;
    uint256 public enclaveThreshold;

    address[] private _federationSigners;
    uint256 public federationThreshold;

    address public commissionRecipient;

    /// @notice Per-selector nonce for TEE execute() calls.
    mapping(bytes4 => uint256) public nonces;

    /// @notice Allowed Bridge function selectors for TEE execute().
    mapping(bytes4 => bool) public teeAllowedSelectors;

    /// @notice Federation proposals.
    mapping(bytes32 => Proposal) private _proposals;

    /// @notice Sequential nonce for all federation operations (propose, cancel, emergency).
    uint256 public proposalNonce;

    /// @notice Minimum delay (seconds) between proposal creation and execution.
    uint256 public timelockDuration;

    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Maximum allowed time between proposal creation and its deadline.
    uint256 public constant MAX_PROPOSAL_LIFETIME = 30 days;

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
    );

    // TEE
    bytes32 private constant _BRIDGE_OP_TYPEHASH = keccak256(
        'BridgeOperation(bytes4 selector,bytes callData,uint256 nonce,uint256 deadline)'
    );

    // Federation propose — typed EIP-712 structs per operation
    bytes32 private constant _PROPOSE_ADMIN_EXECUTE_TYPEHASH = keccak256(
        'ProposeAdminExecute(bytes4 selector,bytes callData,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_UPDATE_ENCLAVE_SIGNERS_TYPEHASH = keccak256(
        'ProposeUpdateEnclaveSigners(address[] newSigners,uint256 newThreshold,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_UPDATE_FEDERATION_SIGNERS_TYPEHASH = keccak256(
        'ProposeUpdateFederationSigners(address[] newSigners,uint256 newThreshold,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_UPDATE_BRIDGE_TYPEHASH = keccak256(
        'ProposeUpdateBridge(address newBridge,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_SET_COMMISSION_RECIPIENT_TYPEHASH = keccak256(
        'ProposeSetCommissionRecipient(address newRecipient,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_SET_TEE_SELECTOR_TYPEHASH = keccak256(
        'ProposeSetTeeAllowedSelector(bytes4 selector,bool allowed,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_WITHDRAW_COMMISSION_TYPEHASH = keccak256(
        'ProposeWithdrawCommission(address token,uint256 amount,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_WITHDRAW_NATIVE_COMMISSION_TYPEHASH = keccak256(
        'ProposeWithdrawNativeCommission(uint256 amount,uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _PROPOSE_SET_TIMELOCK_DURATION_TYPEHASH = keccak256(
        'ProposeSetTimelockDuration(uint256 newDuration,uint256 nonce,uint256 deadline)'
    );

    // Cancel
    bytes32 private constant _CANCEL_PROPOSAL_TYPEHASH = keccak256(
        'CancelProposal(bytes32 proposalId,uint256 nonce,uint256 deadline)'
    );

    // Emergency
    bytes32 private constant _EMERGENCY_PAUSE_TYPEHASH = keccak256(
        'EmergencyPause(uint256 nonce,uint256 deadline)'
    );
    bytes32 private constant _EMERGENCY_UNPAUSE_TYPEHASH = keccak256(
        'EmergencyUnpause(uint256 nonce,uint256 deadline)'
    );

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(
        address bridge_,
        address[] memory enclaveSigners_,
        uint256 enclaveThreshold_,
        address[] memory federationSigners_,
        uint256 federationThreshold_,
        address commissionRecipient_,
        uint256 timelockDuration_
    ) {
        if (bridge_ == address(0)) revert ZeroBridge();
        if (enclaveSigners_.length == 0) revert NoSigners();
        if (enclaveThreshold_ == 0 || enclaveThreshold_ > enclaveSigners_.length) revert InvalidThreshold();
        if (federationSigners_.length == 0) revert NoSigners();
        if (federationThreshold_ == 0 || federationThreshold_ > federationSigners_.length) revert InvalidThreshold();
        if (commissionRecipient_ == address(0)) revert ZeroCommissionRecipient();
        if (timelockDuration_ >= MAX_PROPOSAL_LIFETIME) revert TimelockTooLong();

        _validateSigners(enclaveSigners_);
        _validateSigners(federationSigners_);

        bridge = bridge_;
        _enclaveSigners = enclaveSigners_;
        enclaveThreshold = enclaveThreshold_;
        _federationSigners = federationSigners_;
        federationThreshold = federationThreshold_;
        commissionRecipient = commissionRecipient_;
        timelockDuration = timelockDuration_;

        // Default TEE allowlist
        teeAllowedSelectors[bytes4(keccak256('fundsOut(address,address,uint256,uint256,uint256,string,string)'))] = true;
        teeAllowedSelectors[bytes4(keccak256('fundsOutMint(address,address,uint256,uint256,uint256,string,string)'))] = true;
        teeAllowedSelectors[bytes4(keccak256('fundsOutNative(address,uint256,uint256,uint256,string,string)'))] = true;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            _DOMAIN_TYPEHASH,
            keccak256('MultisigProxy'),
            keccak256('1'),
            block.chainid,
            address(this)
        ));
    }

    // =========================================================================
    // TEE-authorized
    // =========================================================================

    /// @inheritdoc IMultisigProxy
    function execute(
        bytes calldata callData,
        uint256 nonce,
        uint256 deadline,
        uint256 enclaveBitmap,
        bytes[] calldata enclaveSigs
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (callData.length < 4) revert CallDataTooShort();

        bytes4 selector;
        assembly { selector := calldataload(callData.offset) }

        if (!teeAllowedSelectors[selector]) revert SelectorNotAllowed();
        if (nonce != nonces[selector]) revert InvalidNonce();

        bytes32 digest = _buildDigest(_BRIDGE_OP_TYPEHASH, selector, callData, nonce, deadline);
        _verifySignatures(digest, enclaveBitmap, enclaveSigs, _enclaveSigners, enclaveThreshold);

        nonces[selector]++;

        (bool ok, bytes memory ret) = bridge.call(callData);
        _propagateRevert(ok, ret);

        emit Executed(selector, nonce, enclaveBitmap);
    }

    // =========================================================================
    // Federation instant (emergency, no timelock)
    // =========================================================================

    /// @inheritdoc IMultisigProxy
    function emergencyPause(
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (nonce != proposalNonce) revert InvalidNonce();

        bytes32 digest = _hashTypedData(
            keccak256(abi.encode(_EMERGENCY_PAUSE_TYPEHASH, nonce, deadline))
        );
        _verifySignatures(digest, fedBitmap, fedSigs, _federationSigners, federationThreshold);

        proposalNonce++;

        (bool ok, bytes memory ret) = bridge.call(abi.encodeWithSignature('pause()'));
        _propagateRevert(ok, ret);

        emit EmergencyPaused(nonce, fedBitmap);
    }

    /// @inheritdoc IMultisigProxy
    function emergencyUnpause(
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (nonce != proposalNonce) revert InvalidNonce();

        bytes32 digest = _hashTypedData(
            keccak256(abi.encode(_EMERGENCY_UNPAUSE_TYPEHASH, nonce, deadline))
        );
        _verifySignatures(digest, fedBitmap, fedSigs, _federationSigners, federationThreshold);

        proposalNonce++;

        (bool ok, bytes memory ret) = bridge.call(abi.encodeWithSignature('unpause()'));
        _propagateRevert(ok, ret);

        emit EmergencyUnpaused(nonce, fedBitmap);
    }

    // =========================================================================
    // Federation propose (Phase 1)
    // =========================================================================

    /// @inheritdoc IMultisigProxy
    function proposeAdminExecute(
        bytes calldata callData,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        if (callData.length < 4) revert CallDataTooShort();

        bytes4 selector;
        assembly { selector := calldataload(callData.offset) }

        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_ADMIN_EXECUTE_TYPEHASH, selector, keccak256(callData), nonce, deadline
        ));

        // opData for AdminExecute = raw bridge callData
        return _propose(OperationType.AdminExecute, callData, nonce, deadline, structHash, fedBitmap, fedSigs);
    }

    /// @inheritdoc IMultisigProxy
    function proposeUpdateEnclaveSigners(
        address[] calldata newSigners,
        uint256 newThreshold,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_UPDATE_ENCLAVE_SIGNERS_TYPEHASH,
            _hashAddressArray(newSigners), newThreshold, nonce, deadline
        ));

        return _propose(
            OperationType.UpdateEnclaveSigners,
            abi.encode(newSigners, newThreshold),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeUpdateFederationSigners(
        address[] calldata newSigners,
        uint256 newThreshold,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_UPDATE_FEDERATION_SIGNERS_TYPEHASH,
            _hashAddressArray(newSigners), newThreshold, nonce, deadline
        ));

        return _propose(
            OperationType.UpdateFederationSigners,
            abi.encode(newSigners, newThreshold),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeUpdateBridge(
        address newBridge,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_UPDATE_BRIDGE_TYPEHASH, newBridge, nonce, deadline
        ));

        return _propose(
            OperationType.UpdateBridge,
            abi.encode(newBridge),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeSetCommissionRecipient(
        address newRecipient,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_SET_COMMISSION_RECIPIENT_TYPEHASH, newRecipient, nonce, deadline
        ));

        return _propose(
            OperationType.SetCommissionRecipient,
            abi.encode(newRecipient),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeSetTeeAllowedSelector(
        bytes4 selector,
        bool allowed,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_SET_TEE_SELECTOR_TYPEHASH, selector, allowed, nonce, deadline
        ));

        return _propose(
            OperationType.SetTeeAllowedSelector,
            abi.encode(selector, allowed),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeWithdrawCommission(
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_WITHDRAW_COMMISSION_TYPEHASH, token, amount, nonce, deadline
        ));

        return _propose(
            OperationType.WithdrawCommission,
            abi.encode(token, amount),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeWithdrawNativeCommission(
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_WITHDRAW_NATIVE_COMMISSION_TYPEHASH, amount, nonce, deadline
        ));

        return _propose(
            OperationType.WithdrawNativeCommission,
            abi.encode(amount),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    /// @inheritdoc IMultisigProxy
    function proposeSetTimelockDuration(
        uint256 newDuration,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            _PROPOSE_SET_TIMELOCK_DURATION_TYPEHASH, newDuration, nonce, deadline
        ));

        return _propose(
            OperationType.SetTimelockDuration,
            abi.encode(newDuration),
            nonce, deadline, structHash, fedBitmap, fedSigs
        );
    }

    // =========================================================================
    // Cancel
    // =========================================================================

    /// @inheritdoc IMultisigProxy
    function cancelProposal(
        bytes32 proposalId,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (nonce != proposalNonce) revert InvalidNonce();

        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Pending) revert NotPending();

        bytes32 digest = _hashTypedData(
            keccak256(abi.encode(_CANCEL_PROPOSAL_TYPEHASH, proposalId, nonce, deadline))
        );
        _verifySignatures(digest, fedBitmap, fedSigs, _federationSigners, federationThreshold);

        proposalNonce++;
        p.status = ProposalStatus.Cancelled;

        emit ProposalCancelled(proposalId);
    }

    // =========================================================================
    // Execute (Phase 2 — permissionless after timelock)
    // =========================================================================

    /// @inheritdoc IMultisigProxy
    function executeProposal(bytes32 proposalId, bytes calldata opData) external {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Pending) revert NotPending();
        if (block.timestamp < p.proposedAt + timelockDuration) revert TimelockActive();
        if (block.timestamp > p.deadline) revert ProposalExpired();
        if (keccak256(opData) != p.dataHash) revert DataMismatch();

        p.status = ProposalStatus.Executed;

        _executeByType(p.opType, opData);

        emit ProposalExecuted(proposalId, p.opType);
    }

    // =========================================================================
    // View
    // =========================================================================

    /// @inheritdoc IMultisigProxy
    function verifyEnclaveSignature(
        bytes32 digest,
        bytes calldata signature,
        uint256 signerIndex
    ) external view returns (bool) {
        if (signerIndex >= _enclaveSigners.length) revert IndexOutOfRange();
        address recovered = ECDSA.recover(digest, signature);
        return recovered == _enclaveSigners[signerIndex];
    }

    /// @inheritdoc IMultisigProxy
    function getNonce(bytes4 selector) external view returns (uint256) {
        return nonces[selector];
    }

    /// @inheritdoc IMultisigProxy
    function getEnclaveSigners() external view returns (address[] memory) {
        return _enclaveSigners;
    }

    /// @inheritdoc IMultisigProxy
    function getFederationSigners() external view returns (address[] memory) {
        return _federationSigners;
    }

    /// @inheritdoc IMultisigProxy
    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    // =========================================================================
    // Internal — propose helper
    // =========================================================================

    /// @dev Common logic for all propose functions.
    function _propose(
        OperationType opType,
        bytes memory opData,
        uint256 nonce,
        uint256 deadline,
        bytes32 structHash,
        uint256 fedBitmap,
        bytes[] calldata fedSigs
    ) private returns (bytes32 proposalId) {
        if (block.timestamp > deadline) revert Expired();
        if (deadline > block.timestamp + MAX_PROPOSAL_LIFETIME) revert DeadlineTooFar();
        if (nonce != proposalNonce) revert InvalidNonce();

        bytes32 digest = _hashTypedData(structHash);
        _verifySignatures(digest, fedBitmap, fedSigs, _federationSigners, federationThreshold);

        proposalNonce++;

        bytes32 dataHash = keccak256(opData);
        proposalId = keccak256(abi.encode(opType, dataHash, nonce));

        if (_proposals[proposalId].status != ProposalStatus.None) revert ProposalExists();

        _proposals[proposalId] = Proposal({
            dataHash: dataHash,
            proposedAt: block.timestamp,
            deadline: deadline,
            opType: opType,
            status: ProposalStatus.Pending
        });

        emit ProposalCreated(proposalId, opType, opData, nonce, deadline, fedBitmap);
    }

    // =========================================================================
    // Internal — execute router
    // =========================================================================

    /// @dev Routes an executed proposal to the appropriate handler.
    function _executeByType(OperationType opType, bytes calldata opData) private {
        if (opType == OperationType.AdminExecute) {
            // opData = raw bridge callData
            (bool ok, bytes memory ret) = bridge.call(opData);
            _propagateRevert(ok, ret);

        } else if (opType == OperationType.UpdateEnclaveSigners) {
            (address[] memory newSigners, uint256 newThreshold) = abi.decode(opData, (address[], uint256));
            if (newSigners.length == 0) revert NoSigners();
            if (newThreshold == 0 || newThreshold > newSigners.length) revert InvalidThreshold();
            _validateSigners(newSigners);
            _enclaveSigners = newSigners;
            enclaveThreshold = newThreshold;
            emit EnclaveSignersUpdated(newSigners, newThreshold);

        } else if (opType == OperationType.UpdateFederationSigners) {
            (address[] memory newSigners, uint256 newThreshold) = abi.decode(opData, (address[], uint256));
            if (newSigners.length == 0) revert NoSigners();
            if (newThreshold == 0 || newThreshold > newSigners.length) revert InvalidThreshold();
            _validateSigners(newSigners);
            _federationSigners = newSigners;
            federationThreshold = newThreshold;
            emit FederationSignersUpdated(newSigners, newThreshold);

        } else if (opType == OperationType.UpdateBridge) {
            address newBridge = abi.decode(opData, (address));
            if (newBridge == address(0)) revert ZeroBridge();
            address oldBridge = bridge;
            bridge = newBridge;
            emit BridgeAddressUpdated(oldBridge, newBridge);

        } else if (opType == OperationType.SetCommissionRecipient) {
            address newRecipient = abi.decode(opData, (address));
            if (newRecipient == address(0)) revert ZeroRecipient();
            address old = commissionRecipient;
            commissionRecipient = newRecipient;
            emit CommissionRecipientUpdated(old, newRecipient);

        } else if (opType == OperationType.SetTeeAllowedSelector) {
            (bytes4 sel, bool allowed) = abi.decode(opData, (bytes4, bool));
            teeAllowedSelectors[sel] = allowed;
            emit TeeAllowedSelectorUpdated(sel, allowed);

        } else if (opType == OperationType.WithdrawCommission) {
            (address token, uint256 amount) = abi.decode(opData, (address, uint256));
            address recipient = commissionRecipient;
            (bool ok, bytes memory ret) = bridge.call(
                abi.encodeWithSignature('withdrawCommission(address,uint256,address)', token, amount, recipient)
            );
            _propagateRevert(ok, ret);
            emit CommissionWithdrawn(token, amount, recipient);

        } else if (opType == OperationType.WithdrawNativeCommission) {
            uint256 amount = abi.decode(opData, (uint256));
            address recipient = commissionRecipient;
            (bool ok, bytes memory ret) = bridge.call(
                abi.encodeWithSignature('withdrawNativeCommission(uint256,address)', amount, recipient)
            );
            _propagateRevert(ok, ret);
            emit NativeCommissionWithdrawn(amount, recipient);

        } else if (opType == OperationType.SetTimelockDuration) {
            uint256 newDuration = abi.decode(opData, (uint256));
            if (newDuration >= MAX_PROPOSAL_LIFETIME) revert TimelockTooLong();
            timelockDuration = newDuration;
            emit TimelockDurationUpdated(newDuration);
        } else {
            revert UnknownOperationType();
        }
    }

    // =========================================================================
    // Internal — cryptography helpers
    // =========================================================================

    /// @dev Wraps a struct hash into a full EIP-712 digest.
    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked('\x19\x01', DOMAIN_SEPARATOR, structHash));
    }

    /// @dev Builds an EIP-712 digest for TEE execute().
    function _buildDigest(
        bytes32 typeHash,
        bytes4 selector,
        bytes calldata callData,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes32) {
        return _hashTypedData(
            keccak256(abi.encode(typeHash, selector, keccak256(callData), nonce, deadline))
        );
    }

    /// @dev Verifies M-of-N bitmap signatures against the given signer set.
    function _verifySignatures(
        bytes32 digest,
        uint256 bitmap,
        bytes[] calldata sigs,
        address[] storage signerSet,
        uint256 threshold
    ) private view {
        uint256 signersLen = signerSet.length;

        if (bitmap >> signersLen != 0) revert BitmapOutOfRange();

        uint256 setBits = _popcount(bitmap);
        if (setBits < threshold) revert BelowThreshold();
        if (sigs.length != setBits) revert SigCountMismatch();

        uint256 sigIdx = 0;
        for (uint256 i = 0; i < signersLen; i++) {
            if (bitmap & (1 << i) != 0) {
                address recovered = ECDSA.recover(digest, sigs[sigIdx++]);
                if (recovered != signerSet[i]) revert InvalidSignature();
            }
        }
    }

    // =========================================================================
    // Internal — utility helpers
    // =========================================================================

    /// @dev Validates no zero addresses and no duplicates. O(n^2), fine for <20 signers.
    function _validateSigners(address[] memory signers) private pure {
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == address(0)) revert ZeroAddressSigner();
            for (uint256 j = i + 1; j < signers.length; j++) {
                if (signers[i] == signers[j]) revert DuplicateSigner();
            }
        }
    }

    /// @dev EIP-712 array encoding for address[].
    function _hashAddressArray(address[] calldata arr) private pure returns (bytes32) {
        bytes32[] memory words = new bytes32[](arr.length);
        for (uint256 i = 0; i < arr.length; i++) {
            words[i] = bytes32(uint256(uint160(arr[i])));
        }
        return keccak256(abi.encodePacked(words));
    }

    function _popcount(uint256 x) private pure returns (uint256 count) {
        while (x != 0) {
            count += x & 1;
            x >>= 1;
        }
    }

    /// @dev Propagates a revert reason from a low-level call.
    function _propagateRevert(bool ok, bytes memory ret) private pure {
        if (!ok) {
            if (ret.length > 0) {
                assembly { revert(add(ret, 32), mload(ret)) }
            } else {
                revert CallFailed();
            }
        }
    }
}
