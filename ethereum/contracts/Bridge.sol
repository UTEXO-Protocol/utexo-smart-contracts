// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { OwnableUpgradeable } from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import { SafeERC20, IERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { PausableUpgradeable } from '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';

import { ITokenMessenger } from './interfaces/ITokenMessenger.sol';
import { IMultisigProxy } from './interfaces/IMultisigProxy.sol';
import { FungibleToken } from './FungibleToken.sol';
import { FundsInParams, FundsInCircleParams, FundsInNativeParams } from './ParamsStructs.sol';
import { IBridge } from './interfaces/IBridge.sol';

contract Bridge is
    IBridge,
    PausableUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    address private _circleContract;
    address private _commissionCollector;

    mapping(uint256 => bool) private _usedNonces;
    mapping(address => uint256) private _commissionPools;
    uint256 private _nativeCommission;

    // =========================================================================
    // EIP-712 type hashes for fundsIn signatures
    // =========================================================================

    bytes32 private constant _FUNDS_IN_TYPEHASH = keccak256(
        'FundsIn(address sender,address token,uint256 amount,uint256 commission,string destinationChain,string destinationAddress,uint256 deadline,uint256 nonce,uint256 transactionId)'
    );

    bytes32 private constant _FUNDS_IN_NATIVE_TYPEHASH = keccak256(
        'FundsInNative(address sender,uint256 commission,string destinationChain,string destinationAddress,uint256 deadline,uint256 nonce,uint256 transactionId)'
    );

    bytes32 private constant _FUNDS_IN_CIRCLE_TYPEHASH = keccak256(
        'FundsInCircle(address sender,address token,uint256 amount,uint256 commission,uint32 destinationChain,bytes32 destinationAddress,uint256 deadline,uint256 nonce,uint256 transactionId)'
    );

    /**
     * @dev Throws if called by any account other than the commission collector.
     */
    modifier onlyCommissionCollector() {
        if (_msgSender() != _commissionCollector) {
            revert InvalidCommissionCollectorAddress();
        }
        _;
    }

    function initialize(address commissionCollector_) public initializer {
        __Pausable_init();
        __Ownable_init();
        transferOwnership(_msgSender());
        _circleContract = 0xD0C3da58f55358142b8d3e06C1C30c5C6114EFE8;
        if (commissionCollector_ != address(0)) {
            _commissionCollector = commissionCollector_;
        }
    }

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    /// @dev Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external whenNotPaused {
        _fundsInCommonOperations(params, signature, signerIndex);

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
            params.commission,
            params.destinationChain,
            params.destinationAddress
        );
    }

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    /// @dev Deposit tokens on the bridge to transfer them onto another chain
    function fundsInCircle(
        FundsInCircleParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external whenNotPaused {
        if (params.token == address(0)) {
            revert InvalidTokenAddress();
        }

        if (params.destinationChain > 10) {
            revert InvalidDestinationChain(); // up 10 networks
        }

        if (params.commission >= params.amount) {
            revert CommissionGreaterThanAmount();
        }

        if (_usedNonces[params.nonce]) {
            revert AlreadyUsedSignature();
        }

        if (block.timestamp > params.deadline) {
            revert ExpiredSignature();
        }
        {
            bytes32 structHash = keccak256(abi.encode(
                _FUNDS_IN_CIRCLE_TYPEHASH,
                _msgSender(),
                params.token,
                params.amount,
                params.commission,
                params.destinationChain,
                params.destinationAddress,
                params.deadline,
                params.nonce,
                params.transactionId
            ));

            _verifyTeeSignature(structHash, signature, signerIndex);

            _usedNonces[params.nonce] = true;

            _commissionPools[params.token] += params.commission;
        }

        IERC20(params.token).safeTransferFrom(
            _msgSender(),
            address(this),
            params.amount
        );

        uint256 amountToBurn = params.amount - params.commission;

        IERC20(params.token).approve(_circleContract, amountToBurn);

        ITokenMessenger(_circleContract).depositForBurn(
            amountToBurn,
            params.destinationChain,
            params.destinationAddress,
            params.token
        );

        emit BridgeFundsInCircle(
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
        FundsInNativeParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external payable whenNotPaused {
        _fundsInNativeCommonOperations(params, signature, signerIndex);

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
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external whenNotPaused {
        _fundsInCommonOperations(params, signature, signerIndex);

        IERC20(params.token).safeTransferFrom(
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

        IERC20(token).safeTransfer(recipient, amount - commission);

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

        (bool success, ) = recipient.call{value: amount - commission}('');
        if (!success) revert NativeTransferFailed();

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
            revert InvalidRecipientAddress();
        }

        if (token == address(0)) {
            revert InvalidTokenAddress();
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

    /// @notice Withdraw commission from the collected pool by the specified token
    /// This way we do not affect user deposits as long as commission pool collected separately
    /// @param token Token address
    /// @param amount Token amount
    /// @param recipient Address to receive the withdrawn commission
    function withdrawCommission(
        address token,
        uint256 amount,
        address recipient
    ) external onlyCommissionCollector {
        if (_commissionPools[token] < amount) {
            revert AmountExceedCommissionPool();
        }
        _commissionPools[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);
        emit WithdrawCommission(token, amount, recipient);
    }

    /// @notice Withdraw coin commission from the collected pool for the native coin ETH
    /// This way we do not affect user deposits as long as commission pool collected separately
    /// @param amount Coin amount
    /// @param recipient Address to receive the withdrawn native commission
    function withdrawNativeCommission(
        uint256 amount,
        address recipient
    ) external onlyCommissionCollector {
        if (_nativeCommission < amount) {
            revert AmountExceedCommissionPool();
        }
        _nativeCommission -= amount;
        (bool success, ) = payable(recipient).call{value: amount}('');
        if (!success) revert NativeTransferFailed();
        emit WithdrawNativeCommission(amount, recipient);
    }

    /// @notice Set circle contract address
    /// @param circleContract_ contract address
    function setCircleContract(address circleContract_) external onlyOwner {
        if (circleContract_ == address(0)) {
            revert InvalidCircleContractAddress();
        }
        _circleContract = circleContract_;
    }

    /// @notice Set commission collector address
    /// @param commissionCollector_ address
    function setCommissionCollector(
        address commissionCollector_
    ) external onlyOwner {
        if (commissionCollector_ == address(0)) {
            revert InvalidCommissionCollectorAddress();
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

    /// @notice Get circle contract address
    /// @return circle contract address
    function getCircleContract() external view returns (address) {
        return _circleContract;
    }

    /// @notice Get commission collector address
    /// @return commission collector address
    function getCommissionCollector() external view returns (address) {
        return _commissionCollector;
    }

    /// @notice Get native commission amount
    /// @return native commission amount
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
    // Internal — fundsIn common operations
    // =========================================================================

    /// @notice Performs common validations and operations for `fundsIn` and `fundsInBurn` functions
    function _fundsInCommonOperations(
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) private {
        if (params.token == address(0)) {
            revert InvalidTokenAddress();
        }

        if (bytes(params.destinationAddress).length == 0) {
            revert InvalidDestinationAddress();
        }

        if (bytes(params.destinationChain).length == 0) {
            revert InvalidDestinationChain();
        }

        if (params.commission >= params.amount) {
            revert CommissionGreaterThanAmount();
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
                params.commission,
                keccak256(bytes(params.destinationChain)),
                keccak256(bytes(params.destinationAddress)),
                params.deadline,
                params.nonce,
                params.transactionId
            ));

            _verifyTeeSignature(structHash, signature, signerIndex);

            _usedNonces[params.nonce] = true;

            _commissionPools[params.token] += params.commission;
        }
    }

    /// @notice Performs common validations and operations for `fundsInNative`
    function _fundsInNativeCommonOperations(
        FundsInNativeParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) private {
        if (bytes(params.destinationAddress).length == 0) {
            revert InvalidDestinationAddress();
        }

        if (bytes(params.destinationChain).length == 0) {
            revert InvalidDestinationChain();
        }

        if (params.commission >= msg.value) {
            revert CommissionGreaterThanAmount();
        }

        if (_usedNonces[params.nonce]) {
            revert AlreadyUsedSignature();
        }

        if (block.timestamp > params.deadline) {
            revert ExpiredSignature();
        }
        {
            bytes32 structHash = keccak256(abi.encode(
                _FUNDS_IN_NATIVE_TYPEHASH,
                _msgSender(),
                params.commission,
                keccak256(bytes(params.destinationChain)),
                keccak256(bytes(params.destinationAddress)),
                params.deadline,
                params.nonce,
                params.transactionId
            ));

            _verifyTeeSignature(structHash, signature, signerIndex);

            _usedNonces[params.nonce] = true;

            _nativeCommission += params.commission;
        }
    }

    // =========================================================================
    // Internal — fundsOut verification
    // =========================================================================

    function _fundsOutVerify(
        address token,
        address recipient,
        uint256 amount
    ) private view {
        if (recipient == address(0)) {
            revert InvalidRecipientAddress();
        }

        if (token == address(0)) {
            revert InvalidTokenAddress();
        }
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 allowedBalance = balance - _commissionPools[token];
        if (amount > allowedBalance) {
            revert AmountExceedBridgePool();
        }
    }

    function _fundsOutNativeVerify(
        address recipient,
        uint256 amount
    ) private view {
        if (recipient == address(0)) {
            revert InvalidRecipientAddress();
        }

        uint256 balance = address(this).balance;
        uint256 allowedBalance = balance - _nativeCommission;
        if (amount > allowedBalance) {
            revert AmountExceedBridgePool();
        }
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
