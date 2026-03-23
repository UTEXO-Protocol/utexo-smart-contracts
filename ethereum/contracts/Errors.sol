// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

library Errors {
    string public constant COMMISSION_GREATER_THAN_AMOUNT =
        'CommissionGreaterThanAmount';
    string public constant ALREADY_USED_SIGNATURE = 'AlreadyUsedSignature';
    string public constant EXPIRED_SIGNATURE = 'ExpiredSignature';
    string public constant AMOUNT_EXCEED_BRIDGE_POOL = 'AmountExceedBridgePool';
    string public constant AMOUNT_EXCEED_COMMISSION_POOL =
        'AmountExceedCommissionPool';
    string public constant INVALID_RECIPIENT_ADDRESS =
        'InvalidRecipientAddress';
    string public constant INVALID_TOKEN_ADDRESS = 'InvalidTokenAddress';
    string public constant INVALID_DESTIONATION_ADDRESS =
        'InvalidDestinationAddress';
    string public constant INVALID_DESTIONATION_CHAIN =
        'InvalidDestinationChain';
    string public constant INVALID_SIGNER_ADDRESS = 'InvalidSignerAddress';
    string public constant INVALID_COMMISSION_COLLECTOR_ADDRESS =
        'InvalidCommissionCollectorAddress';
    string public constant INVALID_CIRCLE_CONTRACT_ADDRESS =
        'InvalidCircleContractAddress';
    string public constant INVALID_STABLE_COMMISSION_PERCENT =
        'InvalidStableCommissionPercent';
    string public constant RENOUNCE_OWNERHSIP_BLOCKED =
        'RenounceOwnerShipBlocked';
    string public constant MULTI_TOKEN_NOT_EXIST = 'MultiTokenNotExist';
    string public constant MULTI_TOKEN_ALREADY_EXIST = 'MultiTokenAlreadyExist';
}
