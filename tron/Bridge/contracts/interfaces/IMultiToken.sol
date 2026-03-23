// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

interface IMultiToken {
    /// @notice Emitted when the bridge contract address is updated
    /// @param sender Address of the account that initiated the change
    /// @param bridgeAddress New address of the bridge contract
    event BridgeContractChanged(address indexed sender, address bridgeAddress);

    /// @notice Burns a specified amount of tokens from a given address
    function burn(address from, uint256 id, uint256 value) external;

    /// @notice Mints a specified amount of tokens to a given address
    function mint(
        address to,
        uint256 id,
        uint256 value,
        bytes memory data
    ) external;

    /// @notice Mints a batch of tokens to a given address
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) external;

    /// @notice Sets the base URI for all token types
    function setBaseURI(string memory baseURI) external;

    /// @notice Sets the URI for a specific token ID
    function setURI(uint256 tokenId, string memory tokenURI) external;

    /// @notice Updates the address of the bridge contract
    function setBridgeContract(address bridgeContract) external;

    /// @notice Returns the current address of the bridge contract
    function getBridgeContract() external view returns (address);

    /// @notice Checks if a given interface is supported by the contract
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
