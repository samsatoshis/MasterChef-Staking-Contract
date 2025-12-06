# MasterChef Staking Contract

A gas-optimized, infinitely scalable staking contract using the proven **MasterChef pattern** for native token (ETH/BNB/MATIC) reward distribution.

## Table of Contents

- [Features](#features)
- [What is MasterChef Staking?](#what-is-masterchef-staking)
  - [The Problem with Traditional Approaches](#the-problem-with-traditional-approaches)
  - [The MasterChef Solution](#the-masterchef-solution)
  - [Why It's Called "MasterChef"](#why-its-called-masterchef)
- [Who Uses MasterChef?](#who-uses-masterchef)
  - [Major Protocols Using MasterChef](#major-protocols-using-masterchef)
  - [Why These Protocols Chose MasterChef](#why-these-protocols-chose-masterchef)
- [How This Contract Works](#how-this-contract-works)
  - [The Core Algorithm](#the-core-algorithm)
  - [Visual Example](#visual-example)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Ethereum Configuration](#ethereum-configuration)
  - [BNB Smart Chain Configuration](#bnb-smart-chain-configuration)
  - [Base Configuration](#base-configuration)
  - [Polygon Configuration](#polygon-configuration)
  - [Arbitrum Configuration](#arbitrum-configuration)
  - [Configuration Notes](#configuration-notes)
- [Usage](#usage)
  - [Compile Contracts](#compile-contracts)
  - [Run Tests](#run-tests)
  - [Deploy](#deploy)
    - [Local Development](#local-development)
    - [Ethereum](#ethereum)
    - [BNB Smart Chain](#bnb-smart-chain)
    - [Base](#base)
    - [Polygon](#polygon)
    - [Arbitrum](#arbitrum)
  - [Contract Verification](#contract-verification)
    - [Ethereum (Etherscan)](#ethereum-etherscan)
    - [BNB Smart Chain (BSCScan)](#bnb-smart-chain-bscscan)
    - [Base (Basescan)](#base-basescan)
    - [Polygon (Polygonscan)](#polygon-polygonscan)
    - [Arbitrum (Arbiscan)](#arbitrum-arbiscan)
    - [Verification Example](#verification-example)
- [Contract Interface](#contract-interface)
  - [Core Functions](#core-functions)
  - [View Functions](#view-functions)
  - [Reward Distribution](#reward-distribution)
- [Frontend Integration](#frontend-integration)
- [Security Features](#security-features)
- [Gas Comparison](#gas-comparison)
- [Constructor Parameters](#constructor-parameters)
- [Constants](#constants)
- [Supported Networks](#supported-networks)
- [Testing](#testing)
- [License](#license)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)

## Features

- **Infinite Scalability** - O(1) operations, no loops, works with millions of users
- **Gas Optimized** - 80-90% gas reduction compared to snapshot-based approaches
- **Real-time Rewards** - Users see earnings update immediately
- **Anti-Frontrunning** - Configurable eligibility delay prevents flash loan attacks
- **MEV Protection** - Block-based delay between user actions
- **EIP-2612 Support** - Gasless staking via permit signatures
- **Battle-tested Pattern** - Based on the MasterChef algorithm used by billions in DeFi TVL

## What is MasterChef Staking?

The **MasterChef pattern** is a revolutionary reward distribution algorithm first introduced by SushiSwap in 2020. It solved a critical problem in DeFi: how to fairly distribute rewards to thousands (or millions) of stakers without running out of gas.

### The Problem with Traditional Approaches

Traditional staking contracts often use one of these approaches:

1. **Snapshot-based**: Take periodic snapshots of all stakers and distribute rewards based on those snapshots. This requires O(n) operations where n is the number of users.

2. **Epoch-based**: Accumulate rewards in epochs and require users to claim from each epoch. This requires O(m) operations where m is the number of epochs.

3. **Push-based**: Iterate through all users and push rewards to them. This fails completely at scale.

All these approaches have a fatal flaw: **gas costs increase linearly with users or time**, eventually making the contract unusable.

### The MasterChef Solution

MasterChef uses a mathematical trick called an **accumulator** that achieves O(1) complexity for all operations:

```
accRewardPerShare = Total rewards ever distributed / Total tokens ever staked
```

Instead of tracking what each user is owed, we track a single global number that represents "rewards per token." When a user stakes or unstakes, we record their "reward debt" - what they would have earned if they had been staking since the beginning.

```
User's Pending Rewards = (User's Stake × accRewardPerShare) - User's Reward Debt
```

This elegant formula means:
- **Adding rewards**: One storage write, regardless of user count
- **Staking/Unstaking**: Two storage writes per user
- **Claiming**: One storage read + one write
- **Checking rewards**: One storage read (view function, free)

### Why It's Called "MasterChef"

The name comes from SushiSwap's original contract that distributed SUSHI tokens to liquidity providers. The "chef" metaphor represents the contract as a chef distributing "rewards" (food) to "stakers" (diners) fairly based on how much they contributed.

## Who Uses MasterChef?

The MasterChef pattern has become the gold standard for reward distribution in DeFi. Here are notable protocols that use it or variations of it:

### Major Protocols Using MasterChef

| Protocol | TVL | Description |
|----------|-----|-------------|
| **SushiSwap** | $200M+ | The original MasterChef creator, used for SUSHI farming |
| **PancakeSwap** | $1.5B+ | BSC's largest DEX, uses MasterChef for CAKE distribution |
| **Uniswap V3** | $3B+ | Uses similar accumulator math for fee distribution |
| **Convex Finance** | $2B+ | CVX and CRV reward distribution |
| **Aura Finance** | $500M+ | AURA rewards for Balancer LPs |
| **Yearn Finance** | $300M+ | Vault reward calculations |
| **TraderJoe** | $100M+ | Avalanche DEX with JOE farming |
| **SpookySwap** | $50M+ | Fantom DEX using BOO rewards |
| **Quickswap** | $100M+ | Polygon DEX with QUICK farming |
| **Trader Joe V2** | $200M+ | Uses MasterChef for liquidity incentives |

### Why These Protocols Chose MasterChef

1. **Battle-tested**: The pattern has secured billions of dollars since 2020
2. **Gas efficient**: Users pay the same gas whether there are 10 or 10 million stakers
3. **Fair distribution**: Mathematical precision ensures no user is shortchanged
4. **Real-time**: No waiting for epochs or snapshots
5. **Simple integration**: Easy to integrate with any ERC20 token

## How This Contract Works

Users stake ERC20 tokens to earn native token (ETH/BNB/MATIC) rewards. When rewards are sent to the contract, they are distributed proportionally to all stakers based on their stake size.

### The Core Algorithm

Instead of taking snapshots or iterating through users, the contract uses mathematical accumulators:

```solidity
// When rewards arrive - single operation distributes to ALL stakers
accRewardPerShare += (newRewards * PRECISION) / totalStaked;

// User rewards calculated on-demand - O(1) complexity
pendingRewards = (userStake * accRewardPerShare) - userRewardDebt;
```

This elegant approach ensures:
- Constant gas costs regardless of user count
- Perfect proportional distribution
- No need for epochs or snapshots

### Visual Example

```
Timeline:
─────────────────────────────────────────────────────────────────
Day 1: Alice stakes 1000 tokens
       accRewardPerShare = 0
       Alice.rewardDebt = 0

Day 3: 10 ETH rewards arrive (Alice is only staker)
       accRewardPerShare = 10 ETH / 1000 tokens = 0.01 ETH/token
       Alice pending = (1000 × 0.01) - 0 = 10 ETH ✓

Day 5: Bob stakes 1000 tokens
       Bob.rewardDebt = 1000 × 0.01 = 10 ETH (what he "missed")
       Bob pending = (1000 × 0.01) - 10 = 0 ETH ✓ (just joined)

Day 7: 20 ETH rewards arrive (2000 total staked)
       accRewardPerShare = 0.01 + (20/2000) = 0.02 ETH/token
       Alice pending = (1000 × 0.02) - 0 = 20 ETH ✓
       Bob pending = (1000 × 0.02) - 10 = 10 ETH ✓

Result: Alice got 10 + 10 = 20 ETH, Bob got 10 ETH. Fair! ✓
─────────────────────────────────────────────────────────────────
```

## Installation

```bash
# Clone the repository
git clone https://github.com/samsatoshis/MasterChef-Staking-Contract.git
cd MasterChef-Staking-Contract

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

## Configuration

Create a `.env` file based on the network you want to deploy to:

### Ethereum Configuration

```env
# Wallet
PRIVATE_KEY=your_private_key_here

# Staking token address
STAKING_TOKEN_ADDRESS=0x...

# Eligibility delay (optional, default: 3 days = 259200 seconds)
ELIGIBILITY_DELAY=259200

# Ethereum RPC URLs
SEPOLIA_URL=https://rpc.sepolia.org
MAINNET_URL=https://eth.llamarpc.com

# Contract verification
ETHERSCAN_API_KEY=your_etherscan_api_key
```

**Deploy commands:**
```bash
# Testnet (Sepolia)
npx hardhat run scripts/deploy.js --network sepolia

# Mainnet
npx hardhat run scripts/deploy.js --network mainnet
```

### BNB Smart Chain Configuration

```env
# Wallet
PRIVATE_KEY=your_private_key_here

# Staking token address (BEP-20)
STAKING_TOKEN_ADDRESS=0x...

# Eligibility delay (optional)
ELIGIBILITY_DELAY=259200

# BSC RPC URLs
BSC_TESTNET_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
BSC_MAINNET_URL=https://bsc-dataseed1.binance.org/

# Contract verification
BSCSCAN_API_KEY=your_bscscan_api_key
```

**Deploy commands:**
```bash
# Testnet
npx hardhat run scripts/deploy.js --network bscTestnet

# Mainnet
npx hardhat run scripts/deploy.js --network bscMainnet
```

### Base Configuration

```env
# Wallet
PRIVATE_KEY=your_private_key_here

# Staking token address
STAKING_TOKEN_ADDRESS=0x...

# Eligibility delay (optional)
ELIGIBILITY_DELAY=259200

# Base RPC URLs
BASE_SEPOLIA_URL=https://sepolia.base.org
BASE_URL=https://mainnet.base.org

# Contract verification
BASESCAN_API_KEY=your_basescan_api_key
```

**Deploy commands:**
```bash
# Testnet (Base Sepolia)
npx hardhat run scripts/deploy.js --network baseSepolia

# Mainnet
npx hardhat run scripts/deploy.js --network base
```

### Polygon Configuration

```env
# Wallet
PRIVATE_KEY=your_private_key_here

# Staking token address
STAKING_TOKEN_ADDRESS=0x...

# Eligibility delay (optional)
ELIGIBILITY_DELAY=259200

# Polygon RPC URLs
POLYGON_AMOY_URL=https://rpc-amoy.polygon.technology
POLYGON_URL=https://polygon-rpc.com

# Contract verification
POLYGONSCAN_API_KEY=your_polygonscan_api_key
```

**Deploy commands:**
```bash
# Testnet (Amoy)
npx hardhat run scripts/deploy.js --network polygonAmoy

# Mainnet
npx hardhat run scripts/deploy.js --network polygon
```

### Arbitrum Configuration

```env
# Wallet
PRIVATE_KEY=your_private_key_here

# Staking token address
STAKING_TOKEN_ADDRESS=0x...

# Eligibility delay (optional)
ELIGIBILITY_DELAY=259200

# Arbitrum RPC URLs
ARBITRUM_SEPOLIA_URL=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_URL=https://arb1.arbitrum.io/rpc

# Contract verification
ARBISCAN_API_KEY=your_arbiscan_api_key
```

**Deploy commands:**
```bash
# Testnet (Arbitrum Sepolia)
npx hardhat run scripts/deploy.js --network arbitrumSepolia

# Mainnet
npx hardhat run scripts/deploy.js --network arbitrum
```

### Configuration Notes

| Parameter | Description | Default |
|-----------|-------------|---------|
| `PRIVATE_KEY` | Your wallet private key (without 0x prefix) | Required |
| `STAKING_TOKEN_ADDRESS` | ERC20/BEP20 token address to stake | Required |
| `ELIGIBILITY_DELAY` | Seconds before stakers can claim rewards | 259200 (3 days) |

**Common Eligibility Delay Values:**
- `0` - No delay (immediate rewards)
- `3600` - 1 hour
- `86400` - 1 day
- `259200` - 3 days (recommended for anti-frontrunning)
- `604800` - 7 days

## Usage

### Compile Contracts

```bash
npm run compile
```

### Run Tests

```bash
npm test
```

### Deploy

#### Local Development

```bash
# Start local node
npx hardhat node

# Deploy to local network (in another terminal)
npx hardhat run scripts/deploy.js --network localhost
```

#### Ethereum

```bash
# Testnet (Sepolia)
npx hardhat run scripts/deploy.js --network sepolia

# Mainnet
npx hardhat run scripts/deploy.js --network mainnet
```

#### BNB Smart Chain

```bash
# Testnet
npx hardhat run scripts/deploy.js --network bscTestnet

# Mainnet
npx hardhat run scripts/deploy.js --network bscMainnet
```

#### Base

```bash
# Testnet (Base Sepolia)
npx hardhat run scripts/deploy.js --network baseSepolia

# Mainnet
npx hardhat run scripts/deploy.js --network base
```

#### Polygon

```bash
# Testnet (Amoy)
npx hardhat run scripts/deploy.js --network polygonAmoy

# Mainnet
npx hardhat run scripts/deploy.js --network polygon
```

#### Arbitrum

```bash
# Testnet (Arbitrum Sepolia)
npx hardhat run scripts/deploy.js --network arbitrumSepolia

# Mainnet
npx hardhat run scripts/deploy.js --network arbitrum
```

### Contract Verification

After deployment, verify your contract on the block explorer. Replace the placeholders with your actual values.

#### Ethereum (Etherscan)

```bash
# Sepolia
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"

# Mainnet
npx hardhat verify --network mainnet <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"
```

#### BNB Smart Chain (BSCScan)

```bash
# Testnet
npx hardhat verify --network bscTestnet <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"

# Mainnet
npx hardhat verify --network bscMainnet <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"
```

#### Base (Basescan)

```bash
# Base Sepolia
npx hardhat verify --network baseSepolia <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"

# Mainnet
npx hardhat verify --network base <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"
```

#### Polygon (Polygonscan)

```bash
# Amoy
npx hardhat verify --network polygonAmoy <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"

# Mainnet
npx hardhat verify --network polygon <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"
```

#### Arbitrum (Arbiscan)

```bash
# Arbitrum Sepolia
npx hardhat verify --network arbitrumSepolia <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"

# Mainnet
npx hardhat verify --network arbitrum <CONTRACT_ADDRESS> "<TOKEN_ADDRESS>" "<ELIGIBILITY_DELAY>"
```

#### Verification Example

```bash
# Example: Verify on BSC Mainnet with 3-day eligibility delay
npx hardhat verify --network bscMainnet 0x1234...abcd "0xYourTokenAddress" "259200"
```

## Contract Interface

### Core Functions

```solidity
// Stake tokens
function stake(uint256 amount) external;

// Stake with gasless approval (EIP-2612)
function permitAndStake(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

// Unstake tokens (auto-claims rewards if eligible)
function unstake(uint256 amount) external;

// Claim pending rewards
function claimRewards() external;
```

### View Functions

```solidity
// Get pending rewards for a user
function pendingRewards(address user) external view returns (uint256);

// Get comprehensive user info
function getUserInfo(address user) external view returns (
    uint256 stakedAmount,
    uint256 pendingRewardsAmount,
    uint256 stakeTime,
    bool isEligible,
    uint256 timeToEligibility
);

// Get global statistics
function getGlobalStats() external view returns (
    uint256 totalStakedTokens,
    uint256 totalRewardsAvailable,
    uint256 rewardPerShare,
    uint256 lastDistribution
);

// Calculate APY based on recent rewards
function calculateAPY(uint256 recentRewards, uint256 periodDays) external view returns (uint256);
```

### Reward Distribution

Rewards can be sent to the contract in two ways:

```solidity
// 1. Direct transfer (triggers receive())
await owner.sendTransaction({ to: stakingContract, value: rewardAmount });

// 2. Using addRewards function
await stakingContract.addRewards({ value: rewardAmount });
```

## Frontend Integration

```javascript
const { ethers } = require("ethers");

// Connect to contract
const stakingContract = new ethers.Contract(address, abi, signer);

// Stake tokens
await stakingToken.approve(stakingContract.address, amount);
await stakingContract.stake(amount);

// Get user info
const info = await stakingContract.getUserInfo(userAddress);
console.log(`Staked: ${ethers.formatEther(info.stakedAmount)} tokens`);
console.log(`Pending: ${ethers.formatEther(info.pendingRewardsAmount)} ETH`);
console.log(`Eligible: ${info.isEligible}`);

// Claim rewards
await stakingContract.claimRewards();

// Unstake
await stakingContract.unstake(amount);
```

## Security Features

1. **ReentrancyGuard** - All state-changing functions protected
2. **Anti-Frontrunning** - Configurable eligibility delay (default 3 days)
3. **MEV Protection** - Minimum 1 block delay between user actions
4. **High Precision** - 1e30 precision factor prevents rounding attacks
5. **Overflow Protection** - Solidity 0.8.22 built-in overflow checks
6. **Access Control** - Owner-only emergency functions

## Gas Comparison

| Operation | Snapshot-based | MasterChef (this contract) | Improvement |
|-----------|----------------|---------------------------|-------------|
| Stake | O(n) | O(1) | 90% reduction |
| Unstake | O(n) | O(1) | 90% reduction |
| Claim | O(m) epochs | O(1) | 95% reduction |
| Distribute | O(n) users | O(1) | 99% reduction |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `_stakingToken` | address | ERC20 token address that users stake |
| `_eligibilityDelay` | uint256 | Seconds before stakers can claim rewards (anti-frontrunning) |

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `PRECISION` | 1e30 | Precision factor for calculations |
| `MIN_STAKE_AMOUNT` | 1e6 | Minimum stake (prevents dust attacks) |
| `MIN_BLOCK_DELAY` | 1 | Blocks between user actions (MEV protection) |

## Supported Networks

Pre-configured networks in `hardhat.config.js`:

- Ethereum: Mainnet, Sepolia
- BSC: Mainnet, Testnet
- Polygon: Mainnet, Amoy
- Arbitrum: One, Sepolia
- Base: Mainnet, Sepolia

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx hardhat test test/MasterChefStaking.test.js
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

This contract is inspired by the MasterChef pattern pioneered by SushiSwap, which has been battle-tested with billions of dollars in TVL across DeFi.
