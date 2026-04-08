// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { SafeERC20, IERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { Pausable } from '@openzeppelin/contracts/utils/Pausable.sol';

import { IMultisigProxy } from './interfaces/IMultisigProxy.sol';
import { FundsInParams } from './ParamsStructs.sol';
import { IBridge } from './interfaces/IBridge.sol';

contract Bridge is IBridge, Pausable, Ownable {
    using SafeERC20 for IERC20;

    mapping(uint256 => bool) private _usedNonces;

    // =========================================================================
    // EIP-712 type hashes for fundsIn signatures
    // =========================================================================

    bytes32 private constant _FUNDS_IN_TYPEHASH = keccak256(
        'FundsIn(address sender,address token,uint256 amount,string destinationChain,string destinationAddress,uint256 deadline,uint256 nonce,uint256 transactionId)'
    );

    constructor() Ownable(msg.sender) {}

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external whenNotPaused {
        if (params.token == address(0)) {
            revert InvalidTokenAddress();
        }

        if (bytes(params.destinationAddress).length == 0) {
            revert InvalidDestinationAddress();
        }

        if (bytes(params.destinationChain).length == 0) {
            revert InvalidDestinationChain();
        }

        if (_usedNonces[params.nonce]) {
            revert AlreadyUsedSignature();
        }

        if (block.timestamp > params.deadline) {
            revert ExpiredSignature();
        }
        {
            bytes32 structHash = keccak256(abi.encode(
                _FUNDS_IN_TYPEHASH,
                _msgSender(),
                params.token,
                params.amount,
                keccak256(bytes(params.destinationChain)),
                keccak256(bytes(params.destinationAddress)),
                params.deadline,
                params.nonce,
                params.transactionId
            ));

            _verifyTeeSignature(structHash, signature, signerIndex);

            _usedNonces[params.nonce] = true;
        }

        IERC20(params.token).safeTransferFrom(
            _msgSender(),
            address(this),
            params.amount
        );

        emit BridgeFundsIn(
            _msgSender(),
            params.transactionId,
            params.nonce,
            params.token,
            params.amount,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Withdraw tokens from the bridge. Can be initiated only by the owner
    /// @param token Token address
    /// @param recipient Recipient address
    /// @param amount Token amount
    /// @param transactionId ID of the transaction - helper parameter
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    function fundsOut(
        address token,
        address recipient,
        uint256 amount,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external onlyOwner {
        if (recipient == address(0)) {
            revert InvalidRecipientAddress();
        }

        if (token == address(0)) {
            revert InvalidTokenAddress();
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) {
            revert AmountExceedBridgePool();
        }

        IERC20(token).safeTransfer(recipient, amount);

        emit BridgeFundsOut(
            recipient,
            token,
            amount,
            transactionId,
            sourceChain,
            sourceAddress
        );
    }

    /// @notice Stop all contract functionality allowed to the user
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume all contract functionality allowed to the user
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Block renounce ownership functionality
    function renounceOwnership()
        public
        view
        override(Ownable, IBridge)
        onlyOwner
    {
        revert RenounceOwnershipBlocked();
    }

    /// @notice Get chain id
    /// @return id chain id
    function getChainId() public view returns (uint256) {
        uint256 id;
        assembly {
            id := chainid()
        }
        return id;
    }

    /// @notice Get balance on the current contract
    /// @return balance contract balance
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // =========================================================================
    // Internal — TEE signature verification via MultisigProxy (EIP-712)
    // =========================================================================

    /// @dev Builds full EIP-712 digest from structHash using MultisigProxy's
    ///      DOMAIN_SEPARATOR, then verifies the TEE signature.
    function _verifyTeeSignature(
        bytes32 structHash,
        bytes calldata signature,
        uint256 signerIndex
    ) private view {
        IMultisigProxy multisig = IMultisigProxy(owner());
        bytes32 digest = keccak256(abi.encodePacked(
            '\x19\x01',
            multisig.DOMAIN_SEPARATOR(),
            structHash
        ));
        if (!multisig.verifyEnclaveSignature(digest, signature, signerIndex)) {
            revert InvalidSignature();
        }
    }
}
