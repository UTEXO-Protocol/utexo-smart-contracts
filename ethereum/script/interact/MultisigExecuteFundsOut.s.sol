// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Script, console2 } from 'forge-std/Script.sol';
import { MultisigProxy } from '../../src/MultisigProxy.sol';
import { MultisigHelper } from '../../test/helpers/MultisigHelper.sol';

/// @title MultisigExecuteFundsOut
/// @notice Signs a Bridge.fundsOut() call locally with enclave private keys from env
///         and submits it via MultisigProxy.execute(). For manual end-to-end testing
///         before the backend is wired up.
///
/// Env:
///   PRIVATE_KEY             — tx submitter (anyone)
///   PROXY_ADDRESS           — MultisigProxy address
///   RECIPIENT               — destination address
///   AMOUNT (wei)            — amount to release
///   TX_ID                   — transaction id
///   SOURCE_CHAIN            — source chain string
///   SOURCE_ADDRESS          — source address string
///   BLOCK_HEIGHT            — Bitcoin block height (verified by BtcRelay)
///   COMMITMENT_HASH         — Bitcoin block commitment hash (verified by BtcRelay)
///   FUNDS_IN_IDS            — comma-separated fundsIn transaction IDs to reference
///   ENCLAVE_PKS             — comma-separated hex private keys (ordered by signer index)
///   ENCLAVE_BITMAP          — bitmap of participating signers (hex or decimal)
///   DEADLINE_OFFSET         — seconds from now (e.g. 3600)
contract MultisigExecuteFundsOut is Script {
    bytes4 constant FUNDS_OUT_SELECTOR = bytes4(keccak256('fundsOut(address,uint256,uint256,string,string,uint256,bytes32,uint256[])'));

    struct Params {
        address recipient;
        uint256 amount;
        uint256 txId;
        string  srcChain;
        string  srcAddr;
        uint256 blockHeight;
        bytes32 commitmentHash;
        uint256[] fundsInIds;
    }

    function _loadParams() internal view returns (Params memory p) {
        p.recipient      = vm.envAddress('RECIPIENT');
        p.amount         = vm.envUint('AMOUNT');
        p.txId           = vm.envUint('TX_ID');
        p.srcChain       = vm.envString('SOURCE_CHAIN');
        p.srcAddr        = vm.envString('SOURCE_ADDRESS');
        p.blockHeight    = vm.envUint('BLOCK_HEIGHT');
        p.commitmentHash = vm.envBytes32('COMMITMENT_HASH');
        p.fundsInIds     = vm.envUint('FUNDS_IN_IDS', ',');
    }

    function _buildCallData(Params memory p) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            FUNDS_OUT_SELECTOR, p.recipient, p.amount, p.txId,
            p.srcChain, p.srcAddr, p.blockHeight, p.commitmentHash, p.fundsInIds
        );
    }

    function run() external {
        MultisigProxy proxy = MultisigProxy(vm.envAddress('PROXY_ADDRESS'));

        bytes memory callData = _buildCallData(_loadParams());

        uint256 nonce    = proxy.getNonce(FUNDS_OUT_SELECTOR);
        uint256 deadline = block.timestamp + vm.envUint('DEADLINE_OFFSET');
        uint256 bitmap   = vm.envUint('ENCLAVE_BITMAP');

        bytes32 digest = MultisigHelper.digestBridgeOp(
            proxy.DOMAIN_SEPARATOR(), FUNDS_OUT_SELECTOR, callData, nonce, deadline
        );
        bytes[] memory sigs = MultisigHelper.signAll(vm, digest, vm.envUint('ENCLAVE_PKS', ','));

        console2.log('Submitting execute() with nonce:', nonce);
        console2.log('Deadline:                       ', deadline);
        console2.log('Bitmap:                         ', bitmap);

        vm.startBroadcast(vm.envUint('PRIVATE_KEY'));
        proxy.execute(callData, nonce, deadline, bitmap, sigs);
        vm.stopBroadcast();

        console2.log('execute() succeeded. New nonce:', proxy.getNonce(FUNDS_OUT_SELECTOR));
    }
}
