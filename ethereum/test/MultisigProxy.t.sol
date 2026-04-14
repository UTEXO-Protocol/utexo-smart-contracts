// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Test } from 'forge-std/Test.sol';
import { MultisigProxy } from '../src/MultisigProxy.sol';
import { IMultisigProxy } from '../src/interfaces/IMultisigProxy.sol';
import { Bridge }    from '../src/Bridge.sol';
import { MockERC20 } from './helpers/MockERC20.sol';
import { MultisigHelper } from './helpers/MultisigHelper.sol';

contract MultisigProxyTest is Test {
    using MultisigHelper for bytes32;

    // Re-declared events
    event Executed(bytes4 indexed selector, uint256 nonce, uint256 enclaveBitmap);
    event EmergencyPaused(uint256 nonce, uint256 fedBitmap);
    event EmergencyUnpaused(uint256 nonce, uint256 fedBitmap);
    event ProposalCreated(
        bytes32 indexed proposalId,
        IMultisigProxy.OperationType indexed opType,
        bytes operationData,
        uint256 nonce,
        uint256 deadline,
        uint256 fedBitmap
    );
    event ProposalCancelled(bytes32 indexed proposalId);
    event ProposalExecuted(bytes32 indexed proposalId, IMultisigProxy.OperationType indexed opType);
    event EnclaveSignersUpdated(address[] newSigners, uint256 newThreshold);
    event FederationSignersUpdated(address[] newSigners, uint256 newThreshold);
    event BridgeAddressUpdated(address indexed oldBridge, address indexed newBridge);
    event TeeAllowedSelectorUpdated(bytes4 indexed selector, bool allowed);
    event TimelockDurationUpdated(uint256 newDuration);

    MultisigProxy proxy;
    Bridge        bridge;
    MockERC20     token;

    // Enclave signers (3-of-N with threshold 2)
    uint256 encPk1 = 0xE1;
    uint256 encPk2 = 0xE2;
    uint256 encPk3 = 0xE3;
    address encA1;
    address encA2;
    address encA3;

    // Federation signers (3-of-N with threshold 2)
    uint256 fedPk1 = 0xF1;
    uint256 fedPk2 = 0xF2;
    uint256 fedPk3 = 0xF3;
    address fedA1;
    address fedA2;
    address fedA3;

    address deployer           = makeAddr('deployer');
    address user               = makeAddr('user');
    address recipient          = makeAddr('recipient');
    address commissionReceiver = makeAddr('commissionReceiver');

    uint256 constant TIMELOCK = 1 hours;

    bytes32 domainSep;

    // Canonical constants for Bridge calls
    string  constant DST_CHAIN = 'rgb';
    string  constant DST_ADDR  = 'rgb:asset/utxo1abc';
    string  constant SRC_CHAIN = 'rgb';
    string  constant SRC_ADDR  = 'rgb:sender/utxo1src';
    uint256 constant AMOUNT    = 100e18;
    uint256 constant TX_ID     = 42;
    uint256 constant NONCE_OP  = 7;

    bytes4  constant FUNDS_OUT_SELECTOR = bytes4(keccak256('fundsOut(address,address,uint256,uint256,string,string)'));

    function setUp() public {
        encA1 = vm.addr(encPk1);
        encA2 = vm.addr(encPk2);
        encA3 = vm.addr(encPk3);
        fedA1 = vm.addr(fedPk1);
        fedA2 = vm.addr(fedPk2);
        fedA3 = vm.addr(fedPk3);

        token = new MockERC20('Mock USDT0', 'USDT0');

        vm.prank(deployer);
        bridge = new Bridge(address(token));

        address[] memory enc = new address[](3);
        enc[0] = encA1; enc[1] = encA2; enc[2] = encA3;

        address[] memory fed = new address[](3);
        fed[0] = fedA1; fed[1] = fedA2; fed[2] = fedA3;

        proxy = new MultisigProxy(
            address(bridge),
            enc, 2,
            fed, 2,
            commissionReceiver,
            TIMELOCK
        );

        // Transfer Bridge ownership to proxy (production flow)
        vm.prank(deployer);
        bridge.transferOwnership(address(proxy));

        domainSep = proxy.DOMAIN_SEPARATOR();

        // Fund user, lock tokens into the bridge so fundsOut has a pool
        token.mint(user, AMOUNT * 10);
        vm.prank(user);
        token.approve(address(bridge), type(uint256).max);
        vm.prank(user);
        bridge.fundsIn(AMOUNT * 5, DST_CHAIN, DST_ADDR, NONCE_OP, TX_ID);
    }

    // ========================================================================
    // helpers
    // ========================================================================

    function _encSigSet2of3() internal pure returns (uint256[] memory pks, uint256 bitmap) {
        pks = new uint256[](2);
        pks[0] = 0xE1;  // index 0
        pks[1] = 0xE2;  // index 1
        bitmap = 0x3;   // bits 0 and 1
    }

    function _fedSigSet2of3() internal pure returns (uint256[] memory pks, uint256 bitmap) {
        pks = new uint256[](2);
        pks[0] = 0xF1;  // index 0
        pks[1] = 0xF2;  // index 1
        bitmap = 0x3;
    }

    function _fundsOutCalldata() internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            FUNDS_OUT_SELECTOR,
            address(token), recipient, AMOUNT, TX_ID, SRC_CHAIN, SRC_ADDR
        );
    }

    // ========================================================================
    // Constructor
    // ========================================================================

    function test_constructor_setsState() public view {
        assertEq(proxy.bridge(), address(bridge));
        assertEq(proxy.enclaveThreshold(), 2);
        assertEq(proxy.federationThreshold(), 2);
        assertEq(proxy.commissionRecipient(), commissionReceiver);
        assertEq(proxy.timelockDuration(), TIMELOCK);
        assertEq(proxy.proposalNonce(), 0);
        assertTrue(proxy.teeAllowedSelectors(FUNDS_OUT_SELECTOR));

        address[] memory enc = proxy.getEnclaveSigners();
        assertEq(enc.length, 3);
        assertEq(enc[0], encA1);

        address[] memory fed = proxy.getFederationSigners();
        assertEq(fed.length, 3);
    }

    function test_constructor_revertsOnZeroBridge() public {
        address[] memory enc = new address[](1); enc[0] = encA1;
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.ZeroBridge.selector);
        new MultisigProxy(address(0), enc, 1, fed, 1, commissionReceiver, TIMELOCK);
    }

    function test_constructor_revertsOnNoEnclaveSigners() public {
        address[] memory enc = new address[](0);
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.NoSigners.selector);
        new MultisigProxy(address(bridge), enc, 1, fed, 1, commissionReceiver, TIMELOCK);
    }

    function test_constructor_revertsOnBadEnclaveThreshold() public {
        address[] memory enc = new address[](2); enc[0] = encA1; enc[1] = encA2;
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.InvalidThreshold.selector);
        new MultisigProxy(address(bridge), enc, 3, fed, 1, commissionReceiver, TIMELOCK);
    }

    function test_constructor_revertsOnZeroCommission() public {
        address[] memory enc = new address[](1); enc[0] = encA1;
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.ZeroCommissionRecipient.selector);
        new MultisigProxy(address(bridge), enc, 1, fed, 1, address(0), TIMELOCK);
    }

    function test_constructor_revertsOnTimelockTooLong() public {
        address[] memory enc = new address[](1); enc[0] = encA1;
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.TimelockTooLong.selector);
        new MultisigProxy(address(bridge), enc, 1, fed, 1, commissionReceiver, 30 days);
    }

    function test_constructor_revertsOnDuplicateSigner() public {
        address[] memory enc = new address[](2); enc[0] = encA1; enc[1] = encA1;
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.DuplicateSigner.selector);
        new MultisigProxy(address(bridge), enc, 1, fed, 1, commissionReceiver, TIMELOCK);
    }

    function test_constructor_revertsOnZeroAddressSigner() public {
        address[] memory enc = new address[](1); enc[0] = address(0);
        address[] memory fed = new address[](1); fed[0] = fedA1;
        vm.expectRevert(IMultisigProxy.ZeroAddressSigner.selector);
        new MultisigProxy(address(bridge), enc, 1, fed, 1, commissionReceiver, TIMELOCK);
    }

    // ========================================================================
    // TEE execute — happy path
    // ========================================================================

    function test_execute_fundsOutViaBridge() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _encSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectEmit(true, false, false, true);
        emit Executed(FUNDS_OUT_SELECTOR, nonce, bitmap);

        proxy.execute(callData, nonce, deadline, bitmap, sigs);

        assertEq(token.balanceOf(recipient), AMOUNT);
        assertEq(proxy.getNonce(FUNDS_OUT_SELECTOR), nonce + 1);
    }

    function test_execute_revertsOnExpired() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp - 1;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _encSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.Expired.selector);
        proxy.execute(callData, nonce, deadline, bitmap, sigs);
    }

    function test_execute_revertsOnWrongNonce() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = 99;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _encSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.InvalidNonce.selector);
        proxy.execute(callData, nonce, deadline, bitmap, sigs);
    }

    function test_execute_revertsOnDisallowedSelector() public {
        bytes memory callData = abi.encodeWithSignature('pause()');
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, bytes4(callData), callData, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _encSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.SelectorNotAllowed.selector);
        proxy.execute(callData, nonce, deadline, bitmap, sigs);
    }

    function test_execute_revertsOnCallDataTooShort() public {
        bytes memory callData = hex'aabb';
        vm.expectRevert(IMultisigProxy.CallDataTooShort.selector);
        proxy.execute(callData, 0, block.timestamp + 1 hours, 0x3, new bytes[](2));
    }

    function test_execute_revertsOnBelowThreshold() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        uint256[] memory pks = new uint256[](1); pks[0] = encPk1;
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.BelowThreshold.selector);
        proxy.execute(callData, nonce, deadline, 0x1, sigs);
    }

    function test_execute_revertsOnBadSignature() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        // bitmap says bit 0 + bit 1 set, but the second signature comes from wrong signer
        uint256[] memory pks = new uint256[](2);
        pks[0] = encPk1;
        pks[1] = 0xBADBAD;
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.InvalidSignature.selector);
        proxy.execute(callData, nonce, deadline, 0x3, sigs);
    }

    function test_execute_revertsOnSigCountMismatch() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        uint256[] memory pks = new uint256[](3);
        pks[0] = encPk1; pks[1] = encPk2; pks[2] = encPk3;
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        // bitmap has 2 bits set (meets threshold) but 3 sigs supplied
        vm.expectRevert(IMultisigProxy.SigCountMismatch.selector);
        proxy.execute(callData, nonce, deadline, 0x3, sigs);
    }

    function test_execute_revertsOnBitmapOutOfRange() public {
        bytes memory callData = _fundsOutCalldata();
        uint256 nonce = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestBridgeOp(domainSep, FUNDS_OUT_SELECTOR, callData, nonce, deadline);
        (uint256[] memory pks,) = _encSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        // bit 8 > signers.length(3)
        vm.expectRevert(IMultisigProxy.BitmapOutOfRange.selector);
        proxy.execute(callData, nonce, deadline, 0x100, sigs);
    }

    // ========================================================================
    // Emergency pause / unpause
    // ========================================================================

    function test_emergencyPause_works() public {
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestEmergencyPause(domainSep, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectEmit(false, false, false, true);
        emit EmergencyPaused(nonce, bitmap);

        proxy.emergencyPause(nonce, deadline, bitmap, sigs);

        assertTrue(bridge.paused());
        assertEq(proxy.proposalNonce(), nonce + 1);
    }

    function test_emergencyPause_revertsOnExpired() public {
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp - 1;

        bytes32 digest = MultisigHelper.digestEmergencyPause(domainSep, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.Expired.selector);
        proxy.emergencyPause(nonce, deadline, bitmap, sigs);
    }

    function test_emergencyPause_revertsOnWrongNonce() public {
        uint256 nonce = 99;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestEmergencyPause(domainSep, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.InvalidNonce.selector);
        proxy.emergencyPause(nonce, deadline, bitmap, sigs);
    }

    function test_emergencyUnpause_works() public {
        // pause first
        test_emergencyPause_works();

        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = MultisigHelper.digestEmergencyUnpause(domainSep, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectEmit(false, false, false, true);
        emit EmergencyUnpaused(nonce, bitmap);

        proxy.emergencyUnpause(nonce, deadline, bitmap, sigs);
        assertFalse(bridge.paused());
    }

    // ========================================================================
    // Propose + Execute — UpdateBridge (represents the full lifecycle)
    // ========================================================================

    function test_proposeUpdateBridge_andExecuteAfterTimelock() public {
        address newBridge = makeAddr('newBridge');
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeUpdateBridge(domainSep, newBridge, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 proposalId = proxy.proposeUpdateBridge(newBridge, nonce, deadline, bitmap, sigs);

        // timelock active
        vm.expectRevert(IMultisigProxy.TimelockActive.selector);
        proxy.executeProposal(proposalId, abi.encode(newBridge));

        vm.warp(block.timestamp + TIMELOCK + 1);

        vm.expectEmit(true, true, false, false);
        emit BridgeAddressUpdated(address(bridge), newBridge);

        proxy.executeProposal(proposalId, abi.encode(newBridge));
        assertEq(proxy.bridge(), newBridge);
    }

    function test_proposeUpdateBridge_revertsOnExpired() public {
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp - 1;

        bytes32 digest = MultisigHelper.digestProposeUpdateBridge(domainSep, makeAddr('nb'), nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.Expired.selector);
        proxy.proposeUpdateBridge(makeAddr('nb'), nonce, deadline, bitmap, sigs);
    }

    function test_proposeUpdateBridge_revertsOnDeadlineTooFar() public {
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 31 days;

        bytes32 digest = MultisigHelper.digestProposeUpdateBridge(domainSep, makeAddr('nb'), nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.DeadlineTooFar.selector);
        proxy.proposeUpdateBridge(makeAddr('nb'), nonce, deadline, bitmap, sigs);
    }

    // ========================================================================
    // Propose + Execute — UpdateEnclaveSigners
    // ========================================================================

    function test_proposeUpdateEnclaveSigners_execute() public {
        address newSigner = makeAddr('newEncSigner');
        address[] memory newSigners = new address[](2);
        newSigners[0] = encA1; newSigners[1] = newSigner;
        uint256 newThreshold = 2;

        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeUpdateEnclaveSigners(
            domainSep, newSigners, newThreshold, nonce, deadline
        );
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeUpdateEnclaveSigners(newSigners, newThreshold, nonce, deadline, bitmap, sigs);

        vm.warp(block.timestamp + TIMELOCK + 1);
        proxy.executeProposal(id, abi.encode(newSigners, newThreshold));

        address[] memory after_ = proxy.getEnclaveSigners();
        assertEq(after_.length, 2);
        assertEq(after_[1], newSigner);
        assertEq(proxy.enclaveThreshold(), newThreshold);
    }

    // ========================================================================
    // Propose + Execute — SetTeeAllowedSelector
    // ========================================================================

    function test_proposeSetTeeAllowedSelector_execute() public {
        bytes4 sel = bytes4(0xdeadbeef);
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeSetTeeSelector(domainSep, sel, true, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeSetTeeAllowedSelector(sel, true, nonce, deadline, bitmap, sigs);

        vm.warp(block.timestamp + TIMELOCK + 1);

        vm.expectEmit(true, false, false, true);
        emit TeeAllowedSelectorUpdated(sel, true);

        proxy.executeProposal(id, abi.encode(sel, true));
        assertTrue(proxy.teeAllowedSelectors(sel));
    }

    // ========================================================================
    // Propose + Execute — SetTimelockDuration
    // ========================================================================

    function test_proposeSetTimelockDuration_execute() public {
        uint256 newDuration = 2 hours;
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeSetTimelockDuration(domainSep, newDuration, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeSetTimelockDuration(newDuration, nonce, deadline, bitmap, sigs);

        vm.warp(block.timestamp + TIMELOCK + 1);

        vm.expectEmit(false, false, false, true);
        emit TimelockDurationUpdated(newDuration);
        proxy.executeProposal(id, abi.encode(newDuration));

        assertEq(proxy.timelockDuration(), newDuration);
    }

    // ========================================================================
    // Propose + Execute — AdminExecute (bypass TEE allowlist; call bridge directly)
    // ========================================================================

    function test_proposeAdminExecute_canCallBridge() public {
        // Use Bridge.pause() — not on TEE allowlist but callable via admin
        bytes memory callData = abi.encodeWithSignature('pause()');
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeAdminExecute(
            domainSep, bytes4(callData), callData, nonce, deadline
        );
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeAdminExecute(callData, nonce, deadline, bitmap, sigs);

        vm.warp(block.timestamp + TIMELOCK + 1);
        proxy.executeProposal(id, callData);

        assertTrue(bridge.paused());
    }

    // ========================================================================
    // Cancel
    // ========================================================================

    function test_cancelProposal_cancels() public {
        address newBridge = makeAddr('newBridge');
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeUpdateBridge(domainSep, newBridge, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeUpdateBridge(newBridge, nonce, deadline, bitmap, sigs);

        // Cancel with a fresh nonce
        uint256 cNonce = proxy.proposalNonce();
        uint256 cDeadline = block.timestamp + 1 hours;
        bytes32 cDigest = MultisigHelper.digestCancelProposal(domainSep, id, cNonce, cDeadline);
        bytes[] memory cSigs = MultisigHelper.signAll(vm, cDigest, pks);

        vm.expectEmit(true, false, false, false);
        emit ProposalCancelled(id);
        proxy.cancelProposal(id, cNonce, cDeadline, bitmap, cSigs);

        IMultisigProxy.Proposal memory p = proxy.getProposal(id);
        assertEq(uint8(p.status), uint8(IMultisigProxy.ProposalStatus.Cancelled));

        // cannot execute cancelled proposal
        vm.warp(block.timestamp + TIMELOCK + 1);
        vm.expectRevert(IMultisigProxy.NotPending.selector);
        proxy.executeProposal(id, abi.encode(newBridge));
    }

    function test_cancelProposal_revertsOnNotPending() public {
        bytes32 id = keccak256('ghost');
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = MultisigHelper.digestCancelProposal(domainSep, id, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        vm.expectRevert(IMultisigProxy.NotPending.selector);
        proxy.cancelProposal(id, nonce, deadline, bitmap, sigs);
    }

    // ========================================================================
    // executeProposal reverts
    // ========================================================================

    function test_executeProposal_revertsOnDataMismatch() public {
        address newBridge = makeAddr('newBridge');
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 1 days;

        bytes32 digest = MultisigHelper.digestProposeUpdateBridge(domainSep, newBridge, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeUpdateBridge(newBridge, nonce, deadline, bitmap, sigs);

        vm.warp(block.timestamp + TIMELOCK + 1);
        vm.expectRevert(IMultisigProxy.DataMismatch.selector);
        proxy.executeProposal(id, abi.encode(makeAddr('different')));
    }

    function test_executeProposal_revertsOnExpiredDeadline() public {
        address newBridge = makeAddr('newBridge');
        uint256 nonce = proxy.proposalNonce();
        uint256 deadline = block.timestamp + 2 hours;

        bytes32 digest = MultisigHelper.digestProposeUpdateBridge(domainSep, newBridge, nonce, deadline);
        (uint256[] memory pks, uint256 bitmap) = _fedSigSet2of3();
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, pks);

        bytes32 id = proxy.proposeUpdateBridge(newBridge, nonce, deadline, bitmap, sigs);

        // warp past deadline
        vm.warp(deadline + 1);
        vm.expectRevert(IMultisigProxy.ProposalExpired.selector);
        proxy.executeProposal(id, abi.encode(newBridge));
    }

    // ========================================================================
    // View
    // ========================================================================

    function test_verifyEnclaveSignature() public view {
        bytes32 digest = keccak256('msg');
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(encPk1, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        assertTrue(proxy.verifyEnclaveSignature(digest, sig, 0));
        assertFalse(proxy.verifyEnclaveSignature(digest, sig, 1));
    }

    function test_verifyEnclaveSignature_revertsOutOfRange() public {
        bytes32 digest = keccak256('msg');
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(encPk1, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(IMultisigProxy.IndexOutOfRange.selector);
        proxy.verifyEnclaveSignature(digest, sig, 99);
    }

    function test_domainSeparator_matchesHelper() public view {
        assertEq(proxy.DOMAIN_SEPARATOR(), MultisigHelper.domainSeparator(address(proxy), block.chainid));
    }
}
