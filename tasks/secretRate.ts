import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:vault-address", "Prints deployed SecretRate and cUSDT addresses").setAction(async (_args, hre) => {
  const { deployments } = hre;
  const vaultDeployment = await deployments.get("SecretRate");
  const cusdtDeployment = await deployments.get("ConfidentialUSDT");
  console.log(`SecretRate: ${vaultDeployment.address}`);
  console.log(`ConfidentialUSDT: ${cusdtDeployment.address}`);
});

task("task:stake-eth", "Stake ETH into SecretRate")
  .addParam("amount", "Amount in ETH (e.g. 0.5)")
  .setAction(async (args: TaskArguments, hre) => {
    const { ethers, deployments } = hre;
    const value = ethers.parseEther(args.amount);
    const [signer] = await ethers.getSigners();

    const vaultDeployment = await deployments.get("SecretRate");
    const vault = await ethers.getContractAt("SecretRate", vaultDeployment.address);

    const tx = await vault.connect(signer).stake({ value });
    console.log(`Stake tx: ${tx.hash}`);
    await tx.wait();
    console.log(`Staked ${args.amount} ETH`);
  });

task("task:claim-yield", "Claim cUSDT yield from SecretRate").setAction(async (_args, hre) => {
  const { ethers, deployments } = hre;
  const [signer] = await ethers.getSigners();

  const vaultDeployment = await deployments.get("SecretRate");
  const vault = await ethers.getContractAt("SecretRate", vaultDeployment.address);

  const tx = await vault.connect(signer).claimInterest();
  console.log(`Claim tx: ${tx.hash}`);
  await tx.wait();
});

task("task:decrypt-stake", "Decrypt the caller stake value")
  .addOptionalParam("user", "Address to decrypt")
  .setAction(async (args: TaskArguments, hre) => {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const [signer] = await ethers.getSigners();
    const target = args.user || signer.address;

    const vaultDeployment = await deployments.get("SecretRate");
    const vault = await ethers.getContractAt("SecretRate", vaultDeployment.address);

    const encrypted = await vault.getEncryptedStake(target);
    console.log(`Encrypted stake handle: ${encrypted}`);
    if (encrypted === ethers.ZeroHash) {
      console.log("Stake is empty");
      return;
    }

    const clearValue = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encrypted,
      vaultDeployment.address,
      signer
    );

    console.log(`Decrypted stake for ${target}: ${clearValue.toString()} wei`);
  });
