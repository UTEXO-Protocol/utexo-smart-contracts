// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CommissionManager
 * @notice Non-upgradeable commission calculation, configuration, and fee collection for the EVM bridge
 * @dev Aligns with blueprint v3: global defaults + per-route overrides, full on-chain stable/native math
 */
contract CommissionManager is Ownable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct CommissionConfig {
        uint256 stablePercent; // Percent * 100 (e.g. 400 = 4%)
        uint256 gasEstimate; // Reserved for future gas-based logic (blueprint field)
        uint8 multiplier; // Usually 100
        CommissionSide side; // FUNDS_IN or FUNDS_OUT
        CommissionCurrency currency; // TOKEN or NATIVE
        bool isSet; // true = explicit route rule; false = fall back to globals
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

    // Global defaults (when route rule is not set)
    uint256 public globalStablePercent = 400; // 4% default
    uint256 public globalGasEstimate = 0;
    uint8 public globalMultiplier = 100;
    CommissionSide public globalSide = CommissionSide.FUNDS_IN;
    CommissionCurrency public globalCurrency = CommissionCurrency.TOKEN;

    // Constants
    uint256 private constant _MAX_STABLE_PERCENT = 9000; // 90%

    // Per-route overrides
    // key = keccak256(abi.encode(sourceChain, destChain, tokenAddress))
    mapping(bytes32 => CommissionConfig) public commissionRules;

    // Accumulated fees
    mapping(address => uint256) public tokenCommissionPool;
    uint256 public nativeCommissionPool;

    /// @dev Mock wei-per-token-unit rate for NATIVE commission; used when `mockTokenToNativeRateForToken[token]` is zero.
    uint256 public mockTokenToNativeRate;
    /// @dev Optional per-token mock; zero means use `mockTokenToNativeRate`.
    mapping(address => uint256) public mockTokenToNativeRateForToken;

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

    event MockTokenToNativeRateUpdated(uint256 rate);
    event MockTokenToNativeRateForTokenUpdated(address indexed token, uint256 rate);

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

    constructor(address _bridgeAddress) Ownable(msg.sender) {
        require(
            _bridgeAddress != address(0),
            "CommissionManager: Invalid bridge address"
        );
        bridgeAddress = _bridgeAddress;
    }

    // ============ Core Calculation Functions ============

    /**
     * @notice Calculate commission for fundsIn operation
     * @param sourceChain Source chain identifier
     * @param destChain Destination chain identifier
     * @param token Token address
     * @param amount Amount being bridged
     * @return tokenCommission Commission in token units
     * @return nativeCommission Commission in native units (wei)
     * @return netAmount Amount after commission deduction
     * @dev Token decimals are read from the token via ERC-20 metadata. Native commission uses owner-set mock rates.
     */
    function calculateFundsInCommission(
        string calldata sourceChain,
        string calldata destChain,
        address token,
        uint256 amount
    )
        external
        view
        returns (
            uint256 tokenCommission,
            uint256 nativeCommission,
            uint256 netAmount
        )
    {
        bytes32 ruleKey = buildRouteKey(sourceChain, destChain, token);
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
            uint256 rate = resolvedMockTokenToNativeRate(token);
            require(rate > 0, "CommissionManager: mock token to native rate not set");
            nativeCommission = convertTokenToNative(
                stableFee,
                rate,
                _tokenDecimals(token)
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
     * @return tokenCommission Commission in token units
     * @return nativeCommission Commission in native units (wei)
     * @return netAmount Amount user receives after commission
     * @dev See `calculateFundsInCommission` for decimals and native rate sourcing.
     */
    function calculateFundsOutCommission(
        string calldata sourceChain,
        string calldata destChain,
        address token,
        uint256 amount
    )
        external
        view
        returns (
            uint256 tokenCommission,
            uint256 nativeCommission,
            uint256 netAmount
        )
    {
        bytes32 ruleKey = buildRouteKey(sourceChain, destChain, token);
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
            // NATIVE commission for fundsOut: user pays in native (per blueprint)
            tokenCommission = 0;
            uint256 rate = resolvedMockTokenToNativeRate(token);
            require(rate > 0, "CommissionManager: mock token to native rate not set");
            nativeCommission = convertTokenToNative(
                stableFee,
                rate,
                _tokenDecimals(token)
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
     * @notice Convert token-denominated fee to native (wei) (blueprint: convertTokenToNative)
     * @param tokenFee Fee amount in token smallest units
     * @param rateWeiPerTokenUnit Wei per 1 whole token in smallest units, matching mock rate units
     * @param tokenDecimals Token decimals (e.g. 6 for USDT)
     * @return nativeFee Native amount in wei
     */
    function convertTokenToNative(
        uint256 tokenFee,
        uint256 rateWeiPerTokenUnit,
        uint256 tokenDecimals
    ) public pure returns (uint256 nativeFee) {
        nativeFee = (tokenFee * rateWeiPerTokenUnit) / (10 ** tokenDecimals);
    }

    /**
     * @notice Resolved mock rate for `token` (per-token mock if set, else global mock).
     */
    function resolvedMockTokenToNativeRate(address token) public view returns (uint256) {
        uint256 r = mockTokenToNativeRateForToken[token];
        if (r != 0) return r;
        return mockTokenToNativeRate;
    }

    function _tokenDecimals(address token) internal view returns (uint256) {
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            return uint256(d);
        } catch {
            revert("CommissionManager: decimals unavailable");
        }
    }

    // ============ Configuration Functions ============

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
     * @notice Set global mock wei-per-token rate for NATIVE commission (used when per-token mock is unset).
     */
    function setMockTokenToNativeRate(uint256 rate) external onlyOwner {
        mockTokenToNativeRate = rate;
        emit MockTokenToNativeRateUpdated(rate);
    }

    /**
     * @notice Set per-token mock rate; pass 0 to clear and use global `mockTokenToNativeRate`.
     */
    function setMockTokenToNativeRateForToken(address token, uint256 rate) external onlyOwner {
        require(token != address(0), "CommissionManager: Invalid token");
        mockTokenToNativeRateForToken[token] = rate;
        emit MockTokenToNativeRateForTokenUpdated(token, rate);
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
        require(
            config.stablePercent > 0,
            "CommissionManager: Percent must be nonzero"
        );
        require(
            config.multiplier > 0,
            "CommissionManager: Multiplier must be nonzero"
        );

        // Build route key
        bytes32 key = buildRouteKey(sourceChain, destChain, token);

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
        bytes32 key = buildRouteKey(sourceChain, destChain, token);
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
        bytes32 ruleKey = buildRouteKey(sourceChain, destChain, token);
        return commissionRules[ruleKey];
    }

    /**
     * @notice keccak256(abi.encode(sourceChain, destChain, token))
     * @dev Uses abi.encode (not encodePacked) so dynamic string arguments cannot be concatenated ambiguously.
     */
    function buildRouteKey(
        string calldata sourceChain,
        string calldata destChain,
        address token
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(sourceChain, destChain, token));
    }

    // ============ Commission Collection Functions ============

    /**
     * @notice Receive token commission from bridge
     * @dev Credits the actual ERC-20 balance increase since the last recorded pool for this token.
     *      The bridge must transfer tokens to this contract before calling; the `amount` is not taken
     *      from calldata so accounting matches real transfers (including fee-on-transfer tokens).
     * @param token Token address
     */
    function receiveTokenCommission(address token) external onlyBridge {
        uint256 newBalance = IERC20(token).balanceOf(address(this));
        uint256 priorPool = tokenCommissionPool[token];
        require(
            newBalance >= priorPool,
            "CommissionManager: balance below recorded pool"
        );
        uint256 recorded = newBalance - priorPool;
        require(recorded > 0, "CommissionManager: nothing received");
        tokenCommissionPool[token] = newBalance;
        emit TokenCommissionReceived(token, recorded);
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

    /**
     * @notice Withdraw entire token commission balance for one token
     */
    function withdrawAllTokenCommission(address token, address to) external onlyOwner {
        uint256 balance = tokenCommissionPool[token];
        require(balance > 0, "CommissionManager: No balance");

        tokenCommissionPool[token] = 0;
        IERC20(token).safeTransfer(to, balance);

        emit TokenCommissionWithdrawn(token, to, balance);
    }

    /**
     * @notice Withdraw entire native commission balance
     */
    function withdrawAllNativeCommission(address payable to) external onlyOwner {
        uint256 balance = nativeCommissionPool;
        require(balance > 0, "CommissionManager: No balance");

        nativeCommissionPool = 0;
        (bool success, ) = to.call{value: balance}("");
        require(success, "CommissionManager: Native transfer failed");

        emit NativeCommissionWithdrawn(to, balance);
    }
}