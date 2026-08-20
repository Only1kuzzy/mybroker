import { ethers } from 'hardhat';

async function main() {
  const Vault = await ethers.getContractFactory('TimeLockedVault');
  const vault = await Vault.deploy();
  await vault.waitForDeployment();
  console.log('TimeLockedVault deployed to:', await vault.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
