// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { FundsInParams, FundsInCircleParams, FundsInNativeParams } from '../ParamsStructs.sol';

interface IBridge {
    // =========================================================================
    // Errors
    // =========================================================================

    error CommissionGreaterThanAmount();
    error AlreadyUsedSignature();
    error ExpiredSignature();
    error AmountExceedBridgePool();
    error AmountExceedCommissionPool();
    error InvalidRecipientAddress();
    error InvalidTokenAddress();
    error InvalidDestinationAddress();
    error InvalidDestinationChain();
    error InvalidCommissionCollectorAddress();
    error InvalidCircleContractAddress();
    error NativeTransferFailed();
    error InvalidSignature();
    error RenounceOwnershipBlocked();

    // =========================================================================
    // Events
    // =========================================================================

    /// @param sender Address who deposit tokens to the bridge
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param token Token we deposit to the bridge
    /// @param amount Amount of this token
    /// @param commission Commission charged from the user at fundsIn
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event BridgeFundsIn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        address token,
        uint256 amount,
        uint256 commission,
        string destinationChain,
        string destinationAddress
    );

    /// @param sender Address who deposit tokens to the bridge
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param token Token we deposit to the bridge
    /// @param amount Amount of this token
    /// @param commission Commission charged from the user at fundsIn
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event BridgeFundsInCircle(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        address token,
        uint256 amount,
        uint256 commission,
        uint32 destinationChain,
        bytes32 destinationAddress
    );

    /// @param sender Address who deposit native coin to the bridge
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param amount Amount of coin
    /// @param commission Commission charged from the user at fundsIn
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event BridgeFundsInNative(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        uint256 amount,
        uint256 commission,
        string destinationChain,
        string destinationAddress
    );

    /// @param sender Address who deposit tokens to the bridge and from which address we burn these tokens
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param token Token we deposit to the bridge and burn it
    /// @param amount Amount of this token
    /// @param commission Commission charged from the user at fundsIn
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event BridgeFundsInBurn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        address token,
        uint256 amount,
        uint256 commission,
        string destinationChain,
        string destinationAddress
    );

    /// @param recipient Recipient of the tokens
    /// @param token Token we fund out from the bridge
    /// @param amount Amount of this token
    /// @param commission Commission charged from the user at fundsOut
    /// @param transactionId Helper parameter to track
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    event BridgeFundsOut(
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );

    /// @param recipient Recipient of the tokens
    /// @param amount Amount of native coin
    /// @param commission Commission charged from the user at fundsOut
    /// @param transactionId Helper parameter to track
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    event BridgeFundsOutNative(
        address indexed recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );

    /// @param recipient Recipient of the tokens on which we mint these tokens
    /// @param token Token we fund out from the bridge
    /// @param amount Amount of minted tokens
    /// @param commission Commission charged from the user at fundsOut
    /// @param transactionId Helper parameter to track
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    event BridgeFundsOutMint(
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );

    /// @param token Token we withdraw from the commission pool
    /// @param amount Amount of this token
    /// @param recipient Address that received the commission
    event WithdrawCommission(
        address indexed token,
        uint256 amount,
        address indexed recipient
    );

    /// @param amount Amount of coin
    /// @param recipient Address that received the commission
    event WithdrawNativeCommission(uint256 amount, address indexed recipient);

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external;

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    function fundsInCircle(
        FundsInCircleParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external;

    /// @notice Deposit coin on the bridge to transfer them onto another chain
    function fundsInNative(
        FundsInNativeParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external payable;

    /// @notice Deposit tokens on the bridge to transfer them onto another chain. Burn these tokens to mint them on another chain eventually
    function fundsInBurn(
        FundsInParams calldata params,
        bytes calldata signature,
        uint256 signerIndex
    ) external;

    /// @notice Withdraw tokens from the bridge. Can be initiated only by the owner
    function fundsOut(
        address token,
        address recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external;

    /// @notice Withdraw native coin from the bridge. Can be initiated only by the owner
    function fundsOutNative(
        address payable recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external;

    /// @notice Withdraw tokens from the bridge - mint them to the address. Can be initiated only by the owner
    function fundsOutMint(
        address token,
        address recipient,
        uint256 amount,
        uint256 commission,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external;

    /// @notice Withdraw commission from the collected pool by the specified token
    /// @param recipient Address to receive the withdrawn commission
    function withdrawCommission(
        address token,
        uint256 amount,
        address recipient
    ) external;

    /// @notice Withdraw coin commission from the collected pool for the native coin ETH
    /// @param recipient Address to receive the withdrawn native commission
    function withdrawNativeCommission(
        uint256 amount,
        address recipient
    ) external;

    /// @notice Set circle contract address
    function setCircleContract(address circleContract_) external;

    /// @notice Set commission collector address
    function setCommissionCollector(address commissionCollector_) external;

    /// @notice Stop all contract functionality allowed to the user
    function pause() external;

    /// @notice Resume all contract functionality allowed to the user
    function unpause() external;

    /// @notice Get circle contract address
    function getCircleContract() external view returns (address);

    /// @notice Get commission collector address
    function getCommissionCollector() external view returns (address);

    /// @notice Get commission collector address
    function getNativeCommission() external view returns (uint256);

    /// @notice Get amount of collected commission by the specified token
    function getCommissionPoolAmount(
        address token
    ) external view returns (uint256);

    /// @notice Block renounce ownership functionality
    function renounceOwnership() external view;

    /// @notice Get chain id
    function getChainId() external view returns (uint256);

    /// @notice Get balance on the current contract
    function getContractBalance() external view returns (uint256);
}
