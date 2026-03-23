// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { OwnableUpgradeable } from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import { PausableUpgradeable } from '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import { ERC1155Upgradeable } from '@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol';
import { ERC1155URIStorageUpgradeable } from '@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155URIStorageUpgradeable.sol';
import { AccessControlUpgradeable } from '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import { IMultiToken } from './interfaces/IMultiToken.sol';

contract MultiToken is
    IMultiToken,
    ERC1155URIStorageUpgradeable,
    PausableUpgradeable,
    OwnableUpgradeable,
    AccessControlUpgradeable
{
    bytes32 public constant BRIDGE_ROLE = keccak256('BRIDGE_ROLE');
    address private _bridgeContract;

    /// @notice Modifier to allow only addresses with the BRIDGE_ROLE to call the function
    modifier onlyBridge() {
        require(hasRole(BRIDGE_ROLE, msg.sender), 'Caller is not authorized');
        _;
    }

    /// @notice Initializes the contract with the provided bridge contract address and sets up roles
    /// @param bridgeContract Address of the bridge contract that will have the BRIDGE_ROLE
    function initialize(address bridgeContract) public initializer {
        __ERC1155URIStorage_init();
        __Ownable_init();
        __Pausable_init();
        __AccessControl_init();
        _bridgeContract = bridgeContract;
        _grantRole(BRIDGE_ROLE, _bridgeContract);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Burns a specified amount of tokens from a given address
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param from Address from which tokens will be burned
    /// @param id ID of the token to burn
    /// @param value Amount of tokens to burn
    function burn(
        address from,
        uint256 id,
        uint256 value
    ) external onlyBridge whenNotPaused {
        _burn(from, id, value);
    }

    /// @notice Mints a specified amount of tokens to a given address
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param to Address to which tokens will be minted
    /// @param id ID of the token to mint
    /// @param value Amount of tokens to mint
    /// @param data Additional data to pass to the minting function
    function mint(
        address to,
        uint256 id,
        uint256 value,
        bytes memory data
    ) external onlyBridge whenNotPaused {
        _mint(to, id, value, data);
    }

    /// @notice Mints a batch of tokens to a given address
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param to Address to which tokens will be minted
    /// @param ids Array of token IDs to mint
    /// @param values Array of amounts of each token to mint
    /// @param data Additional data to pass to the minting function
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) external onlyBridge whenNotPaused {
        _mintBatch(to, ids, values, data);
    }

    /// @notice Sets the base URI for all token types
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param baseURI New base URI to set
    function setBaseURI(
        string memory baseURI
    ) external onlyBridge whenNotPaused {
        _setBaseURI(baseURI);
    }

    /// @notice Sets the URI for a specific token ID
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param tokenId ID of the token to set the URI for
    /// @param tokenURI New URI to set for the token
    function setURI(
        uint256 tokenId,
        string memory tokenURI
    ) external onlyBridge whenNotPaused {
        _setURI(tokenId, tokenURI);
    }

    /// @notice Updates the address of the bridge contract
    /// @dev Can only be called by the owner of the contract and when the contract is not paused
    /// @param bridgeContract New address of the bridge contract
    function setBridgeContract(
        address bridgeContract
    ) external onlyOwner whenNotPaused {
        _bridgeContract = bridgeContract;
        emit BridgeContractChanged(msg.sender, bridgeContract);
    }

    /// @notice Returns the current address of the bridge contract
    /// @return Address of the bridge contract
    function getBridgeContract() public view returns (address) {
        return _bridgeContract;
    }

    /// @notice Checks if a given interface is supported by the contract
    /// @param interfaceId ID of the interface to check
    /// @return Boolean indicating if the interface is supported
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(ERC1155Upgradeable, AccessControlUpgradeable, IMultiToken)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Hook that is called before any token transfer
    /// @dev Ensures that the contract is not paused before allowing a transfer
    /// @param operator Address performing the transfer
    /// @param from Address sending the tokens
    /// @param to Address receiving the tokens
    /// @param ids Array of token IDs being transferred
    /// @param amounts Array of amounts of tokens being transferred
    /// @param data Additional data passed with the transfer
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        require(!paused(), 'ERC1155Pausable: token transfer while paused');
    }
}
