const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MasterChefStaking", function () {
  let stakingToken;
  let stakingContract;
  let owner;
  let alice;
  let bob;
  let carol;

  const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18); // 1M tokens
  const ELIGIBILITY_DELAY = 3 * 24 * 60 * 60; // 3 days in seconds

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();

    // Deploy mock staking token
    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Staking Token", "STK", INITIAL_SUPPLY);

    // Deploy staking contract with 3-day eligibility delay
    const MasterChefStaking = await ethers.getContractFactory("MasterChefStaking");
    stakingContract = await MasterChefStaking.deploy(
      await stakingToken.getAddress(),
      ELIGIBILITY_DELAY
    );

    // Transfer tokens to users
    await stakingToken.transfer(alice.address, ethers.parseUnits("10000", 18));
    await stakingToken.transfer(bob.address, ethers.parseUnits("10000", 18));
    await stakingToken.transfer(carol.address, ethers.parseUnits("5000", 18));

    // Approve staking contract
    await stakingToken.connect(alice).approve(await stakingContract.getAddress(), ethers.parseUnits("10000", 18));
    await stakingToken.connect(bob).approve(await stakingContract.getAddress(), ethers.parseUnits("10000", 18));
    await stakingToken.connect(carol).approve(await stakingContract.getAddress(), ethers.parseUnits("5000", 18));
  });

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      expect(await stakingContract.stakingToken()).to.equal(await stakingToken.getAddress());
    });

    it("Should set the correct owner", async function () {
      expect(await stakingContract.owner()).to.equal(owner.address);
    });

    it("Should set the correct eligibility delay", async function () {
      expect(await stakingContract.eligibilityDelay()).to.equal(ELIGIBILITY_DELAY);
    });

    it("Should initialize with zero state", async function () {
      expect(await stakingContract.totalStaked()).to.equal(0);
      expect(await stakingContract.accRewardPerShare()).to.equal(0);
    });

    it("Should reject zero token address", async function () {
      const MasterChefStaking = await ethers.getContractFactory("MasterChefStaking");
      await expect(
        MasterChefStaking.deploy(ethers.ZeroAddress, ELIGIBILITY_DELAY)
      ).to.be.revertedWith("Invalid token address");
    });
  });

  describe("Staking", function () {
    it("Should allow users to stake tokens", async function () {
      const stakeAmount = ethers.parseUnits("1000", 18);

      await stakingContract.connect(alice).stake(stakeAmount);

      const userInfo = await stakingContract.userInfo(alice.address);
      expect(userInfo.amount).to.equal(stakeAmount);
      expect(await stakingContract.totalStaked()).to.equal(stakeAmount);
    });

    it("Should reject below minimum stake amount", async function () {
      await expect(
        stakingContract.connect(alice).stake(0)
      ).to.be.revertedWith("Below minimum stake amount");
    });

    it("Should set stake time for new users", async function () {
      const stakeAmount = ethers.parseUnits("1000", 18);
      const beforeTime = await time.latest();

      await stakingContract.connect(alice).stake(stakeAmount);

      const userInfo = await stakingContract.userInfo(alice.address);
      expect(userInfo.stakeTime).to.be.at.least(beforeTime);
    });

    it("Should handle multiple stakes from same user", async function () {
      const firstStake = ethers.parseUnits("1000", 18);
      const secondStake = ethers.parseUnits("500", 18);

      await stakingContract.connect(alice).stake(firstStake);

      // Mine a block to bypass antiMEV modifier
      await network.provider.send("evm_mine");

      await stakingContract.connect(alice).stake(secondStake);

      const userInfo = await stakingContract.userInfo(alice.address);
      expect(userInfo.amount).to.equal(firstStake + secondStake);
    });

    it("Should emit Staked event", async function () {
      const stakeAmount = ethers.parseUnits("1000", 18);

      await expect(stakingContract.connect(alice).stake(stakeAmount))
        .to.emit(stakingContract, "Staked")
        .withArgs(alice.address, stakeAmount, stakeAmount);
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      // Alice stakes 1000 tokens
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
    });

    it("Should allow users to unstake tokens", async function () {
      const unstakeAmount = ethers.parseUnits("500", 18);

      // Mine a block to bypass antiMEV modifier
      await network.provider.send("evm_mine");

      await stakingContract.connect(alice).unstake(unstakeAmount);

      const userInfo = await stakingContract.userInfo(alice.address);
      expect(userInfo.amount).to.equal(ethers.parseUnits("500", 18));
      expect(await stakingContract.totalStaked()).to.equal(ethers.parseUnits("500", 18));
    });

    it("Should reject unstaking more than staked", async function () {
      // Mine a block to bypass antiMEV modifier
      await network.provider.send("evm_mine");

      await expect(
        stakingContract.connect(alice).unstake(ethers.parseUnits("2000", 18))
      ).to.be.revertedWith("Insufficient staked amount");
    });

    it("Should reject zero unstake amount", async function () {
      // Mine a block to bypass antiMEV modifier
      await network.provider.send("evm_mine");

      await expect(
        stakingContract.connect(alice).unstake(0)
      ).to.be.revertedWith("Unstake amount must be greater than 0");
    });

    it("Should reset stake time when fully unstaking", async function () {
      // Mine a block to bypass antiMEV modifier
      await network.provider.send("evm_mine");

      await stakingContract.connect(alice).unstake(ethers.parseUnits("1000", 18));

      const userInfo = await stakingContract.userInfo(alice.address);
      expect(userInfo.stakeTime).to.equal(0);
    });

    it("Should emit Unstaked event", async function () {
      // Mine a block to bypass antiMEV modifier
      await network.provider.send("evm_mine");

      const unstakeAmount = ethers.parseUnits("500", 18);

      await expect(stakingContract.connect(alice).unstake(unstakeAmount))
        .to.emit(stakingContract, "Unstaked")
        .withArgs(alice.address, unstakeAmount, ethers.parseUnits("500", 18));
    });
  });

  describe("Reward Distribution", function () {
    beforeEach(async function () {
      // Alice and Bob stake tokens
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
      await stakingContract.connect(bob).stake(ethers.parseUnits("2000", 18));
    });

    it("Should distribute rewards proportionally", async function () {
      const rewardAmount = ethers.parseEther("3"); // 3 ETH

      // Send rewards to contract
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: rewardAmount
      });

      // Check accumulator updated
      const expectedAccReward = (rewardAmount * ethers.parseUnits("1", 30)) / ethers.parseUnits("3000", 18);
      expect(await stakingContract.accRewardPerShare()).to.equal(expectedAccReward);
    });

    it("Should calculate pending rewards correctly", async function () {
      // Fast forward to make users eligible
      await time.increase(ELIGIBILITY_DELAY + 1);

      const rewardAmount = ethers.parseEther("3"); // 3 ETH

      // Send rewards
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: rewardAmount
      });

      // Alice staked 1000/3000 = 1/3, should get 1 ETH
      // Bob staked 2000/3000 = 2/3, should get 2 ETH
      const alicePending = await stakingContract.pendingRewards(alice.address);
      const bobPending = await stakingContract.pendingRewards(bob.address);

      expect(alicePending).to.equal(ethers.parseEther("1"));
      expect(bobPending).to.equal(ethers.parseEther("2"));
    });

    it("Should return zero rewards for ineligible users", async function () {
      const rewardAmount = ethers.parseEther("3");

      // Send rewards immediately (users not eligible yet)
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: rewardAmount
      });

      // Users should have zero pending rewards (not eligible)
      expect(await stakingContract.pendingRewards(alice.address)).to.equal(0);
      expect(await stakingContract.pendingRewards(bob.address)).to.equal(0);
    });

    it("Should emit RewardsDistributed event", async function () {
      const rewardAmount = ethers.parseEther("3");

      await expect(
        owner.sendTransaction({
          to: await stakingContract.getAddress(),
          value: rewardAmount
        })
      ).to.emit(stakingContract, "RewardsDistributed");
    });
  });

  describe("Reward Claims", function () {
    beforeEach(async function () {
      // Alice stakes and becomes eligible
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
      await time.increase(ELIGIBILITY_DELAY + 1);

      // Send rewards
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("1")
      });
    });

    it("Should allow users to claim rewards", async function () {
      const balanceBefore = await ethers.provider.getBalance(alice.address);

      const tx = await stakingContract.connect(alice).claimRewards();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(alice.address);

      // Alice should receive 1 ETH minus gas costs
      expect(balanceAfter).to.equal(balanceBefore + ethers.parseEther("1") - gasUsed);
    });

    it("Should update reward debt after claiming", async function () {
      await stakingContract.connect(alice).claimRewards();

      // Pending rewards should be zero after claiming
      expect(await stakingContract.pendingRewards(alice.address)).to.equal(0);
    });

    it("Should prevent double claiming", async function () {
      await stakingContract.connect(alice).claimRewards();

      // Second claim should have no effect
      const balanceBefore = await ethers.provider.getBalance(alice.address);
      await stakingContract.connect(alice).claimRewards();
      const balanceAfter = await ethers.provider.getBalance(alice.address);

      // Balance should only decrease by gas costs
      expect(balanceAfter).to.be.lt(balanceBefore);
    });

    it("Should emit RewardsClaimed event", async function () {
      await expect(stakingContract.connect(alice).claimRewards())
        .to.emit(stakingContract, "RewardsClaimed")
        .withArgs(alice.address, ethers.parseEther("1"));
    });
  });

  describe("Multi-user Scenarios", function () {
    it("Should handle complex staking/unstaking/rewards scenario", async function () {
      // Initial stakes
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
      await stakingContract.connect(bob).stake(ethers.parseUnits("2000", 18));

      // Fast forward to eligibility
      await time.increase(ELIGIBILITY_DELAY + 1);

      // First reward distribution: 3 ETH
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("3")
      });

      // Carol stakes after first reward
      await stakingContract.connect(carol).stake(ethers.parseUnits("3000", 18));

      // Second reward distribution: 6 ETH
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("6")
      });

      // Alice: 1000/3000 * 3 + 1000/6000 * 6 = 1 + 1 = 2 ETH
      // Bob: 2000/3000 * 3 + 2000/6000 * 6 = 2 + 2 = 4 ETH
      // Carol: 0 + 3000/6000 * 6 = 0 + 3 = 3 ETH (but not eligible yet)

      expect(await stakingContract.pendingRewards(alice.address)).to.equal(ethers.parseEther("2"));
      expect(await stakingContract.pendingRewards(bob.address)).to.equal(ethers.parseEther("4"));
      expect(await stakingContract.pendingRewards(carol.address)).to.equal(0); // Not eligible
    });

    it("Should handle late joiner becoming eligible", async function () {
      // Alice stakes first
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));

      // Fast forward, Alice becomes eligible
      await time.increase(ELIGIBILITY_DELAY + 1);

      // Bob stakes (late joiner)
      await stakingContract.connect(bob).stake(ethers.parseUnits("1000", 18));

      // Reward distribution - both have 1000 tokens, rewards split proportionally
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("2")
      });

      // Each gets 1 ETH proportionally, but Bob is not eligible yet
      expect(await stakingContract.pendingRewards(alice.address)).to.equal(ethers.parseEther("1"));
      expect(await stakingContract.pendingRewards(bob.address)).to.equal(0);

      // Fast forward, Bob becomes eligible
      await time.increase(ELIGIBILITY_DELAY + 1);

      // Bob is now eligible and can see his pending rewards from first distribution
      // Both have equal shares, so Bob gets 1 ETH from first distribution
      expect(await stakingContract.pendingRewards(bob.address)).to.equal(ethers.parseEther("1"));

      // New rewards
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("2")
      });

      // Both get 1 ETH each from second distribution
      // Alice total: 1 + 1 = 2 ETH
      // Bob total: 1 + 1 = 2 ETH (he gets his share from first distribution too once eligible)
      expect(await stakingContract.pendingRewards(alice.address)).to.equal(ethers.parseEther("2"));
      expect(await stakingContract.pendingRewards(bob.address)).to.equal(ethers.parseEther("2"));
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
    });

    it("Should return correct user info", async function () {
      const userInfo = await stakingContract.getUserInfo(alice.address);

      expect(userInfo.stakedAmount).to.equal(ethers.parseUnits("1000", 18));
      expect(userInfo.isEligible).to.be.false; // Not eligible yet
      expect(userInfo.timeToEligibility).to.be.gt(0);
    });

    it("Should return correct user info after eligibility", async function () {
      await time.increase(ELIGIBILITY_DELAY + 1);

      const userInfo = await stakingContract.getUserInfo(alice.address);

      expect(userInfo.stakedAmount).to.equal(ethers.parseUnits("1000", 18));
      expect(userInfo.isEligible).to.be.true;
      expect(userInfo.timeToEligibility).to.equal(0);
    });

    it("Should return correct global stats", async function () {
      const stats = await stakingContract.getGlobalStats();

      expect(stats.totalStakedTokens).to.equal(ethers.parseUnits("1000", 18));
      expect(stats.totalRewardsAvailable).to.equal(0);
    });

    it("Should calculate APY correctly", async function () {
      const recentRewards = ethers.parseEther("7"); // 7 ETH per week
      const periodDays = 7;

      const apy = await stakingContract.calculateAPY(recentRewards, periodDays);

      // 7 ETH per week on 1000 tokens = 7/1000 per week = 364% APY
      const expectedAPY = (recentRewards * ethers.parseUnits("365", 30)) / (ethers.parseUnits("1000", 18) * BigInt(periodDays));
      expect(apy).to.equal(expectedAPY);
    });

    it("Should return zero APY when no tokens staked", async function () {
      // Deploy fresh contract
      const MasterChefStaking = await ethers.getContractFactory("MasterChefStaking");
      const freshContract = await MasterChefStaking.deploy(
        await stakingToken.getAddress(),
        ELIGIBILITY_DELAY
      );

      const apy = await freshContract.calculateAPY(ethers.parseEther("1"), 7);
      expect(apy).to.equal(0);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero total staked when rewards arrive", async function () {
      // Send ETH when no one is staking
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("1")
      });

      // Accumulator should remain zero
      expect(await stakingContract.accRewardPerShare()).to.equal(0);
    });

    it("Should handle precise reward calculations", async function () {
      // Stake odd amounts
      await stakingContract.connect(alice).stake(ethers.parseUnits("333", 18));
      await stakingContract.connect(bob).stake(ethers.parseUnits("667", 18));

      await time.increase(ELIGIBILITY_DELAY + 1);

      // Send odd reward amount
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("1.23456789")
      });

      const alicePending = await stakingContract.pendingRewards(alice.address);
      const bobPending = await stakingContract.pendingRewards(bob.address);

      // Total should equal sent amount (within precision)
      const total = alicePending + bobPending;
      expect(total).to.be.closeTo(ethers.parseEther("1.23456789"), ethers.parseUnits("1", 0));
    });

    it("Should handle very small stakes", async function () {
      // Stake minimum amount
      const minStake = await stakingContract.MIN_STAKE_AMOUNT();
      await stakingToken.connect(alice).approve(await stakingContract.getAddress(), minStake);
      await stakingContract.connect(alice).stake(minStake);

      const userInfo = await stakingContract.userInfo(alice.address);
      expect(userInfo.amount).to.equal(minStake);
    });

    it("Should handle large rewards", async function () {
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
      await time.increase(ELIGIBILITY_DELAY + 1);

      // Send a reasonably large reward (100 ETH)
      const largeReward = ethers.parseEther("100");
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: largeReward
      });

      expect(await stakingContract.pendingRewards(alice.address)).to.equal(largeReward);
    });
  });

  describe("MEV Protection", function () {
    it("Should prevent actions in same block", async function () {
      await stakingContract.connect(alice).stake(ethers.parseUnits("500", 18));

      // Try to stake again without mining a block
      await expect(
        stakingContract.connect(alice).stake(ethers.parseUnits("500", 18))
      ).to.be.revertedWith("Action too frequent");
    });

    it("Should allow actions after block delay", async function () {
      await stakingContract.connect(alice).stake(ethers.parseUnits("500", 18));

      // Mine a block
      await network.provider.send("evm_mine");

      // Should succeed now
      await expect(
        stakingContract.connect(alice).stake(ethers.parseUnits("500", 18))
      ).to.not.be.reverted;
    });
  });

  describe("Add Rewards Function", function () {
    beforeEach(async function () {
      await stakingContract.connect(alice).stake(ethers.parseUnits("1000", 18));
    });

    it("Should allow adding rewards via addRewards", async function () {
      const rewardAmount = ethers.parseEther("1");

      await stakingContract.addRewards({ value: rewardAmount });

      const stats = await stakingContract.getGlobalStats();
      expect(stats.totalRewardsAvailable).to.equal(rewardAmount);
    });

    it("Should emit event when adding rewards", async function () {
      const rewardAmount = ethers.parseEther("1");

      await expect(stakingContract.addRewards({ value: rewardAmount }))
        .to.emit(stakingContract, "RewardsDistributed");
    });
  });

  describe("Emergency Withdraw", function () {
    it("Should allow owner to emergency withdraw", async function () {
      // Send some ETH to contract
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("1")
      });

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await stakingContract.emergencyWithdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + ethers.parseEther("1") - gasUsed);
    });

    it("Should reject emergency withdraw from non-owner", async function () {
      await owner.sendTransaction({
        to: await stakingContract.getAddress(),
        value: ethers.parseEther("1")
      });

      await expect(
        stakingContract.connect(alice).emergencyWithdraw()
      ).to.be.revertedWithCustomError(stakingContract, "OwnableUnauthorizedAccount");
    });

    it("Should reject emergency withdraw with no balance", async function () {
      await expect(stakingContract.emergencyWithdraw())
        .to.be.revertedWith("No funds to withdraw");
    });
  });

  describe("Configurable Eligibility Delay", function () {
    it("Should work with zero eligibility delay", async function () {
      const MasterChefStaking = await ethers.getContractFactory("MasterChefStaking");
      const noDelayContract = await MasterChefStaking.deploy(
        await stakingToken.getAddress(),
        0 // No delay
      );

      await stakingToken.connect(alice).approve(await noDelayContract.getAddress(), ethers.parseUnits("1000", 18));
      await noDelayContract.connect(alice).stake(ethers.parseUnits("1000", 18));

      // Send rewards
      await owner.sendTransaction({
        to: await noDelayContract.getAddress(),
        value: ethers.parseEther("1")
      });

      // Should be immediately eligible
      expect(await noDelayContract.pendingRewards(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("Should work with custom eligibility delay", async function () {
      const customDelay = 60 * 60; // 1 hour
      const MasterChefStaking = await ethers.getContractFactory("MasterChefStaking");
      const customContract = await MasterChefStaking.deploy(
        await stakingToken.getAddress(),
        customDelay
      );

      await stakingToken.connect(alice).approve(await customContract.getAddress(), ethers.parseUnits("1000", 18));
      await customContract.connect(alice).stake(ethers.parseUnits("1000", 18));

      await owner.sendTransaction({
        to: await customContract.getAddress(),
        value: ethers.parseEther("1")
      });

      // Not eligible yet
      expect(await customContract.pendingRewards(alice.address)).to.equal(0);

      // Wait 1 hour
      await time.increase(customDelay + 1);

      // Now eligible
      expect(await customContract.pendingRewards(alice.address)).to.equal(ethers.parseEther("1"));
    });
  });
});
