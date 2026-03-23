// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { BridgeInParams, BridgeInNativeParams, BridgeInERC1155Params } from '../ParamsStructs.sol';

interface IBridge {
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

    /// @param sender Address who deposit tokens to the bridge and from which address we burn these tokens
    /// @param nonce Classic nonce parameter to track unique transaction
    /// @param token Token we deposit to the bridge and burn it
    /// @param tokenId Token Id
    /// @param amount Amount of this token
    /// @param stableCommissionPercent Commission percent which is actual on the moment when this event fired
    /// @param gasCommission Gas commission on the destination chain which is actual when this event fired
    /// @param destinationChain From what chain we transfer to the recipient
    /// @param destinationAddress From what address(in the above chain) we transfer to the recipient
    event BridgeMultiTokenInBurn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        address token,
        uint256 tokenId,
        uint256 amount,
        uint256 stableCommissionPercent,
        uint256 gasCommission,
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

    /// @param recipient Recipient of the tokens on which we mint these tokens
    /// @param tokenId Token Id
    /// @param amount Amount of minted tokens
    /// @param transactionId Helper parameter to track
    /// @param sourceChain From what chain we transfer to the recipient
    /// @param sourceAddress From what address(in the chain mentioned above) we transfer to the recipient
    event BridgeMultiTokenMint(
        address indexed recipient,
        address tokenAddress,
        uint256 tokenId,
        uint256 amount,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );

    /// @param tokenAddress Address of MultiToken
    /// @param tokenId Token Id
    /// @param tokenURI Token URI
    event BridgeMultiTokenEtch(
        address indexed tokenAddress,
        uint256 indexed tokenId,
        string tokenURI
    );

    /// @param token Token we withdraw from the commission pool
    /// @param amount Amount of this token
    event WithdrawCommission(address indexed token, uint256 amount);

    /// @param amount Amount of coin
    event WithdrawNativeCommission(uint256 indexed amount);

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    function fundsIn(
        BridgeInParams calldata params,
        bytes calldata signature
    ) external;

    /// @notice Deposit coin on the bridge to transfer them onto another chain
    function fundsInNative(
        BridgeInNativeParams calldata params,
        bytes calldata signature
    ) external payable;

    /// @notice Deposit tokens on the bridge to transfer them onto another chain. Burn these tokens to mint them on another chain eventually
    function fundsInBurn(
        BridgeInParams calldata params,
        bytes calldata signature
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

    /// @notice Send ERC1155 tokens to user using bridge - mint them to the address if token with given id exists. Can be initiated only by the owner
    function multiTokenMint(
        address recipient,
        address token,
        uint256 tokenId,
        uint256 amount,
        uint256 transactionId,
        string calldata sourceChain,
        string calldata sourceAddress
    ) external;

    /// @notice Etch new multiToken with id and tokenURI. Can be initiated only by the owner
    function multiTokenEtch(
        address tokenAddress,
        uint256 tokenId,
        string memory tokenURI
    ) external;

    /// @notice Deposit tokens on the bridge to transfer them onto another chain
    function fundsInMultiToken(
        BridgeInERC1155Params calldata params,
        bytes calldata signature
    ) external payable;

    /// @notice Withdraw commission from the collected pool by the specified token
    function withdrawCommission(address token, uint256 amount) external;

    /// @notice Withdraw coin commission from the collected pool for the native coin ETH
    function withdrawNativeCommission(uint256 amount) external;

    /// @notice Set commission collector address
    function setCommissionCollector(address commissionCollector_) external;

    /// @notice Stop all contract functionality allowed to the user
    function pause() external;

    /// @notice Resume all contract functionality allowed to the user
    function unpause() external;

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
