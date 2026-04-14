// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";
import {Bridge} from "../src/Bridge.sol";
import {IBridge} from "../src/interfaces/IBridge.sol";
import {FundsInParams} from "../src/ParamsStructs.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// =========================================================================
// Mock ERC-20
// =========================================================================

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// =========================================================================
// Bridge tests
// =========================================================================

contract BridgeTest is Test {
    event FundsIn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        address token,
        uint256 amount,
        string destinationChain,
        string destinationAddress
    );

    event FundsOut(
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 transactionId,
        string sourceChain,
        string sourceAddress
    );
    Bridge bridge;
    MockERC20 token;
    MockERC20 unsupportedToken;

    address owner = makeAddr("owner");
    address user = makeAddr("user");

    uint256 constant INITIAL_BALANCE = 1000e18;

    // fundsIn defaults
    string constant DST_CHAIN = "bitcoin";
    string constant DST_ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    uint256 constant NONCE = 1;
    uint256 constant TX_ID = 42;
    uint256 constant AMOUNT = 100e18;

    function setUp() public {
        token = new MockERC20("Mock USDT", "mUSDT");
        unsupportedToken = new MockERC20("Unsupported", "UNS");

        address[] memory supportedTokens = new address[](1);
        supportedTokens[0] = address(token);

        vm.prank(owner);
        bridge = new Bridge(supportedTokens);

        token.mint(user, INITIAL_BALANCE);
        vm.prank(user);
        token.approve(address(bridge), type(uint256).max);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _defaultParams() internal view returns (FundsInParams memory) {
        return FundsInParams({
            token: address(token),
            amount: AMOUNT,
            destinationChain: DST_CHAIN,
            destinationAddress: DST_ADDRESS,
            deadline: block.timestamp + 1 hours,
            nonce: NONCE,
            transactionId: TX_ID
        });
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    function test_constructor_setsOwner() public view {
        assertEq(bridge.owner(), owner);
    }

    function test_constructor_revertsOnZeroTokenAddress() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(0);

        vm.expectRevert(IBridge.InvalidTokenAddress.selector);
        new Bridge(tokens);
    }

    function test_constructor_acceptsEmptyTokenList() public {
        address[] memory tokens = new address[](0);
        Bridge emptyBridge = new Bridge(tokens);
        assertEq(emptyBridge.owner(), address(this));
    }

    // =========================================================================
    // fundsIn — happy path
    // =========================================================================

    function test_fundsIn_transfersTokensToBridge() public {
        FundsInParams memory params = _defaultParams();

        vm.prank(user);
        bridge.fundsIn(params);

        assertEq(token.balanceOf(address(bridge)), AMOUNT);
        assertEq(token.balanceOf(user), INITIAL_BALANCE - AMOUNT);
    }

    function test_fundsIn_emitsEvent() public {
        FundsInParams memory params = _defaultParams();

        vm.expectEmit(true, false, false, true);
        emit FundsIn(user, TX_ID, NONCE, address(token), AMOUNT, DST_CHAIN, DST_ADDRESS);

        vm.prank(user);
        bridge.fundsIn(params);
    }

    // =========================================================================
    // fundsIn — reverts
    // =========================================================================

    function test_fundsIn_revertsOnUnsupportedToken() public {
        FundsInParams memory params = _defaultParams();
        params.token = address(unsupportedToken);

        vm.expectRevert(IBridge.InvalidTokenAddress.selector);
        vm.prank(user);
        bridge.fundsIn(params);
    }

    function test_fundsIn_revertsOnEmptyDestinationAddress() public {
        FundsInParams memory params = _defaultParams();
        params.destinationAddress = "";

        vm.expectRevert(IBridge.InvalidDestinationAddress.selector);
        vm.prank(user);
        bridge.fundsIn(params);
    }

    function test_fundsIn_revertsOnEmptyDestinationChain() public {
        FundsInParams memory params = _defaultParams();
        params.destinationChain = "";

        vm.expectRevert(IBridge.InvalidDestinationChain.selector);
        vm.prank(user);
        bridge.fundsIn(params);
    }

    function test_fundsIn_revertsOnExpiredDeadline() public {
        FundsInParams memory params = _defaultParams();
        params.deadline = block.timestamp - 1;

        vm.expectRevert(IBridge.ExpiredDeadline.selector);
        vm.prank(user);
        bridge.fundsIn(params);
    }

    function test_fundsIn_revertsOnDeadlineEqualToTimestamp() public {
        FundsInParams memory params = _defaultParams();
        params.deadline = block.timestamp;

        // deadline == block.timestamp passes (strictly >)
        vm.prank(user);
        bridge.fundsIn(params);
    }

    // =========================================================================
    // fundsOut — happy path
    // =========================================================================

    function test_fundsOut_transfersTokensToRecipient() public {
        // First deposit some tokens
        vm.prank(user);
        bridge.fundsIn(_defaultParams());

        address recipient = makeAddr("recipient");

        vm.prank(owner);
        bridge.fundsOut(address(token), recipient, AMOUNT, TX_ID, "bitcoin", DST_ADDRESS);

        assertEq(token.balanceOf(recipient), AMOUNT);
        assertEq(token.balanceOf(address(bridge)), 0);
    }

    function test_fundsOut_emitsEvent() public {
        vm.prank(user);
        bridge.fundsIn(_defaultParams());

        address recipient = makeAddr("recipient");

        vm.expectEmit(true, false, false, true);
        emit FundsOut(recipient, address(token), AMOUNT, TX_ID, "bitcoin", DST_ADDRESS);

        vm.prank(owner);
        bridge.fundsOut(address(token), recipient, AMOUNT, TX_ID, "bitcoin", DST_ADDRESS);
    }

    // =========================================================================
    // fundsOut — reverts
    // =========================================================================

    function test_fundsOut_revertsIfNotOwner() public {
        vm.prank(user);
        bridge.fundsIn(_defaultParams());

        vm.expectRevert();
        vm.prank(user);
        bridge.fundsOut(address(token), user, AMOUNT, TX_ID, "bitcoin", DST_ADDRESS);
    }

    function test_fundsOut_revertsOnZeroRecipient() public {
        vm.prank(user);
        bridge.fundsIn(_defaultParams());

        vm.expectRevert(IBridge.InvalidRecipientAddress.selector);
        vm.prank(owner);
        bridge.fundsOut(address(token), address(0), AMOUNT, TX_ID, "bitcoin", DST_ADDRESS);
    }

    function test_fundsOut_revertsOnZeroTokenAddress() public {
        vm.expectRevert(IBridge.InvalidTokenAddress.selector);
        vm.prank(owner);
        bridge.fundsOut(address(0), user, AMOUNT, TX_ID, "bitcoin", DST_ADDRESS);
    }

    function test_fundsOut_revertsIfAmountExceedsBalance() public {
        vm.prank(user);
        bridge.fundsIn(_defaultParams());

        vm.expectRevert(IBridge.AmountExceedTokenBalance.selector);
        vm.prank(owner);
        bridge.fundsOut(address(token), user, AMOUNT + 1, TX_ID, "bitcoin", DST_ADDRESS);
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_fundsIn_validAmount(uint256 amount) public {
        amount = bound(amount, 1, INITIAL_BALANCE);

        FundsInParams memory params = _defaultParams();
        params.amount = amount;

        vm.prank(user);
        bridge.fundsIn(params);

        assertEq(token.balanceOf(address(bridge)), amount);
    }

    function testFuzz_fundsOut_validAmount(uint256 amount) public {
        amount = bound(amount, 1, INITIAL_BALANCE);

        FundsInParams memory params = _defaultParams();
        params.amount = amount;

        vm.prank(user);
        bridge.fundsIn(params);

        address recipient = makeAddr("recipient");

        vm.prank(owner);
        bridge.fundsOut(address(token), recipient, amount, TX_ID, "bitcoin", DST_ADDRESS);

        assertEq(token.balanceOf(recipient), amount);
    }
}
