// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import '@openzeppelin/contracts/proxy/Proxy.sol';

/// @title Contract used to deploy contracts via proxy
contract TransparentProxy is Proxy {
    // 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
    bytes32 private constant IMPLEMENTATION_SLOT =
        bytes32(uint(keccak256('eip1967.proxy.implementation')) - 1);
    // 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
    bytes32 private constant ADMIN_SLOT =
        bytes32(uint(keccak256('eip1967.proxy.admin')) - 1);

    error NotAdmin();
    error InvalidImplementation();

    constructor(address _impl) {
        _setImplementation(_impl);
        _setAdmin(msg.sender);
    }

    receive() external payable {
        _fallback();
    }

    /// @dev Indicates that the function can be called only by user who has Admin role.
    modifier onlyAdmin() {
        if (msg.sender != _getAdmin()) {
            revert NotAdmin();
        }
        _;
    }
    /**
     * @dev Changes the admin address. Only the current admin can call this function.
     * @param _admin The new admin address.
     */
    function changeAdmin(address _admin) external onlyAdmin {
        _setAdmin(_admin);
    }

    /**
     * @dev Upgrades the implementation to a new address. Only the current admin can call this function.
     * @param newImplementation The address of the new implementation.
     */
    function upgradeTo(address newImplementation) external onlyAdmin {
        _setImplementation(newImplementation);
    }

    /**
     * @dev Returns the current admin address.
     * @return The current admin address.
     */
    function admin() external view onlyAdmin returns (address) {
        return _getAdmin();
    }

    /**
     * @dev Returns the current implementation address.
     * @return The current implementation address.
     */
    function implementation() external view onlyAdmin returns (address) {
        return _implementation();
    }

    /**
     * @dev Returns the current implementation address.
     * @return The current implementation address.
     */
    function _implementation()
        internal
        view
        virtual
        override
        returns (address)
    {
        return StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value;
    }

    /**
     * @dev Returns the current admin address.
     * @return The current admin address.
     */
    function _getAdmin() private view returns (address) {
        return StorageSlot.getAddressSlot(ADMIN_SLOT).value;
    }

    /**
     * @dev Sets the admin address.
     * @param _admin The new admin address.
     */
    function _setAdmin(address _admin) private {
        require(_admin != address(0), 'admin = zero address');
        StorageSlot.getAddressSlot(ADMIN_SLOT).value = _admin;
    }

    /**
     * @dev Sets the implementation address.
     * @param newImplementation The address of the new implementation.
     */
    function _setImplementation(address newImplementation) private {
        if (newImplementation.code.length == 0) {
            revert InvalidImplementation();
        }
        StorageSlot
            .getAddressSlot(IMPLEMENTATION_SLOT)
            .value = newImplementation;
    }
}

library StorageSlot {
    struct AddressSlot {
        address value;
    }

    function getAddressSlot(
        bytes32 slot
    ) internal pure returns (AddressSlot storage r) {
        assembly {
            r.slot := slot
        }
    }
}
