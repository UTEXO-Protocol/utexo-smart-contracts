// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Test } from 'forge-std/Test.sol';
import { Bridge }    from '../src/Bridge.sol';
import { IBridge }   from '../src/interfaces/IBridge.sol';
import { BridgeBase } from '../src/BridgeBase.sol';
import { MockERC20 } from './helpers/MockERC20.sol';
import { MockBtcRelay } from './helpers/MockBtcRelay.sol';
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
        string  sourceAddress,
        uint256 blockHeight,
        bytes32 commitmentHash
    );

    Bridge       bridge;
    MockERC20    usdt0;
    MockBtcRelay btcRelay;

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

    // BtcRelay test data
    uint256 constant BLOCK_HEIGHT     = 850_000;
    bytes32 constant COMMITMENT_HASH  = keccak256('test-btc-block-commitment');
    uint256 constant CONFIRMATIONS    = 6;

    function setUp() public {
        usdt0    = new MockERC20('Mock USDT0', 'USDT0');
        btcRelay = new MockBtcRelay();

        // Register a valid block in the mock relay
        btcRelay.setBlock(BLOCK_HEIGHT, COMMITMENT_HASH, CONFIRMATIONS);

        vm.prank(deployer);
        bridge = new Bridge(address(usdt0), address(btcRelay));

        // deployer transfers ownership to multisig (production flow)
        vm.prank(deployer);
        bridge.transferOwnership(multisig);

        // fund user and approve bridge
        usdt0.mint(user, AMOUNT * 10);
        vm.prank(user);
        usdt0.approve(address(bridge), type(uint256).max);
    }

    // ========================================================================
    // helpers
    // ========================================================================

    function _singleFundsInId() internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = TX_ID;
    }

    // ========================================================================
    // Constructor
    // ========================================================================

    function test_constructor_setsTokenOwnerAndBtcRelay() public view {
        assertEq(bridge.TOKEN(), address(usdt0));
        assertEq(bridge.owner(), multisig);
        assertEq(bridge.btcRelay(), address(btcRelay));
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(BridgeBase.InvalidTokenAddress.selector);
        new Bridge(address(0), address(btcRelay));
    }

    function test_constructor_revertsOnZeroBtcRelay() public {
        vm.expectRevert(IBridge.InvalidBtcRelayAddress.selector);
        new Bridge(address(usdt0), address(0));
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

    function test_fundsIn_storesRecord() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        assertEq(bridge.fundsInRecords(TX_ID), AMOUNT);
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

    function test_fundsIn_revertsOnDuplicateTransactionId() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(IBridge.DuplicateTransactionId.selector);
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);
    }

    // ========================================================================
    // fundsOut — happy path
    // ========================================================================

    function test_fundsOut_transfersAndEmits() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectEmit(true, false, false, true);
        emit BridgeFundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH);

        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());

        assertEq(usdt0.balanceOf(recipient),       AMOUNT);
        assertEq(usdt0.balanceOf(address(bridge)), 0);
    }

    function test_fundsOut_consumesFundsInRecord() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());

        // Record should be deleted after consumption
        assertEq(bridge.fundsInRecords(TX_ID), 0);
    }

    function test_fundsOut_multipleFundsInIds() public {
        uint256 txId1 = 100;
        uint256 txId2 = 101;
        uint256 amount1 = 60e18;
        uint256 amount2 = 40e18;

        vm.prank(user);
        bridge.fundsIn(amount1, DST_CHAIN, DST_ADDR, NONCE, txId1);
        vm.prank(user);
        bridge.fundsIn(amount2, DST_CHAIN, DST_ADDR, NONCE, txId2);

        uint256[] memory ids = new uint256[](2);
        ids[0] = txId1;
        ids[1] = txId2;

        vm.prank(multisig);
        bridge.fundsOut(recipient, amount1 + amount2, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, ids);

        assertEq(usdt0.balanceOf(recipient), amount1 + amount2);
        assertEq(bridge.fundsInRecords(txId1), 0);
        assertEq(bridge.fundsInRecords(txId2), 0);
    }

    function test_fundsOut_partialAmount() public {
        // fundsOut amount can be less than total fundsIn amount
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        uint256 partialAmount = AMOUNT / 2;

        vm.prank(multisig);
        bridge.fundsOut(recipient, partialAmount, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());

        assertEq(usdt0.balanceOf(recipient), partialAmount);
    }

    // ========================================================================
    // fundsOut — BtcRelay verification
    // ========================================================================

    function test_fundsOut_revertsOnUnverifiedBlock() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        uint256 unknownHeight = 999_999;
        bytes32 unknownHash = keccak256('unknown-block');

        vm.expectRevert('verify: block commitment');
        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, unknownHeight, unknownHash, _singleFundsInId());
    }

    // ========================================================================
    // fundsOut — fundsIn verification reverts
    // ========================================================================

    function test_fundsOut_revertsOnUnknownFundsInId() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 999; // non-existent fundsIn

        vm.expectRevert(abi.encodeWithSelector(IBridge.FundsInNotFound.selector, 999));
        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, ids);
    }

    function test_fundsOut_revertsOnAmountExceedsFundsIn() public {
        // Two fundsIn deposits, but reference only one in fundsOut
        uint256 txId1 = 100;
        uint256 txId2 = 101;
        vm.prank(user);
        bridge.fundsIn(50e18, DST_CHAIN, DST_ADDR, NONCE, txId1);
        vm.prank(user);
        bridge.fundsIn(50e18, DST_CHAIN, DST_ADDR, NONCE, txId2);

        // Pool has 100e18, but we reference only txId1 (50e18) and try to withdraw 60e18
        uint256[] memory ids = new uint256[](1);
        ids[0] = txId1;

        vm.expectRevert(IBridge.FundsOutAmountExceedsFundsIn.selector);
        vm.prank(multisig);
        bridge.fundsOut(recipient, 60e18, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, ids);
    }

    function test_fundsOut_revertsOnDoubleSpendsConsumedFundsIn() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        // First fundsOut — succeeds
        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());

        // Fund the bridge again (so pool has tokens) to isolate the fundsIn check
        usdt0.mint(address(bridge), AMOUNT);

        // Second fundsOut with same fundsInId — should revert
        vm.expectRevert(abi.encodeWithSelector(IBridge.FundsInNotFound.selector, TX_ID));
        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT, TX_ID + 1, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());
    }

    // ========================================================================
    // fundsOut — other reverts
    // ========================================================================

    function test_fundsOut_revertsIfNotOwner() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        bridge.fundsOut(recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());
    }

    function test_fundsOut_revertsOnZeroRecipient() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(BridgeBase.InvalidRecipientAddress.selector);
        vm.prank(multisig);
        bridge.fundsOut(address(0), AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());
    }

    function test_fundsOut_revertsIfAmountExceedsPool() public {
        vm.prank(user);
        bridge.fundsIn(AMOUNT, DST_CHAIN, DST_ADDR, NONCE, TX_ID);

        vm.expectRevert(BridgeBase.AmountExceedBridgePool.selector);
        vm.prank(multisig);
        bridge.fundsOut(recipient, AMOUNT + 1, TX_ID, SRC_CHAIN, SRC_ADDR, BLOCK_HEIGHT, COMMITMENT_HASH, _singleFundsInId());
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
        assertEq(bridge.fundsInRecords(TX_ID), amount);
    }
}
