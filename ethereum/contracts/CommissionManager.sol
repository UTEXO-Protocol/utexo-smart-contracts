// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CommissionManager
 * @notice Mock implementation that returns 0% commission for all operations
 * @dev Use this for testing/development when you need CommissionManager interface but no actual fees
 *
 * Key Differences from Real CommissionManager:
 * - All commission calculations return 0 (no fees charged)
 * - Configuration functions work but don't affect calculations
 * - Events are still emitted for observability
 * - Same interface for drop-in replacement
 *
 * Use Cases:
 * - Testing Bridge contract without commission deductions
 * - Development environments
 * - Integration testing
 * - Temporary deployment before real CommissionManager is ready
 */
contract CommissionManager is Ownable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct CommissionConfig {
        uint256 stablePercent; // Stored but not used in calculations
        uint256 gasEstimate; // Stored but not used in calculations
        uint8 multiplier; // Stored but not used in calculations
        CommissionSide side; // Stored but not used in calculations
        CommissionCurrency currency; // Stored but not used in calculations
        bool isSet; // Stored but not used in calculations
    }

    // ============ Enums ============
    enum CommissionSide {
        FUNDS_IN,
        FUNDS_OUT
    }
    enum CommissionCurrency {
        TOKEN,
        NATIVE
    }

    // ============ State Variables ============

    // Bridge address (only bridge can send commissions)
    address public bridgeAddress;

    // Global defaults (stored but not used in mock)
    uint256 public globalStablePercent = 400; // Mock: Always 0%
    uint256 public globalGasEstimate = 0;
    uint8 public globalMultiplier = 100;
    CommissionSide public globalSide = CommissionSide.FUNDS_IN;
    CommissionCurrency public globalCurrency = CommissionCurrency.TOKEN;

    // Constants
    uint256 private constant _MAX_STABLE_PERCENT = 9000; // 90%
    uint256 private constant _HUNDRED_PERCENT = 10000;

    // Per-route overrides
    // key = keccak256(abi.encodePacked(sourceChain, destChain, tokenAddress))
    mapping(bytes32 => CommissionConfig) public commissionRules;

    // Accumulated fees (can still track even though fees are 0)
    mapping(address => uint256) public tokenCommissionPool;
    uint256 public nativeCommissionPool;

    // ============ Events ============

    event BridgeAddressUpdated(address indexed newBridge);

    event GlobalDefaultsUpdated(
        uint256 stablePercent,
        uint8 multiplier,
        CommissionSide side,
        CommissionCurrency currency
    );

    event CommissionRuleUpdated(
        string sourceChain,
        string destChain,
        address indexed token,
        CommissionConfig config
    );

    event CommissionRuleCleared(
        string sourceChain,
        string destChain,
        address indexed token
    );

    event TokenCommissionReceived(address indexed token, uint256 amount);
    event NativeCommissionReceived(uint256 amount);
    event TokenCommissionWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );
    event NativeCommissionWithdrawn(address indexed to, uint256 amount);

    // ============ Modifiers ============

    modifier onlyBridge() {
        require(msg.sender == bridgeAddress, "CommissionManager: Only bridge");
        _;
    }

    // ============ Constructor ============

    constructor(address _bridgeAddress) {
        require(
            _bridgeAddress != address(0),
            "CommissionManager: Invalid bridge address"
        );
        bridgeAddress = _bridgeAddress;
    }

    // ============ Core Calculation Functions (MOCKED - Always Return 0) ============

    /**
     * @notice Calculate commission for fundsIn operation
     * @param sourceChain Source chain identifier
     * @param destChain Destination chain identifier
     * @param token Token address
     * @param amount Amount being bridged
     * @param tokenToNativeRate Oracle rate: wei per token unit
     * @param tokenDecimals Token decimals
     * @return tokenCommission Commission in token units
     * @return nativeCommission Commission in native units (wei)
     * @return netAmount Amount after commission deduction
     */
    function calculateFundsInCommission(
        string calldata sourceChain,
        string calldata destChain,
        address token,
        uint256 amount,
        uint256 tokenToNativeRate,
        uint256 tokenDecimals
    )
        external
        pure
        returns (
            uint256 tokenCommission,
            uint256 nativeCommission,
            uint256 netAmount
        )
    {
        bytes32 ruleKey = keccak256(abi.encodePacked(sourceChain, destChain, token));
        CommissionConfig memory config = getEffectiveConfig(ruleKey);

        // Only calculate if this config is for FUNDS_IN
        if (config.side != CommissionSide.FUNDS_IN) {
            return (0, 0, amount);
        }

        // Calculate stable fee in token units
        uint256 stableFee = calculateStableFee(amount, config.stablePercent, config.multiplier);

        if (config.currency == CommissionCurrency.TOKEN) {
            // TOKEN commission: deduct from amount
            tokenCommission = stableFee;
            nativeCommission = 0;
            netAmount = amount - tokenCommission;
        } else {
            // NATIVE commission: user pays in ETH/BNB via msg.value
            tokenCommission = 0;
            nativeCommission = calculateNativeCommission(
                stableFee,
                tokenToNativeRate,
                tokenDecimals
            );
            netAmount = amount; // Full amount bridges
        }
    }

    /**
     * @notice Calculate commission for fundsOut operation
     * @param sourceChain Source chain identifier
     * @param destChain Destination chain identifier
     * @param token Token address
     * @param amount Amount to be released
     * @param tokenToNativeRate Oracle rate: wei per token unit (for native commission)
     * @param tokenDecimals Token decimals
     * @return tokenCommission Commission in token units
     * @return nativeCommission Commission in native units (wei)
     * @return netAmount Amount user receives after commission
     */
    function calculateFundsOutCommission(
        string calldata sourceChain,
        string calldata destChain,
        address token,
        uint256 amount,
        uint256 tokenToNativeRate,
        uint256 tokenDecimals
    )
        external
        pure
        returns (
            uint256 tokenCommission,
            uint256 nativeCommission,
            uint256 netAmount
        )
    {
        bytes32 ruleKey = keccak256(abi.encodePacked(sourceChain, destChain, token));
        CommissionConfig memory config = getEffectiveConfig(ruleKey);

        // Only calculate if this config is for FUNDS_OUT
        if (config.side != CommissionSide.FUNDS_OUT) {
            return (0, 0, amount);
        }

        // Calculate stable fee
        uint256 stableFee = calculateStableFee(amount, config.stablePercent, config.multiplier);

        if (config.currency == CommissionCurrency.TOKEN) {
            tokenCommission = stableFee;
            nativeCommission = 0;
            netAmount = amount - tokenCommission;
        } else {
            // NATIVE commission for fundsOut: deduct equivalent from tokens
            tokenCommission = 0;
            nativeCommission = calculateNativeCommission(
                stableFee,
                tokenToNativeRate,
                tokenDecimals
            );
            netAmount = amount;
        }
    }

    /**
     * @notice Calculate stable commission fee
     * @param amount Token amount
     * @param stablePercent Percent * 100 (e.g., 400 = 4%)
     * @param multiplier Usually 100
     * @return Fee in token units
     */
    function calculateStableFee(
        uint256 amount,
        uint256 stablePercent,
        uint256 multiplier
    ) public pure returns (uint256) {
        return (amount * stablePercent) / multiplier / multiplier;
    }

    /**
     * @notice Convert token fee to native currency
     * @param tokenFee Fee amount in token units
     * @param tokenToNativeRate Oracle rate: wei per token unit
     * @param tokenDecimals Token decimals
     * @return nativeFee Fee in native currency (wei)
     */
    function calculateNativeCommission(
        uint256 tokenFee,
        uint256 tokenToNativeRate,
        uint256 tokenDecimals
    ) public pure returns (uint256 nativeFee) {
        nativeFee = (tokenFee * tokenToNativeRate) / (10 ** tokenDecimals);
    }

    // ============ Configuration Functions (Stored but Not Used) ============

    /**
     * @notice Set global default commission parameters
     * @param stablePercent Default stable percent (e.g., 400 = 4%)
     * @param multiplier Default multiplier (usually 100)
     * @param side Default commission side (FUNDS_IN or FUNDS_OUT)
     * @param currency Default commission currency (TOKEN or NATIVE)
     */
    function setGlobalDefaults(
        uint256 stablePercent,
        uint8 multiplier,
        CommissionSide side,
        CommissionCurrency currency
    ) external onlyOwner {
        require(
            stablePercent <= _MAX_STABLE_PERCENT,
            "CommissionManager: Percent too high"
        );
        require(
            multiplier > 0,
            "CommissionManager: Multiplier must be nonzero"
        );
        require(
            stablePercent > 0,
            "CommissionManager: Percent must be nonzero"
        );

        globalStablePercent = stablePercent;
        globalMultiplier = multiplier;
        globalSide = side;
        globalCurrency = currency;

        emit GlobalDefaultsUpdated(stablePercent, multiplier, side, currency);
    }

    /**
     * @notice Set commission rule for a specific route
     * @param sourceChain Source chain identifier
     * @param destChain Destination chain identifier
     * @param token Token address
     * @param config Commission configuration
     */
    function setCommissionRule(
        string calldata sourceChain,
        string calldata destChain,
        address token,
        CommissionConfig calldata config
    ) external onlyOwner {
        // Validate config
        require(
            config.stablePercent <= _MAX_STABLE_PERCENT,
            "CommissionManager: Percent too high"
        );
        require(config.stablePercent > 0, "Percent must be nonzero");
        require(
            config.multiplier > 0,
            "CommissionManager: Multiplier must be nonzero"
        );

        // Build route key
        bytes32 key = keccak256(
            abi.encodePacked(sourceChain, destChain, token)
        );

        // Store config (but won't be used in mock calculations)
        commissionRules[key] = config;
        commissionRules[key].isSet = true;

        emit CommissionRuleUpdated(sourceChain, destChain, token, config);
    }

    /**
     * @notice Clear route-specific config (revert to global defaults)
     * @param sourceChain Source chain identifier
     * @param destChain Destination chain identifier
     * @param token Token address
     */
    function clearCommissionRule(
        string calldata sourceChain,
        string calldata destChain,
        address token
    ) external onlyOwner {
        bytes32 key = keccak256(
            abi.encodePacked(sourceChain, destChain, token)
        );
        delete commissionRules[key];
        emit CommissionRuleCleared(sourceChain, destChain, token);
    }

    /**
     * @notice Update bridge address
     * @param newBridge New bridge contract address
     */
    function setBridgeAddress(address newBridge) external onlyOwner {
        require(
            newBridge != address(0),
            "CommissionManager: Invalid bridge address"
        );
        bridgeAddress = newBridge;
        emit BridgeAddressUpdated(newBridge);
    }

    // ============ View Functions ============

    /**
     * @notice Get effective configuration for a route (with fallback to globals)
     * @param ruleKey Route key (keccak256 of sourceChain, destChain, token)
     * @return Effective commission configuration
     */
    function getEffectiveConfig(
        bytes32 ruleKey
    ) internal view returns (CommissionConfig memory) {
        CommissionConfig memory config = commissionRules[ruleKey];

        if (config.isSet) {
            return config;
        }

        // Fall back to global defaults
        return
            CommissionConfig({
                stablePercent: globalStablePercent,
                gasEstimate: globalGasEstimate,
                multiplier: globalMultiplier,
                side: globalSide,
                currency: globalCurrency,
                isSet: true
            });
    }

    /**
     * @notice Get global default configuration
     * @return stablePercent Global stable percent
     * @return multiplier Global multiplier
     * @return side Global commission side
     * @return currency Global commission currency
     */
    function getGlobalDefaults()
        external
        view
        returns (
            uint256 stablePercent,
            uint8 multiplier,
            CommissionSide side,
            CommissionCurrency currency
        )
    {
        return (
            globalStablePercent,
            globalMultiplier,
            globalSide,
            globalCurrency
        );
    }

    /**
     * @notice Get commission rule for a specific route
     * @param sourceChain Source chain identifier
     * @param destChain Destination chain identifier
     * @param token Token address
     * @return Commission configuration for the route
     */
    function getCommissionRule(
        string calldata sourceChain,
        string calldata destChain,
        address token
    ) external view returns (CommissionConfig memory) {
        bytes32 ruleKey = keccak256(
            abi.encodePacked(sourceChain, destChain, token)
        );
        return commissionRules[ruleKey];
    }

    // ============ Commission Collection Functions ============

    /**
     * @notice Receive token commission from bridge
     * @param token Token address
     * @param amount Commission amount
     */
    function receiveTokenCommission(
        address token,
        uint256 amount
    ) external onlyBridge {
        require (amount > 0, "CommissionManager: Amount must be positive");
        tokenCommissionPool[token] += amount;
        emit TokenCommissionReceived(token, amount);
    }

    /**
     * @notice Receive native commission from bridge
     * @dev Called via payable function or direct transfer
     */
    receive() external payable onlyBridge {
        require(msg.value > 0, "CommissionManager: Amount must be positive");
        nativeCommissionPool += msg.value;
        emit NativeCommissionReceived(msg.value);
    }

    // ============ Withdrawal Functions ============

    /**
     * @notice Withdraw token commission
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawTokenCommission(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "CommissionManager: Invalid recipient");
        require(
            tokenCommissionPool[token] >= amount,
            "CommissionManager: Insufficient balance"
        );

        tokenCommissionPool[token] -= amount;
        IERC20(token).safeTransfer(to, amount);

        emit TokenCommissionWithdrawn(token, to, amount);
    }

    /**
     * @notice Withdraw native commission
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawNativeCommission(
        address payable to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "CommissionManager: Invalid recipient");
        require(
            nativeCommissionPool >= amount,
            "CommissionManager: Insufficient balance"
        );

        nativeCommissionPool -= amount;
        (bool success, ) = to.call{value: amount}("");
        require(success, "CommissionManager: Native transfer failed");

        emit NativeCommissionWithdrawn(to, amount);
    }
}
