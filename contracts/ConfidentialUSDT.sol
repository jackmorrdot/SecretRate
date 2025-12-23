// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ConfidentialUSDT
/// @notice Confidential stablecoin used for paying staking yield. Minting is restricted to the staking contract.
contract ConfidentialUSDT is ERC7984, ZamaEthereumConfig, Ownable {
    address public minter;

    event MinterUpdated(address indexed newMinter);

    error UnauthorizedMinter(address caller);

    constructor() ERC7984("cUSDT", "cUSDT", "") Ownable(msg.sender) {}

    /// @notice Sets the staking contract that is allowed to mint tokens.
    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    /// @notice Mints an encrypted amount using a cleartext input.
    function mintFromPlain(address to, uint64 amount) external returns (euint64) {
        if (msg.sender != minter) {
            revert UnauthorizedMinter(msg.sender);
        }

        euint64 encryptedAmount = FHE.asEuint64(amount);
        return _mint(to, encryptedAmount);
    }

    /// @notice Mints an already encrypted amount.
    function mintEncrypted(address to, euint64 amount) external returns (euint64) {
        if (msg.sender != minter) {
            revert UnauthorizedMinter(msg.sender);
        }

        return _mint(to, amount);
    }
}
