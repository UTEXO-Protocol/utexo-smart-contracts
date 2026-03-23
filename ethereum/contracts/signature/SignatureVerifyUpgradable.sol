// SPDX-License-Identifier: MIT
// vvv do we need to return comission to the user?
pragma solidity 0.8.20;

import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import { MessageHashUtils } from '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import { Errors } from '../Errors.sol';
import { Initializable } from '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import { BridgeInERC1155Params } from '../ParamsStructs.sol';

contract SignatureVerifyUpgradable is Initializable {
    address private _signerAddress;

    function signatureVerifyInit(
        address systemAddress_
    ) internal onlyInitializing {
        if (systemAddress_ == address(0)) {
            revert(Errors.INVALID_SIGNER_ADDRESS);
        }

        _signerAddress = systemAddress_;
    }

    function _checkBridgeInRequest(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 commission,
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
                    commission,
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

    function _checkBridgeInERC1155Request(
        address senderAddress,
        address contractAddress,
        BridgeInERC1155Params calldata params,
        uint256 chainId,
        bytes calldata signature
    ) internal view {
        if (
            !_verify(
                _signerAddress,
                _hashBridgeInERC1155(
                    senderAddress,
                    contractAddress,
                    params,
                    chainId
                ),
                signature
            )
        ) {
            revert('InvalidSignature');
        }
    }

    function _checkBridgeInNativeRequest(
        address senderAddress,
        address contractAddress,
        uint256 commission,
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
                _hashBridgeInNative(
                    senderAddress,
                    contractAddress,
                    commission,
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

    function _checkBridgeInRequestCircle(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 commission,
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
                    commission,
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

    function _verify(
        address singerAddress,
        bytes32 hash,
        bytes calldata signature
    ) private pure returns (bool) {
        return singerAddress == ECDSA.recover(hash, signature);
    }

    function _hashBridgeIn(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 commission,
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
                        commission,
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

    function _hashBridgeInERC1155(
        address senderAddress,
        address contractAddress,
        BridgeInERC1155Params calldata params,
        uint256 chainId
    ) private pure returns (bytes32) {
        return
            MessageHashUtils.toEthSignedMessageHash(
                keccak256(
                    abi.encodePacked(
                        senderAddress,
                        contractAddress,
                        params.token,
                        params.tokenId,
                        params.amount,
                        params.gasCommission,
                        params.destinationChain,
                        params.destinationAddress,
                        params.deadline,
                        params.nonce,
                        params.transactionId,
                        chainId
                    )
                )
            );
    }

    function _hashBridgeInNative(
        address senderAddress,
        address contractAddress,
        uint256 commission,
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
                        commission,
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

    function _hashBridgeInCircle(
        address senderAddress,
        address contractAddress,
        address token,
        uint256 amount,
        uint256 commission,
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
                        commission,
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
