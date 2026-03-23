// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { OwnableUpgradeable } from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import { SafeERC20, IERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { PausableUpgradeable } from '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import { SignatureVerifyUpgradable } from './signature/SignatureVerifyUpgradable.sol';
import { Errors } from './Errors.sol';
import { ITokenMessenger } from './interfaces/ITokenMessenger.sol';
import { FungibleToken } from './FungibleToken.sol';
import { MultiToken } from './MultiToken.sol';
import { ERC1155Holder } from '@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol';
import { BridgeInParams, BridgeInNativeParams, BridgeInERC1155Params } from './ParamsStructs.sol';
import { IBridge } from './interfaces/IBridge.sol';

contract Bridge is
    IBridge,
    PausableUpgradeable,
    OwnableUpgradeable,
    SignatureVerifyUpgradable,
    ERC1155Holder
{
    using SafeERC20 for IERC20;

    uint32 private _stableCommissionPercent = 4_00;
    address private _commissionCollector;

    mapping(uint256 => bool) private _usedNonces;
    mapping(address => uint256) private _commissionPools;
    uint256 private _nativeCommission;

    /**
     * @dev Throws if called by any account other than the commission collector.
     */
    modifier onlyCommissionCollector() {
        if (_msgSender() != _commissionCollector) {
            revert(Errors.INVALID_COMMISSION_COLLECTOR_ADDRESS);
        }
        _;
    }

    function initialize(address signer) public initializer {
        __Pausable_init();
        __Ownable_init();
        transferOwnership(_msgSender());
        signatureVerifyInit(signer);
    }

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    /// @dev Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(
        BridgeInParams calldata params,
        bytes calldata signature
    ) external whenNotPaused {
        _fundsInCommonOperations(params, signature);

        IERC20(params.token).transferFrom(
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
            params.commission,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Deposit coin on the bridge to transfer them onto another chain
    /// @dev Deposit coin on the bridge to transfer them onto another chain
    function fundsInNative(
        BridgeInNativeParams calldata params,
        bytes calldata signature
    ) external payable whenNotPaused {
        _fundsInNativeCommonOperations(params, signature);

        emit BridgeFundsInNative(
            _msgSender(),
            params.transactionId,
            params.nonce,
            msg.value,
            params.commission,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Deposit tokens on the bridge to transfer them onto another chain. Burn these tokens to mint them on another chain eventually
    /// @dev Deposit tokens on the bridge to transfer them onto another chain
    function fundsInBurn(
        BridgeInParams calldata params,
        bytes calldata signature
    ) external whenNotPaused {
        _fundsInCommonOperations(params, signature);

        IERC20(params.token).transferFrom(
            _msgSender(),
            address(this),
            params.commission
        );

        FungibleToken(params.token).burn(
            _msgSender(),
            params.amount - params.commission
        );

        emit BridgeFundsInBurn(
            _msgSender(),
            params.transactionId,
            params.nonce,
            params.token,
            params.amount,
            params.commission,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Withdraw tokens from the bridge. Can be initiated only by the owner
    /// @param token Token address
    /// @param recipient Recipient address
    /// @param amount Token amount
    /// @param commission Commission is charged to the user
    /// @param transactionId ID of the transaction - helper parameter
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    function fundsOut(
        address token,
        address recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external onlyOwner {
        _fundsOutVerify(token, recipient, amount);

        IERC20(token).transfer(recipient, amount - commission);

        _commissionPools[token] += commission;

        emit BridgeFundsOut(
            recipient,
            token,
            amount,
            commission,
            transactionId,
            sourceChain,
            sourceAddress
        );
    }

    /// @notice Withdraw native coin from the bridge. Can be initiated only by the owner
    /// @param recipient Recipient address
    /// @param amount Coin amount
    /// @param commission Commission is charged to the user
    /// @param transactionId ID of the transaction - helper parameter
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    function fundsOutNative(
        address payable recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external onlyOwner {
        _fundsOutNativeVerify(recipient, amount);

        recipient.transfer(amount - commission);

        _nativeCommission += commission;

        emit BridgeFundsOutNative(
            recipient,
            amount,
            commission,
            transactionId,
            sourceChain,
            sourceAddress
        );
    }

    /// @notice Withdraw tokens from the bridge - mint them to the address. Can be initiated only by the owner
    /// @param token Token address
    /// @param recipient Recipient address on which we mint tokens
    /// @param amount Token amount
    /// @param commission Commission is charged to the user
    /// @param transactionId ID of the transaction - helper parameter
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    function fundsOutMint(
        address token,
        address recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external onlyOwner {
        if (recipient == address(0)) {
            revert(Errors.INVALID_RECIPIENT_ADDRESS);
        }

        if (token == address(0)) {
            revert(Errors.INVALID_TOKEN_ADDRESS);
        }

        FungibleToken(token).mint(recipient, amount - commission);
        FungibleToken(token).mint(address(this), commission);

        _commissionPools[token] += commission;

        emit BridgeFundsOutMint(
            recipient,
            token,
            amount,
            commission,
            transactionId,
            sourceChain,
            sourceAddress
        );
    }

    /// @notice Send ERC1155 tokens to user using bridge - mint them to the address if token with given id exists. Can be initiated only by the owner
    /// @param recipient Recipient address on which we mint tokens
    /// @param token Address of ERC1155 Token
    /// @param tokenId Token Id
    /// @param amount Token amount
    /// @param transactionId ID of the transaction - helper parameter
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    function multiTokenMint(
        address recipient,
        address token,
        uint256 tokenId,
        uint256 amount,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external onlyOwner whenNotPaused {
        if (recipient == address(0)) {
            revert(Errors.INVALID_RECIPIENT_ADDRESS);
        }
        if (bytes(MultiToken(token).uri(tokenId)).length == 0) {
            revert(Errors.MULTI_TOKEN_NOT_EXIST);
        }

        MultiToken(token).mint(recipient, tokenId, amount, '');

        emit BridgeMultiTokenMint(
            recipient,
            token,
            tokenId,
            amount,
            transactionId,
            sourceChain,
            sourceAddress
        );
    }

    /// @notice Etch new multiToken with id and tokenURI. Can be initiated only by the owner
    /// @param tokenAddress Address of MultiToken
    /// @param tokenId Token Id
    /// @param tokenURI Token URI
    function multiTokenEtch(
        address tokenAddress,
        uint256 tokenId,
        string memory tokenURI
    ) external onlyOwner whenNotPaused {
        MultiToken multiToken = MultiToken(tokenAddress);
        if (bytes(multiToken.uri(tokenId)).length > 0) {
            revert(Errors.MULTI_TOKEN_ALREADY_EXIST);
        }

        multiToken.setURI(tokenId, tokenURI);

        emit BridgeMultiTokenEtch(tokenAddress, tokenId, tokenURI);
    }

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    /// Burn these tokens to mint them on another chain eventually
    /// @dev Deposit tokens on the bridge to transfer them onto another chain
    function fundsInMultiToken(
        BridgeInERC1155Params calldata params,
        bytes calldata signature
    ) external payable whenNotPaused {
        _fundsInMultiTokenCommonOperations(params, signature, msg.value);

        MultiToken(params.token).burn(
            _msgSender(),
            params.tokenId,
            params.amount
        );

        emit BridgeMultiTokenInBurn(
            _msgSender(),
            params.transactionId,
            params.nonce,
            params.token,
            params.tokenId,
            params.amount,
            _stableCommissionPercent,
            params.gasCommission,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Withdraw commission from the collected pool by the specified token
    /// This way we do not affect user deposits as long as commission pool collected separately
    /// @param token Token address
    /// @param amount Token amount
    function withdrawCommission(
        address token,
        uint256 amount
    ) external onlyCommissionCollector {
        if (_commissionPools[token] < amount) {
            revert(Errors.AMOUNT_EXCEED_COMMISSION_POOL);
        }
        _commissionPools[token] -= amount;
        IERC20(token).transfer(msg.sender, amount);
        emit WithdrawCommission(token, amount);
    }

    /// @notice Withdraw coin commission from the collected pool for the native coin ETH
    /// This way we do not affect user deposits as long as commission pool collected separately
    /// @param amount Coin amount
    function withdrawNativeCommission(
        uint256 amount
    ) external onlyCommissionCollector {
        if (_nativeCommission < amount) {
            revert(Errors.AMOUNT_EXCEED_COMMISSION_POOL);
        }
        _nativeCommission -= amount;
        payable(msg.sender).transfer(amount);
        emit WithdrawNativeCommission(amount);
    }

    /// @notice Set commission collector address
    /// @param commissionCollector_ address
    function setCommissionCollector(
        address commissionCollector_
    ) external onlyOwner {
        if (commissionCollector_ == address(0)) {
            revert(Errors.INVALID_COMMISSION_COLLECTOR_ADDRESS);
        }
        _commissionCollector = commissionCollector_;
    }

    /// @notice Stop all contract functionality allowed to the user
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume all contract functionality allowed to the user
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Get commission collector address
    /// @return commission collector address
    function getCommissionCollector() external view returns (address) {
        return _commissionCollector;
    }

    /// @notice Get commission collector address
    /// @return commission collector address
    function getNativeCommission() external view returns (uint256) {
        return _nativeCommission;
    }

    /// @notice Get amount of collected commission by the specified token
    /// @param token Specified token
    /// @return amount of collected commission
    function getCommissionPoolAmount(
        address token
    ) external view returns (uint256) {
        return _commissionPools[token];
    }

    /// @notice Block renounce ownership functionality
    function renounceOwnership()
        public
        view
        override(OwnableUpgradeable, IBridge)
        onlyOwner
    {
        revert(Errors.INVALID_SIGNER_ADDRESS);
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

    /// @notice Performs common validations and operations for `fundsIn` and `fundsInBurn` functions
    /// @param params Struct containing parameters required for the `fundsIn` operation
    /// @param signature Signature data used to validate the transaction.
    function _fundsInCommonOperations(
        BridgeInParams calldata params,
        bytes calldata signature
    ) private {
        if (params.token == address(0)) {
            revert(Errors.INVALID_TOKEN_ADDRESS);
        }

        if (bytes(params.destinationAddress).length == 0) {
            revert(Errors.INVALID_DESTIONATION_ADDRESS);
        }

        if (bytes(params.destinationChain).length == 0) {
            revert(Errors.INVALID_DESTIONATION_CHAIN);
        }

        if (params.commission >= params.amount) {
            revert(Errors.COMMISSION_GREATER_THAN_AMOUNT);
        }

        if (_usedNonces[params.nonce]) {
            revert(Errors.ALREADY_USED_SIGNATURE);
        }

        if (block.timestamp > params.deadline) {
            revert(Errors.EXPIRED_SIGNATURE);
        }
        {
            _checkBridgeInRequest(
                _msgSender(),
                address(this),
                params.token,
                params.amount,
                params.commission,
                params.destinationChain,
                params.destinationAddress,
                params.deadline,
                params.nonce,
                params.transactionId,
                getChainId(),
                signature
            );

            _usedNonces[params.nonce] = true;

            _commissionPools[params.token] += params.commission;
        }
    }

    /// @notice Performs common validations and operations for `fundsInMultiToken`
    /// @param params The parameters for the bridge-in operation
    /// @param signature The signature to validate the bridge-in request
    /// @param commission The commission amount to be added to the total native commission.
    function _fundsInMultiTokenCommonOperations(
        BridgeInERC1155Params calldata params,
        bytes calldata signature,
        uint256 commission
    ) private {
        if (params.token == address(0)) {
            revert(Errors.INVALID_TOKEN_ADDRESS);
        }
        if (bytes(params.destinationAddress).length == 0) {
            revert(Errors.INVALID_DESTIONATION_ADDRESS);
        }
        if (bytes(params.destinationChain).length == 0) {
            revert(Errors.INVALID_DESTIONATION_CHAIN);
        }
        if (_usedNonces[params.nonce]) {
            revert(Errors.ALREADY_USED_SIGNATURE);
        }
        if (block.timestamp > params.deadline) {
            revert(Errors.EXPIRED_SIGNATURE);
        }
        {
            _checkBridgeInERC1155Request(
                _msgSender(),
                address(this),
                params,
                getChainId(),
                signature
            );

            _usedNonces[params.nonce] = true;

            _nativeCommission += commission;
        }
    }

    /// @notice Performs common validations and operations for `fundsInNative`
    /// @param params The parameters for the bridge-in-native operation
    /// @param signature The signature to validate the bridge-in request
    function _fundsInNativeCommonOperations(
        BridgeInNativeParams calldata params,
        bytes calldata signature
    ) private {
        if (bytes(params.destinationAddress).length == 0) {
            revert(Errors.INVALID_DESTIONATION_ADDRESS);
        }

        if (bytes(params.destinationChain).length == 0) {
            revert(Errors.INVALID_DESTIONATION_CHAIN);
        }

        if (params.commission >= msg.value) {
            revert(Errors.COMMISSION_GREATER_THAN_AMOUNT);
        }

        if (_usedNonces[params.nonce]) {
            revert(Errors.ALREADY_USED_SIGNATURE);
        }

        if (block.timestamp > params.deadline) {
            revert(Errors.EXPIRED_SIGNATURE);
        }
        {
            _checkBridgeInNativeRequest(
                _msgSender(),
                address(this),
                params.commission,
                params.destinationChain,
                params.destinationAddress,
                params.deadline,
                params.nonce,
                params.transactionId,
                getChainId(),
                signature
            );

            _usedNonces[params.nonce] = true;

            _nativeCommission += params.commission;
        }
    }

    /// @notice Verifies the validity of a funds-out operation
    /// @param token The address of the token being transferred
    /// @param recipient The address of the recipient receiving the funds
    /// @param amount The amount of tokens to be transferred
    function _fundsOutVerify(
        address token,
        address recipient,
        uint256 amount
    ) private view {
        if (recipient == address(0)) {
            revert(Errors.INVALID_RECIPIENT_ADDRESS);
        }

        if (token == address(0)) {
            revert(Errors.INVALID_TOKEN_ADDRESS);
        }
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 allowedBalance = balance - _commissionPools[token];
        if (amount > allowedBalance) {
            revert(Errors.AMOUNT_EXCEED_BRIDGE_POOL);
        }
    }

    /// @notice Verifies the validity of a native token funds-out operation
    /// @param recipient The address of the recipient receiving the native tokens
    /// @param amount The amount of native tokens to be transferred
    function _fundsOutNativeVerify(
        address recipient,
        uint256 amount
    ) private view {
        if (recipient == address(0)) {
            revert(Errors.INVALID_RECIPIENT_ADDRESS);
        }

        uint256 balance = address(this).balance;
        uint256 allowedBalance = balance - _nativeCommission;
        if (amount > allowedBalance) {
            revert(Errors.AMOUNT_EXCEED_BRIDGE_POOL);
        }
    }
}
