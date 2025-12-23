import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, log } = hre.deployments;

  const deployedCusdt = await deploy("ConfidentialUSDT", {
    from: deployer,
    log: true,
  });
  log(`ConfidentialUSDT deployed at ${deployedCusdt.address}`);

  const deployedVault = await deploy("SecretRate", {
    from: deployer,
    args: [deployedCusdt.address],
    log: true,
  });
  log(`SecretRate deployed at ${deployedVault.address}`);

  const cusdt = await hre.ethers.getContractAt("ConfidentialUSDT", deployedCusdt.address);
  const currentMinter = await cusdt.minter();
  if (currentMinter !== deployedVault.address) {
    const tx = await cusdt.setMinter(deployedVault.address);
    await tx.wait();
    log(`Set SecretRate as cUSDT minter`);
  }
};
export default func;
func.id = "deploy_secret_rate"; // id required to prevent reexecution
func.tags = ["SecretRate"];
