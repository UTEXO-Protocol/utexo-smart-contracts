// SPDX-License-Identifier: MIT
// vvv do we need to return comission to the user?
pragma solidity 0.8.20;

import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { MessageHashUtils } from '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import { Errors } from '../Errors.sol';

contract SignatureVerify {
    address private _signerAddress;

    /// @notice Constructor that initializes signer address
    /// @param systemAddress_ Address of the signer
    constructor(address systemAddress_) {
        if (systemAddress_ == address(0)) {
            revert(Errors.INVALID_SIGNER_ADDRESS);
        }

        _signerAddress = systemAddress_;
    }

    /// @notice Verifies the signature for a bridge-in request with token transfer
    /// @dev Internal function to check the validity of a bridge-in request
    /// @param senderAddress Address initiating the bridge-in
    /// @param contractAddress Address of the target contract
    /// @param token Address of the token to be transferred
    /// @param amount Amount of tokens to be transferred
    /// @param gasCommission Gas commission fee for the bridge-in
    /// @param destinationChain Target blockchain for the bridge-in
    /// @param destinationAddress Address on the target blockchain
    /// @param deadline Deadline for the bridge-in request
    /// @param nonce Unique nonce for the bridge-in request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current chain
    /// @param signature Signature to be verified
    function _checkBridgeInRequest(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 gasCommission,
        string memory destinationChain,
        string memory destinationAddress,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId,
        bytes calldata signature
    ) internal view {
        if (
            !_verify(
                _signerAddress,
                _hashBridgeIn(
                    senderAddress,
                    contractAddress,
                    token,
                    amount,
                    gasCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId,
                    chainId
                ),
                signature
            )
        ) {
            revert('InvalidSignature');
        }
    }

    /// @notice Verifies the signature for a bridge-in request with native coin transfer
    /// @dev Internal function to check the validity of a bridge-in request with native coins
    /// @param senderAddress Address initiating the bridge-in
    /// @param contractAddress Address of the target contract
    /// @param gasCommission Gas commission fee for the bridge-in
    /// @param destinationChain Target blockchain for the bridge-in
    /// @param destinationAddress Address on the target blockchain
    /// @param deadline Deadline for the bridge-in request
    /// @param nonce Unique nonce for the bridge-in request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @param signature Signature to be verified
    function _checkBridgeInCoinRequest(
        address senderAddress,
        address contractAddress,
        uint256 gasCommission,
        string memory destinationChain,
        string memory destinationAddress,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId,
        bytes calldata signature
    ) internal view {
        if (
            !_verify(
                _signerAddress,
                _hashBridgeInCoin(
                    senderAddress,
                    contractAddress,
                    gasCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId,
                    chainId
                ),
                signature
            )
        ) {
            revert('InvalidSignature');
        }
    }

    /// @notice Verifies the signature for a bridge-in request with token transfer
    /// @dev Internal function to check the validity of a bridge-in request
    /// @param senderAddress Address initiating the bridge-in
    /// @param contractAddress Address of the target contract
    /// @param token Address of the token to be transferred
    /// @param amount Amount of tokens to be transferred
    /// @param gasCommission Gas commission fee for the bridge-in
    /// @param destinationChain Target blockchain for the bridge-in
    /// @param destinationAddress Address on the target blockchain
    /// @param deadline Deadline for the bridge-in request
    /// @param nonce Unique nonce for the bridge-in request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @param signature Signature to be verified
    function _checkBridgeInRequestCircle(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 gasCommission,
        uint32 destinationChain,
        bytes32 destinationAddress,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId,
        bytes calldata signature
    ) internal view {
        if (
            !_verify(
                _signerAddress,
                _hashBridgeInCircle(
                    senderAddress,
                    contractAddress,
                    token,
                    amount,
                    gasCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId,
                    chainId
                ),
                signature
            )
        ) {
            revert('InvalidSignature');
        }
    }

    /// @notice Verifies the signature for a transfer-out request
    /// @dev Internal function to check the validity of a transfer-out request
    /// @param contractAddress Address of the target contract
    /// @param token Address of the token to be transferred
    /// @param recipient Address of the recipient
    /// @param amount Amount of tokens to be transferred
    /// @param commission Commission fee for the transfer-out
    /// @param deadline Deadline for the transfer-out request
    /// @param nonce Unique nonce for the transfer-out request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @param signature Signature to be verified
    function _checkTransferOutRequest(
        address contractAddress,
        address token,
        address recipient,
        uint256 amount,
        uint256 commission,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId,
        bytes calldata signature
    ) internal view {
        if (
            !_verify(
                _signerAddress,
                _hashTransferOut(
                    contractAddress,
                    token,
                    recipient,
                    amount,
                    commission,
                    deadline,
                    nonce,
                    transactionId,
                    chainId
                ),
                signature
            )
        ) {
            revert('InvalidSignature');
        }
    }

    /// @notice Verifies the signature of a given hash
    /// @param signerAddress Address of the signer
    /// @param hash Hash of the message to be verified
    /// @param signature Signature to be verified
    /// @return bool True if the signature is valid, false otherwise
    function _verify(
        address signerAddress,
        bytes32 hash,
        bytes calldata signature
    ) private pure returns (bool) {
        return signerAddress == ECDSA.recover(hash, signature);
    }

    /// @notice Generates the hash for a bridge-in request with token transfer
    /// @dev Internal function to generate the hash for signature verification
    /// @param senderAddress Address initiating the bridge-in
    /// @param contractAddress Address of the target contract
    /// @param token Address of the token to be transferred
    /// @param amount Amount of tokens to be transferred
    /// @param gasCommission Gas commission fee for the bridge-in
    /// @param destinationChain Target blockchain for the bridge-in
    /// @param destinationAddress Address on the target blockchain
    /// @param deadline Deadline for the bridge-in request
    /// @param nonce Unique nonce for the bridge-in request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @return bytes32 Hash of the bridge-in request
    function _hashBridgeIn(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 gasCommission,
        string memory destinationChain,
        string memory destinationAddress,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId
    ) private pure returns (bytes32) {
        return
            MessageHashUtils.toEthSignedMessageHash(
                keccak256(
                    abi.encodePacked(
                        senderAddress,
                        contractAddress,
                        token,
                        amount,
                        gasCommission,
                        destinationChain,
                        destinationAddress,
                        deadline,
                        nonce,
                        transactionId,
                        chainId
                    )
                )
            );
    }

    /// @notice Generates the hash for a bridge-in request with native coin transfer
    /// @dev Internal function to generate the hash for signature verification
    /// @param senderAddress Address initiating the bridge-in
    /// @param contractAddress Address of the target contract
    /// @param gasCommission Gas commission fee for the bridge-in
    /// @param destinationChain Target blockchain for the bridge-in
    /// @param destinationAddress Address on the target blockchain
    /// @param deadline Deadline for the bridge-in request
    /// @param nonce Unique nonce for the bridge-in request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @return bytes32 Hash of the bridge-in request
    function _hashBridgeInCoin(
        address senderAddress,
        address contractAddress,
        uint256 gasCommission,
        string memory destinationChain,
        string memory destinationAddress,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId
    ) private pure returns (bytes32) {
        return
            MessageHashUtils.toEthSignedMessageHash(
                keccak256(
                    abi.encodePacked(
                        senderAddress,
                        contractAddress,
                        gasCommission,
                        destinationChain,
                        destinationAddress,
                        deadline,
                        nonce,
                        transactionId,
                        chainId
                    )
                )
            );
    }

    /// @notice Generates the hash for a bridge-in request
    /// @dev Internal function to generate the hash for signature verification
    /// @param senderAddress Address initiating the bridge-in
    /// @param contractAddress Address of the target contract
    /// @param token Address of the token to be transferred
    /// @param amount Amount of tokens to be transferred
    /// @param gasCommission Gas commission fee for the bridge-in
    /// @param destinationChain Target blockchain for the bridge-in
    /// @param destinationAddress Address on the target blockchain
    /// @param deadline Deadline for the bridge-in request
    /// @param nonce Unique nonce for the bridge-in request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @return bytes32 Hash of the bridge-in request
    function _hashBridgeInCircle(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 gasCommission,
        uint32 destinationChain,
        bytes32 destinationAddress,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId
    ) private pure returns (bytes32) {
        return
            MessageHashUtils.toEthSignedMessageHash(
                keccak256(
                    abi.encodePacked(
                        senderAddress,
                        contractAddress,
                        token,
                        amount,
                        gasCommission,
                        destinationChain,
                        destinationAddress,
                        deadline,
                        nonce,
                        transactionId,
                        chainId
                    )
                )
            );
    }

    /// @notice Generates the hash for a transfer-out request
    /// @dev Internal function to generate the hash for signature verification
    /// @param contractAddress Address of the target contract
    /// @param token Address of the token to be transferred
    /// @param recipient Address of the recipient
    /// @param amount Amount of tokens to be transferred
    /// @param commission Commission fee for the transfer-out
    /// @param deadline Deadline for the transfer-out request
    /// @param nonce Unique nonce for the transfer-out request
    /// @param transactionId Unique ID for the transaction
    /// @param chainId ID of the current blockchain
    /// @return bytes32 Hash of the transfer-out request
    function _hashTransferOut(
        address contractAddress,
        address token,
        address recipient,
        uint256 amount,
        uint256 commission,
        uint256 deadline,
        uint256 nonce,
        uint256 transactionId,
        uint256 chainId
    ) private pure returns (bytes32) {
        return
            MessageHashUtils.toEthSignedMessageHash(
                keccak256(
                    abi.encodePacked(
                        contractAddress,
                        token,
                        recipient,
                        amount,
                        commission,
                        deadline,
                        nonce,
                        transactionId,
                        chainId
                    )
                )
            );
    }
}
