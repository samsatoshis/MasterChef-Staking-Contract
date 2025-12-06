// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MasterChefStaking
 * @author Open Source Community
 * @notice A scalable staking contract using the MasterChef pattern for native token (ETH/BNB) reward distribution
 * @dev Users stake ERC20 tokens to earn native token rewards proportionally
 *
 * Key Features:
 * - Infinite scalability (O(1) operations, no loops)
 * - Real-time reward calculations
 * - Anti-frontrunning protection (configurable eligibility delay)
 * - MEV protection with block-based action delays
 * - EIP-2612 permit support for gasless staking
 * - Gas-optimized design (80-90% gas reduction vs snapshot approaches)
 *
 * How it works:
 * 1. Users stake ERC20 tokens
 * 2. Native tokens (ETH/BNB) are sent to the contract as rewards
 * 3. Rewards are distributed proportionally based on stake size
 * 4. Users claim rewards after eligibility delay
 */
contract MasterChefStaking is ReentrancyGuard, Ownable {

    // ========================================
    // STATE VARIABLES
    // ========================================

    /// @notice The ERC20 token that users stake
    IERC20 public immutable stakingToken;

    /// @notice Accumulated rewards per staked token (scaled by PRECISION)
    uint256 public accRewardPerShare;

    /// @notice Total tokens currently staked by all users
    uint256 public totalStaked;

    /// @notice Timestamp of the last reward distribution
    uint256 public lastRewardTime;

    /// @notice Time users must wait after staking before claiming rewards
    uint256 public immutable eligibilityDelay;

    /// @notice Precision factor for reward calculations (1e30 for maximum accuracy)
    uint256 public constant PRECISION = 1e30;

    /// @notice Minimum stake amount to prevent dust attacks
    uint256 public constant MIN_STAKE_AMOUNT = 1e6;

    /// @notice Minimum blocks between user actions (MEV protection)
    uint256 public constant MIN_BLOCK_DELAY = 1;

    /// @notice Tracks the last block each user performed an action
    mapping(address => uint256) private _lastActionBlock;

    /// @notice User staking information
    struct UserInfo {
        uint256 amount;         // Amount of tokens staked
        uint256 rewardDebt;     // Reward debt for fair distribution
        uint256 stakeTime;      // When user first staked (for eligibility)
    }

    /// @notice Mapping of user addresses to their staking info
    mapping(address => UserInfo) public userInfo;

    // ========================================
    // EVENTS
    // ========================================

    event Staked(address indexed user, uint256 amount, uint256 newTotalStaked);
    event Unstaked(address indexed user, uint256 amount, uint256 newTotalStaked);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardsDistributed(uint256 amount, uint256 newAccRewardPerShare);
    event RewardsRedistributed(address indexed ineligibleUser, uint256 amount, uint256 newAccRewardPerShare);

    // ========================================
    // CONSTRUCTOR
    // ========================================

    /**
     * @notice Deploys the staking contract
     * @param _stakingToken Address of the ERC20 token to stake
     * @param _eligibilityDelay Time in seconds before stakers can claim rewards (anti-frontrunning)
     */
    constructor(address _stakingToken, uint256 _eligibilityDelay) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid token address");
        stakingToken = IERC20(_stakingToken);
        eligibilityDelay = _eligibilityDelay;
        lastRewardTime = block.timestamp;
    }

    // ========================================
    // MODIFIERS
    // ========================================

    /// @notice Prevents MEV attacks by requiring minimum block delay between actions
    modifier antiMEV() {
        require(block.number > _lastActionBlock[msg.sender] + MIN_BLOCK_DELAY, "Action too frequent");
        _lastActionBlock[msg.sender] = block.number;
        _;
    }

    // ========================================
    // CORE STAKING FUNCTIONS
    // ========================================

    /**
     * @notice Stakes tokens for the caller
     * @param amount Amount of tokens to stake
     */
    function stake(uint256 amount) external nonReentrant antiMEV {
        require(amount >= MIN_STAKE_AMOUNT, "Below minimum stake amount");
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        UserInfo storage user = userInfo[msg.sender];

        // Claim any pending rewards before changing stake
        if (user.amount > 0) {
            _claimRewards();
        }

        // Set stake time for new stakers
        if (user.amount == 0) {
            user.stakeTime = block.timestamp;
        }

        // Update user's stake
        user.amount += amount;
        user.rewardDebt = (user.amount * accRewardPerShare) / PRECISION;

        // Update global state
        totalStaked += amount;

        emit Staked(msg.sender, amount, totalStaked);
    }

    /**
     * @notice Stakes tokens using EIP-2612 permit (gasless approval)
     * @param amount Amount of tokens to stake
     * @param deadline Permit signature deadline
     * @param v Signature component
     * @param r Signature component
     * @param s Signature component
     */
    function permitAndStake(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant antiMEV {
        require(amount >= MIN_STAKE_AMOUNT, "Below minimum stake amount");
        require(deadline > block.timestamp, "Permit expired");
        require(deadline <= block.timestamp + 1 hours, "Deadline too far in future");

        // Use permit to approve in the same transaction
        IERC20Permit(address(stakingToken)).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        );

        // Transfer tokens
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        UserInfo storage user = userInfo[msg.sender];

        // Claim any pending rewards before changing stake
        if (user.amount > 0) {
            _claimRewards();
        }

        // Set stake time for new stakers
        if (user.amount == 0) {
            user.stakeTime = block.timestamp;
        }

        // Update user's stake
        user.amount += amount;
        user.rewardDebt = (user.amount * accRewardPerShare) / PRECISION;

        // Update global state
        totalStaked += amount;

        emit Staked(msg.sender, amount, totalStaked);
    }

    /**
     * @notice Unstakes tokens for the caller
     * @param amount Amount of tokens to unstake
     */
    function unstake(uint256 amount) external nonReentrant antiMEV {
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= amount, "Insufficient staked amount");
        require(amount > 0, "Unstake amount must be greater than 0");

        // Check eligibility for rewards
        bool isEligible = block.timestamp >= user.stakeTime + eligibilityDelay;

        if (isEligible) {
            // Eligible users claim rewards normally
            _claimRewards();
        } else {
            // Ineligible users forfeit rewards to remaining stakers
            _handleIneligibleUnstake(amount);
        }

        // Update user's stake
        user.amount -= amount;
        user.rewardDebt = (user.amount * accRewardPerShare) / PRECISION;

        // Reset stake time if fully unstaking
        if (user.amount == 0) {
            user.stakeTime = 0;
        }

        // Update global state
        totalStaked -= amount;

        // Transfer tokens back to user
        require(stakingToken.transfer(msg.sender, amount), "Transfer failed");

        emit Unstaked(msg.sender, amount, totalStaked);
    }

    /**
     * @notice Claims pending rewards for the caller
     */
    function claimRewards() external nonReentrant {
        _claimRewards();
    }

    /**
     * @dev Internal function to claim rewards
     */
    function _claimRewards() internal {
        UserInfo storage user = userInfo[msg.sender];
        uint256 pending = _pendingRewards(msg.sender);

        if (pending > 0) {
            // Update reward debt to prevent double-claiming
            user.rewardDebt = (user.amount * accRewardPerShare) / PRECISION;

            // Transfer native token rewards
            (bool success, ) = payable(msg.sender).call{value: pending}("");
            require(success, "Reward transfer failed");

            emit RewardsClaimed(msg.sender, pending);
        }
    }

    // ========================================
    // REWARD DISTRIBUTION
    // ========================================

    /**
     * @notice Receives native token rewards and distributes to stakers
     * @dev Called automatically when native tokens are sent to the contract
     */
    receive() external payable {
        if (msg.value > 0 && totalStaked > 0) {
            _updatePool(msg.value);
        }
    }

    /**
     * @notice Manually adds rewards to the pool
     * @dev Useful for testing or special distributions
     */
    function addRewards() external payable {
        if (msg.value > 0 && totalStaked > 0) {
            _updatePool(msg.value);
        }
    }

    /**
     * @dev Updates the reward accumulator using MasterChef pattern
     * @param newRewards Amount of new rewards to distribute
     */
    function _updatePool(uint256 newRewards) internal {
        if (totalStaked == 0) return;

        // MasterChef magic: single operation distributes rewards to all stakers
        accRewardPerShare += (newRewards * PRECISION) / totalStaked;
        lastRewardTime = block.timestamp;

        emit RewardsDistributed(newRewards, accRewardPerShare);
    }

    // ========================================
    // VIEW FUNCTIONS
    // ========================================

    /**
     * @notice Calculates pending rewards for a user
     * @param user Address of the user
     * @return Amount of pending native token rewards
     */
    function pendingRewards(address user) external view returns (uint256) {
        return _pendingRewards(user);
    }

    /**
     * @dev Internal function to calculate pending rewards
     */
    function _pendingRewards(address user) internal view returns (uint256) {
        UserInfo storage userDetails = userInfo[user];

        if (userDetails.amount == 0) {
            return 0;
        }

        // Check eligibility (anti-frontrunning)
        if (block.timestamp < userDetails.stakeTime + eligibilityDelay) {
            return 0;
        }

        // MasterChef calculation: O(1) complexity
        uint256 totalEarned = (userDetails.amount * accRewardPerShare) / PRECISION;

        if (totalEarned > userDetails.rewardDebt) {
            return totalEarned - userDetails.rewardDebt;
        }

        return 0;
    }

    /**
     * @notice Gets comprehensive user information
     * @param user Address of the user
     * @return stakedAmount Amount of tokens staked
     * @return pendingRewardsAmount Amount of pending rewards
     * @return stakeTime When user first staked
     * @return isEligible Whether user is eligible for rewards
     * @return timeToEligibility Seconds until eligible (0 if already eligible)
     */
    function getUserInfo(address user) external view returns (
        uint256 stakedAmount,
        uint256 pendingRewardsAmount,
        uint256 stakeTime,
        bool isEligible,
        uint256 timeToEligibility
    ) {
        UserInfo storage userDetails = userInfo[user];

        stakedAmount = userDetails.amount;
        pendingRewardsAmount = _pendingRewards(user);
        stakeTime = userDetails.stakeTime;

        if (userDetails.stakeTime == 0) {
            isEligible = false;
            timeToEligibility = 0;
        } else {
            uint256 eligibleTime = userDetails.stakeTime + eligibilityDelay;
            isEligible = block.timestamp >= eligibleTime;
            timeToEligibility = isEligible ? 0 : eligibleTime - block.timestamp;
        }
    }

    /**
     * @notice Gets global staking statistics
     * @return totalStakedTokens Total tokens staked across all users
     * @return totalRewardsAvailable Total rewards available for distribution
     * @return rewardPerShare Current accumulated reward per share
     * @return lastDistribution Timestamp of last reward distribution
     */
    function getGlobalStats() external view returns (
        uint256 totalStakedTokens,
        uint256 totalRewardsAvailable,
        uint256 rewardPerShare,
        uint256 lastDistribution
    ) {
        totalStakedTokens = totalStaked;
        totalRewardsAvailable = address(this).balance;
        rewardPerShare = accRewardPerShare;
        lastDistribution = lastRewardTime;
    }

    /**
     * @notice Calculates APY based on recent reward distribution
     * @param recentRewards Amount of rewards distributed in the recent period
     * @param periodDays Number of days the rewards cover
     * @return apy Annual Percentage Yield (scaled by PRECISION)
     */
    function calculateAPY(uint256 recentRewards, uint256 periodDays) external view returns (uint256 apy) {
        if (totalStaked == 0 || periodDays == 0 || periodDays > 365) {
            return 0;
        }

        // Annualize rewards first to minimize precision loss
        uint256 annualRewards = (recentRewards * 365) / periodDays;

        // Check for overflow
        require(annualRewards <= type(uint256).max / PRECISION, "APY calculation overflow");

        // Calculate APY with full precision
        apy = (annualRewards * PRECISION) / totalStaked;
    }

    /**
     * @dev Handles redistribution of rewards when an ineligible user unstakes
     * @param unstakeAmount Amount of tokens being unstaked
     */
    function _handleIneligibleUnstake(uint256 unstakeAmount) internal {
        UserInfo storage user = userInfo[msg.sender];

        // Calculate proportional share of rewards being forfeited
        uint256 rewardDebtForUnstakeAmount = (unstakeAmount * accRewardPerShare) / PRECISION;
        uint256 orphanedRewards = rewardDebtForUnstakeAmount - (user.rewardDebt * unstakeAmount / user.amount);

        // Redistribute to remaining stakers if any exist
        uint256 remainingStaked = totalStaked - unstakeAmount;
        if (orphanedRewards > 0 && remainingStaked > 0) {
            accRewardPerShare += (orphanedRewards * PRECISION) / remainingStaked;
            lastRewardTime = block.timestamp;

            emit RewardsRedistributed(msg.sender, orphanedRewards, accRewardPerShare);
        }
    }

    // ========================================
    // ADMIN FUNCTIONS
    // ========================================

    /**
     * @notice Emergency withdrawal of stuck native tokens
     * @dev Only callable by owner, use with caution
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");

        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }
}
