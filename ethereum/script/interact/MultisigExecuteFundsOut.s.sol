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
///   TOKEN_ADDRESS           — ERC-20 to release
///   RECIPIENT               — destination address
///   AMOUNT (wei)            — amount to release
///   TX_ID                   — transaction id
///   SOURCE_CHAIN            — source chain string
///   SOURCE_ADDRESS          — source address string
///   ENCLAVE_PKS             — comma-separated hex private keys (ordered by signer index)
///   ENCLAVE_BITMAP          — bitmap of participating signers (hex or decimal)
///   DEADLINE_OFFSET         — seconds from now (e.g. 3600)
contract MultisigExecuteFundsOut is Script {
    bytes4 constant FUNDS_OUT_SELECTOR = bytes4(keccak256('fundsOut(address,address,uint256,uint256,string,string)'));

    struct Params {
        address token;
        address recipient;
        uint256 amount;
        uint256 txId;
        string  srcChain;
        string  srcAddr;
    }

    function _loadParams() internal view returns (Params memory p) {
        p.token     = vm.envAddress('TOKEN_ADDRESS');
        p.recipient = vm.envAddress('RECIPIENT');
        p.amount    = vm.envUint('AMOUNT');
        p.txId      = vm.envUint('TX_ID');
        p.srcChain  = vm.envString('SOURCE_CHAIN');
        p.srcAddr   = vm.envString('SOURCE_ADDRESS');
    }

    function _buildCallData(Params memory p) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            FUNDS_OUT_SELECTOR, p.token, p.recipient, p.amount, p.txId, p.srcChain, p.srcAddr
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
