// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Test } from 'forge-std/Test.sol';
import { Bridge }    from '../src/Bridge.sol';
import { IBridge }   from '../src/interfaces/IBridge.sol';
import { BridgeBase } from '../src/BridgeBase.sol';
import { MockERC20 } from './helpers/MockERC20.sol';
import { Ownable }   from '@openzeppelin/contracts/access/Ownable.sol';
import { Pausable }  from '@openzeppelin/contracts/utils/Pausable.sol';

contract BridgeTest is Test {
    // Events re-declared locally for vm.expectEmit
    event FundsIn(address indexed sender, uint256 operationId, uint256 amount);
    event BridgeFundsIn(
        address indexed sender,
        uint256 transactionId,
        uint256 nonce,
        uint256 amount,
        string  destinationChain,
        string  destinationAddress
    );
    event BridgeFundsOut(
        address indexed recipient,
        uint256 amount,
        uint256 transactionId,
        string  sourceChain,
        string  sourceAddress
    );

    Bridge     bridge;
    MockERC20  usdt0;

    address deployer  = makeAddr('deployer');
    address user      = makeAddr('user');
    address recipient = makeAddr('recipient');
    address multisig  = makeAddr('multisig');

    string  constant DST_CHAIN  = 'rgb';
    string  constant DST_ADDR   = 'rgb:asset1qp0y3mq6h5k8d9f2e4j7n6c3w/utxo1abc123';
    string  constant SRC_CHAIN  = 'rgb';
    string  constant SRC_ADDR   = 'rgb:sender/utxo1src';
    uint256 constant AMOUNT     = 100e18;
    uint256 constant TX_ID      = 42;
    uint256 constant NONCE      = 7;

    function setUp() public {
        usdt0 = new MockERC20('Mock USDT0', 'USDT0');

        vm.prank(deployer);
        bridge = new Bridge(address(usdt0));

        // deployer transfers ownership to multisig (production flow)
        vm.prank(deployer);
        bridge.transferOwnership(multisig);

        // fund user and approve bridge
        usdt0.mint(user, AMOUNT * 10);
        vm.prank(user);
        usdt0.approve(address(bridge), type(uint256).max);
    }

    // ========================================================================
    // Constructor
    // ========================================================================

    function test_constructor_setsTokenAndOwner() public view {
        assertEq(bridge.token(), address(usdt0));
        assertEq(bridge.owner(), multisig);
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(BridgeBase.InvalidTokenAddress.selector);
        new Bridge(address(0));
    }

    // ========================================================================
    // fundsIn — happy path
    // ========================================================================

    function test_fundsIn_transfersTokens() public {
        uint256 userBefore = usdt0.balanceOf(user);

        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        assertEq(usdt0.balanceOf(address(bridge)), AMOUNT);
        assertEq(usdt0.balanceOf(user),            userBefore - AMOUNT);
    }

    function test_fundsIn_emitsBothEvents() public {
        vm.expectEmit(true, false, false, true);
        emit FundsIn(user, TX_ID, AMOUNT);
        vm.expectEmit(true, false, false, true);
        emit BridgeFundsIn(user, TX_ID, NONCE, AMOUNT, DST_CHAIN, DST_ADDR);

        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);
    }

    function test_fundsIn_anyUserCanCall() public {
        address stranger = makeAddr('stranger');
        usdt0.mint(stranger, AMOUNT);
        vm.prank(stranger);
        usdt0.approve(address(bridge), AMOUNT);

        vm.prank(stranger);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        assertEq(usdt0.balanceOf(address(bridge)), AMOUNT);
    }

    // ========================================================================
    // fundsIn — reverts
    // ========================================================================

    function test_fundsIn_revertsOnEmptyDestinationAddress() public {
        vm.expectRevert(IBridge.InvalidDestinationAddress.selector);
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, '', NONCE, TX_ID);
    }

    function test_fundsIn_revertsOnEmptyDestinationChain() public {
        vm.expectRevert(IBridge.InvalidDestinationChain.selector);
        vm.prank(user);
        bridge.fundsIn(AMOUNT, '', DST_ADDR, NONCE, TX_ID);
    }

    function test_fundsIn_revertsWhenPaused() public {
        vm.prank(multisig);
        bridge.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);
    }

    // ========================================================================
    // fundsOut — happy path
    // ========================================================================

    function test_fundsOut_transfersAndEmits() public {
        // lock first
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectEmit(true, false, false, true);
        emit BridgeFundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR);

        vm.prank(multisig);
        bridge.fundsOut(address(usdt0), recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR);

        assertEq(usdt0.balanceOf(recipient),       AMOUNT);
        assertEq(usdt0.balanceOf(address(bridge)), 0);
    }

    // ========================================================================
    // fundsOut — reverts
    // ========================================================================

    function test_fundsOut_revertsIfNotOwner() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        bridge.fundsOut(address(usdt0), recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR);
    }

    function test_fundsOut_revertsOnZeroRecipient() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(BridgeBase.InvalidRecipientAddress.selector);
        vm.prank(multisig);
        bridge.fundsOut(address(usdt0), address(0), AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR);
    }

    function test_fundsOut_revertsOnWrongTokenAddress() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        address otherToken = makeAddr('otherToken');
        vm.expectRevert(BridgeBase.InvalidTokenAddress.selector);
        vm.prank(multisig);
        bridge.fundsOut(otherToken, recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR);
    }

    function test_fundsOut_revertsIfAmountExceedsPool() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(BridgeBase.AmountExceedBridgePool.selector);
        vm.prank(multisig);
        bridge.fundsOut(address(usdt0), recipient, AMOUNT + 1, TX_ID, SRC_CHAIN, SRC_ADDR);
    }

    // ========================================================================
    // pause / unpause / renounceOwnership
    // ========================================================================

    function test_pause_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        bridge.pause();
    }

    function test_unpause_onlyOwner() public {
        vm.prank(multisig);
        bridge.pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        bridge.unpause();
    }

    function test_renounceOwnership_alwaysReverts() public {
        vm.expectRevert(BridgeBase.RenounceOwnershipBlocked.selector);
        vm.prank(multisig);
        bridge.renounceOwnership();
    }

    // ========================================================================
    // views
    // ========================================================================

    function test_getContractBalance() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        assertEq(bridge.getContractBalance(), AMOUNT);
    }

    function test_getChainId() public view {
        assertEq(bridge.getChainId(), block.chainid);
    }

    // ========================================================================
    // Fuzz
    // ========================================================================

    function testFuzz_fundsIn_validAmount(uint128 amount) public {
        vm.assume(amount > 0);
        usdt0.mint(user, amount);

        vm.prank(user);
        bridge.fundsIn(amount, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        assertEq(usdt0.balanceOf(address(bridge)), amount);
    }
}
