// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import './TransparentProxy.sol';

contract BridgeContractProxyAdmin {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, 'not owner');
        _;
    }

    function getProxyAdmin(address proxy) external view returns (address) {
        (bool ok, bytes memory res) = proxy.staticcall(
            abi.encodeCall(TransparentProxy.admin, ())
        );
        require(ok, 'call failed');
        return abi.decode(res, (address));
    }

    function getProxyImplementation(
        address proxy
    ) external view returns (address) {
        (bool ok, bytes memory res) = proxy.staticcall(
            abi.encodeCall(TransparentProxy.implementation, ())
        );
        require(ok, 'call failed');
        return abi.decode(res, (address));
    }

    function changeProxyAdmin(
        address payable proxy,
        address admin
    ) external onlyOwner {
        TransparentProxy(proxy).changeAdmin(admin);
    }

    function upgrade(
        address payable proxy,
        address implementation
    ) external onlyOwner {
        TransparentProxy(proxy).upgradeTo(implementation);
    }
}
