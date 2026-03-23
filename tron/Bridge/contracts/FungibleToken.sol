// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { ERC20 } from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import { ERC20Pausable } from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol';
import { AccessControl } from '@openzeppelin/contracts/access/AccessControl.sol';

contract FungibleToken is ERC20Pausable, Ownable, AccessControl {
    bytes32 public constant BRIDGE_ROLE = keccak256('BRIDGE_ROLE');
    address private _bridgeContract;

    /// @notice Emitted when the bridge contract address is updated
    /// @param sender Address of the account that initiated the change
    /// @param bridgeAddress New address of the bridge contract
    event BridgeContractChanged(address indexed sender, address bridgeAddress);

    /// @notice Modifier to allow only addresses with the BRIDGE_ROLE to call the function
    modifier onlyBridge() {
        require(hasRole(BRIDGE_ROLE, msg.sender), 'Caller is not authorized');
        _;
    }

    /// @notice Constructor that initializes the token with a name, symbol, initial supply, and bridge contract
    /// @param name Name of the token
    /// @param symbol Symbol of the token
    /// @param bridgeContract Address of the bridge contract that will have the BRIDGE_ROLE
    /// @param initialSupply Initial supply of tokens to mint
    constructor(
        string memory name,
        string memory symbol,
        address bridgeContract,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
        _bridgeContract = bridgeContract;
        _grantRole(BRIDGE_ROLE, _bridgeContract);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Stop all contract functionality allowed to the user
    /// @dev Can only be called by the contract owner
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume all contract functionality allowed to the user
    /// @dev Can only be called by the contract owner
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Mints new tokens to a specified address
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param to Address to which tokens will be minted
    /// @param amount Amount of tokens to mint
    function mint(
        address to,
        uint256 amount
    ) external onlyBridge whenNotPaused {
        super._mint(to, amount);
    }

    /// @notice Burns a specified amount of tokens from a given address
    /// @dev Can only be called by the bridge contract and when the contract is not paused
    /// @param account Address from which tokens will be burned
    /// @param amount Amount of tokens to burn
    function burn(
        address account,
        uint256 amount
    ) external onlyBridge whenNotPaused {
        super._burn(account, amount);
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

    /// @notice Returns the number of decimals
    /// @dev This function overrides the default ERC20 `decimals` function to set the number of decimals to 18
    /// @return Number of decimals (18)
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
