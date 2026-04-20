// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

import { BridgeBase } from './BridgeBase.sol';
import { IBridge } from './interfaces/IBridge.sol';
import { IBtcRelayView } from './interfaces/IBtcRelayView.sol';

/// @title Bridge
/// @notice Production bridge for locking USDT0 on Arbitrum and unlocking it back.
///         Extends BridgeBase with full event data for the UTEXO backend.
///
/// @dev - Owner must be MultisigProxy. fundsOut is called via MultisigProxy.execute()
///        (TEE M-of-N).
///      - fundsIn is open — any user can lock tokens. Validation of destination
///        address and chain happens on the backend before minting on the other side.
///      - fundsOut verifies the Bitcoin block header via BtcRelay before releasing funds.
contract Bridge is BridgeBase, IBridge {
    using SafeERC20 for IERC20;

    // =========================================================================
    // State
    // =========================================================================

    /// @notice BtcRelay contract used to verify Bitcoin block headers.
    address public immutable btcRelay;

    /// @notice On-chain record of fundsIn operations: transactionId => amount.
    ///         Used by fundsOut to verify that referenced deposits actually happened.
    mapping(uint256 => uint256) public fundsInRecords;

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param usdt0_    USDT0 token address on Arbitrum.
    /// @param btcRelay_ BtcRelay contract address for Bitcoin header verification.
    constructor(address usdt0_, address btcRelay_) BridgeBase(usdt0_) {
        if (btcRelay_ == address(0)) revert InvalidBtcRelayAddress();
        btcRelay = btcRelay_;
    }

    // =========================================================================
    // External — user-facing
    // =========================================================================

    /// @inheritdoc IBridge
    function fundsIn(
        uint256 amount,
        string  calldata destinationChain,
        string  calldata destinationAddress,
        uint256 nonce,
        uint256 transactionId
    ) external whenNotPaused {
        if (bytes(destinationAddress).length == 0) revert InvalidDestinationAddress();
        if (bytes(destinationChain).length == 0)   revert InvalidDestinationChain();
        if (fundsInRecords[transactionId] != 0)    revert DuplicateTransactionId();

        IERC20(TOKEN).safeTransferFrom(_msgSender(), address(this), amount);

        fundsInRecords[transactionId] = amount;

        emit FundsIn(_msgSender(), transactionId, amount);
        emit BridgeFundsIn(
            _msgSender(),
            transactionId,
            nonce,
            amount,
            destinationChain,
            destinationAddress
        );
    }

    // =========================================================================
    // External — owner-only (called via MultisigProxy.execute)
    // =========================================================================

    /// @inheritdoc IBridge
    function fundsOut(
        address recipient,
        uint256 amount,
        uint256 transactionId,
        string  calldata sourceChain,
        string  calldata sourceAddress,
        uint256 blockHeight,
        bytes32 commitmentHash,
        uint256[] calldata fundsInIds
    ) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipientAddress();
        if (amount > IERC20(TOKEN).balanceOf(address(this))) revert AmountExceedBridgePool();

        // Verify referenced fundsIn operations exist and consume them
        uint256 totalLocked;
        for (uint256 i = 0; i < fundsInIds.length; i++) {
            uint256 recorded = fundsInRecords[fundsInIds[i]];
            if (recorded == 0) revert FundsInNotFound(fundsInIds[i]);
            totalLocked += recorded;
            delete fundsInRecords[fundsInIds[i]];
        }
        if (amount > totalLocked) revert FundsOutAmountExceedsFundsIn();

        // Verify Bitcoin block header is known to BtcRelay (reverts if unknown)
        IBtcRelayView(btcRelay).verifyBlockheaderHash(blockHeight, commitmentHash);

        IERC20(TOKEN).safeTransfer(recipient, amount);

        emit BridgeFundsOut(
            recipient,
            amount,
            transactionId,
            sourceChain,
            sourceAddress,
            blockHeight,
            commitmentHash
        );
    }

    /// @inheritdoc IBridge
    function renounceOwnership()
        public
        view
        override(BridgeBase, IBridge)
        onlyOwner
    {
        revert RenounceOwnershipBlocked();
    }
}
