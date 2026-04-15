// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

import { BridgeBase } from './BridgeBase.sol';
import { IBridge } from './interfaces/IBridge.sol';

/// @title Bridge
/// @notice Production bridge for locking USDT0 on Arbitrum and unlocking it back.
///         Extends BridgeBase with full event data for the UTEXO backend.
///
/// @dev - Owner must be MultisigProxy. fundsOut is called via MultisigProxy.execute()
///        (TEE M-of-N).
///      - fundsIn is open — any user can lock tokens. Validation of destination
///        address and chain happens on the backend before minting on the other side.
contract Bridge is BridgeBase, IBridge {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param usdt0_ USDT0 token address on Arbitrum.
    constructor(address usdt0_) BridgeBase(usdt0_) {}

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

        IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);

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
        address tokenAddr,
        address recipient,
        uint256 amount,
        uint256 transactionId,
        string  calldata sourceChain,
        string  calldata sourceAddress
    ) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipientAddress();
        if (tokenAddr != token)      revert InvalidTokenAddress();
        if (amount > IERC20(token).balanceOf(address(this))) revert AmountExceedBridgePool();

        IERC20(token).safeTransfer(recipient, amount);

        emit BridgeFundsOut(
            recipient,
            amount,
            transactionId,
            sourceChain,
            sourceAddress
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
