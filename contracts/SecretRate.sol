// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ConfidentialUSDT} from "./ConfidentialUSDT.sol";

/// @title SecretRate
/// @notice ETH staking vault that records deposits privately and pays yield in confidential cUSDT.
contract SecretRate is ZamaEthereumConfig, ReentrancyGuard {
    struct StakePosition {
        euint64 encryptedAmount;
        uint256 plainAmount;
        uint256 lastAccrual;
        uint256 accruedRewards;
    }

    ConfidentialUSDT public immutable cusdt;

    uint256 public constant REWARD_PER_ETH_PER_DAY = 1_000_000; // 1 cUSDT (6 decimals) per ETH per day
    uint256 private constant SECONDS_PER_DAY = 86_400;

    mapping(address user => StakePosition) private _stakes;
    mapping(bytes32 encryptedHandle => address owner) private _withdrawalOwner;

    event Staked(address indexed user, uint256 amount, euint64 encryptedTotal);
    event InterestClaimed(address indexed user, uint256 reward, euint64 encryptedMinted);
    event WithdrawalRequested(address indexed user, uint256 plainAmount, bytes32 encryptedHandle);
    event WithdrawalFinalized(address indexed user, uint256 plainAmount);

    error NoStake();
    error InvalidProof();
    error RewardTooLarge();
    error WithdrawInProgress();

    constructor(address cusdtAddress) {
        require(cusdtAddress != address(0), "cUSDT required");
        cusdt = ConfidentialUSDT(cusdtAddress);
    }

    /// @notice Stakes ETH and stores the encrypted position.
    function stake() external payable nonReentrant {
        if (msg.value == 0) {
            revert NoStake();
        }
        if (msg.value > type(uint64).max) {
            revert RewardTooLarge();
        }

        _updateRewards(msg.sender);

        StakePosition storage position = _stakes[msg.sender];
        bytes32 currentHandle = FHE.toBytes32(position.encryptedAmount);
        if (_withdrawalOwner[currentHandle] != address(0)) {
            revert WithdrawInProgress();
        }

        euint64 current = position.encryptedAmount;
        if (!FHE.isInitialized(current)) {
            current = FHE.asEuint64(0);
        }

        euint64 deposit = FHE.asEuint64(uint64(msg.value));
        euint64 updated = FHE.add(current, deposit);

        FHE.allowThis(updated);
        FHE.allow(updated, msg.sender);

        position.encryptedAmount = updated;
        position.plainAmount += msg.value;
        if (position.lastAccrual == 0) {
            position.lastAccrual = block.timestamp;
        }

        emit Staked(msg.sender, msg.value, updated);
    }

    /// @notice Claims accumulated cUSDT interest.
    function claimInterest() external nonReentrant {
        _updateRewards(msg.sender);

        StakePosition storage position = _stakes[msg.sender];
        uint256 reward = position.accruedRewards;
        if (reward == 0) {
            return;
        }
        if (reward > type(uint64).max) {
            revert RewardTooLarge();
        }

        position.accruedRewards = 0;
        euint64 minted = cusdt.mintFromPlain(msg.sender, uint64(reward));
        emit InterestClaimed(msg.sender, reward, minted);
    }

    /// @notice Starts a withdraw by making the encrypted stake publicly decryptable.
    function requestWithdraw() external nonReentrant {
        StakePosition storage position = _stakes[msg.sender];
        if (position.plainAmount == 0) {
            revert NoStake();
        }

        _updateRewards(msg.sender);

        bytes32 handle = FHE.toBytes32(position.encryptedAmount);
        if (_withdrawalOwner[handle] != address(0)) {
            revert WithdrawInProgress();
        }

        _withdrawalOwner[handle] = msg.sender;
        FHE.makePubliclyDecryptable(position.encryptedAmount);

        emit WithdrawalRequested(msg.sender, position.plainAmount, handle);
    }

    /// @notice Finalizes a withdraw with a decryption proof produced by the relayer.
    /// @param encryptedAmount The encrypted stake handle that was disclosed.
    /// @param clearAmount The decrypted stake amount.
    /// @param decryptionProof Proof returned by the relayer for the disclosed handle.
    function finalizeWithdraw(
        euint64 encryptedAmount,
        uint64 clearAmount,
        bytes calldata decryptionProof
    ) external nonReentrant {
        bytes32 handle = FHE.toBytes32(encryptedAmount);
        address owner = _withdrawalOwner[handle];
        if (owner == address(0)) {
            revert InvalidProof();
        }

        StakePosition storage position = _stakes[owner];
        if (FHE.toBytes32(position.encryptedAmount) != handle || position.plainAmount != clearAmount) {
            revert InvalidProof();
        }

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = handle;
        bytes memory cleartextBytes = abi.encode(clearAmount);

        FHE.checkSignatures(handles, cleartextBytes, decryptionProof);

        position.encryptedAmount = FHE.asEuint64(0);
        position.plainAmount = 0;
        position.lastAccrual = block.timestamp;
        _withdrawalOwner[handle] = address(0);

        (bool sent, ) = payable(owner).call{value: clearAmount}("");
        require(sent, "ETH transfer failed");

        emit WithdrawalFinalized(owner, clearAmount);
    }

    /// @notice Returns the encrypted stake for a user.
    function getEncryptedStake(address user) external view returns (euint64) {
        return _stakes[user].encryptedAmount;
    }

    /// @notice Returns the plain stake and stored rewards for a user.
    function stakeDetails(address user) external view returns (uint256 plainAmount, uint256 accruedRewards, uint256 lastAccrual) {
        StakePosition storage position = _stakes[user];
        return (position.plainAmount, position.accruedRewards, position.lastAccrual);
    }

    /// @notice Returns pending rewards including in-flight accruals.
    function pendingRewards(address user) external view returns (uint256) {
        StakePosition storage position = _stakes[user];
        if (position.plainAmount == 0 || position.lastAccrual == 0) {
            return position.accruedRewards;
        }

        uint256 elapsed = block.timestamp - position.lastAccrual;
        if (elapsed == 0) {
            return position.accruedRewards;
        }

        uint256 liveReward = (position.plainAmount * REWARD_PER_ETH_PER_DAY * elapsed) /
            (1 ether * SECONDS_PER_DAY);
        return position.accruedRewards + liveReward;
    }

    /// @notice Returns the encrypted handle currently tied to a withdraw request.
    function withdrawalHandle(address user) external view returns (bytes32) {
        bytes32 handle = FHE.toBytes32(_stakes[user].encryptedAmount);
        if (_withdrawalOwner[handle] == user) {
            return handle;
        }
        return bytes32(0);
    }

    function _updateRewards(address user) private {
        StakePosition storage position = _stakes[user];

        if (position.lastAccrual == 0) {
            position.lastAccrual = block.timestamp;
            return;
        }

        if (position.plainAmount == 0) {
            position.lastAccrual = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - position.lastAccrual;
        if (elapsed == 0) {
            return;
        }

        uint256 reward = (position.plainAmount * REWARD_PER_ETH_PER_DAY * elapsed) / (1 ether * SECONDS_PER_DAY);
        position.accruedRewards += reward;
        position.lastAccrual = block.timestamp;
    }
}
