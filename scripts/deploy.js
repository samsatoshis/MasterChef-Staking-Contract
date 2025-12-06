const hre = require("hardhat");

async function main() {
  console.log("Deploying MasterChefStaking...\n");

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer address:", deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Configuration - modify these values for your deployment
  const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS;
  const ELIGIBILITY_DELAY = process.env.ELIGIBILITY_DELAY || (3 * 24 * 60 * 60); // Default: 3 days

  if (!STAKING_TOKEN_ADDRESS) {
    console.error("ERROR: STAKING_TOKEN_ADDRESS environment variable is required");
    console.log("\nUsage:");
    console.log("  STAKING_TOKEN_ADDRESS=0x... npx hardhat run scripts/deploy.js --network <network>");
    console.log("\nOptional:");
    console.log("  ELIGIBILITY_DELAY=259200 (in seconds, default is 3 days)");
    process.exit(1);
  }

  console.log("Configuration:");
  console.log("  Staking Token:", STAKING_TOKEN_ADDRESS);
  console.log("  Eligibility Delay:", ELIGIBILITY_DELAY, "seconds (", ELIGIBILITY_DELAY / 86400, "days)");
  console.log("");

  // Deploy
  const MasterChefStaking = await hre.ethers.getContractFactory("MasterChefStaking");
  const stakingContract = await MasterChefStaking.deploy(
    STAKING_TOKEN_ADDRESS,
    ELIGIBILITY_DELAY
  );

  await stakingContract.waitForDeployment();
  const contractAddress = await stakingContract.getAddress();

  console.log("MasterChefStaking deployed to:", contractAddress);
  console.log("");

  // Verification instructions
  console.log("To verify on Etherscan/BSCScan:");
  console.log(`  npx hardhat verify --network ${hre.network.name} ${contractAddress} "${STAKING_TOKEN_ADDRESS}" "${ELIGIBILITY_DELAY}"`);
  console.log("");

  // Summary
  console.log("Deployment Summary:");
  console.log("  Contract: MasterChefStaking");
  console.log("  Address:", contractAddress);
  console.log("  Network:", hre.network.name);
  console.log("  Staking Token:", STAKING_TOKEN_ADDRESS);
  console.log("  Eligibility Delay:", ELIGIBILITY_DELAY, "seconds");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
