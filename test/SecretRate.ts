import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ConfidentialUSDT, SecretRate } from "../types";

describe("SecretRate", function () {
  let cusdt: ConfidentialUSDT;
  let vault: SecretRate;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }

    [deployer, user] = await ethers.getSigners();

    const cusdtFactory = await ethers.getContractFactory("ConfidentialUSDT");
    cusdt = (await cusdtFactory.deploy()) as ConfidentialUSDT;

    const vaultFactory = await ethers.getContractFactory("SecretRate");
    vault = (await vaultFactory.deploy(await cusdt.getAddress())) as SecretRate;

    await cusdt.connect(deployer).setMinter(await vault.getAddress());
  });

  it("stores encrypted stake and decrypts with ACL", async function () {
    const value = ethers.parseEther("1");
    await vault.connect(user).stake({ value });

    const encrypted = await vault.getEncryptedStake(user.address);
    const decrypted = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encrypted,
      await vault.getAddress(),
      user
    );

    expect(decrypted).to.eq(value);
  });

  it("accrues and mints interest as cUSDT", async function () {
    const value = ethers.parseEther("1");
    await vault.connect(user).stake({ value });

    await ethers.provider.send("evm_increaseTime", [86_400]);
    await ethers.provider.send("evm_mine", []);

    const pending = await vault.pendingRewards(user.address);
    expect(pending).to.be.greaterThan(0);

    await vault.connect(user).claimInterest();

    const encryptedBalance = await cusdt.confidentialBalanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      await cusdt.getAddress(),
      user
    );

    expect(clearBalance).to.be.gte(1_000_000n);
    expect(clearBalance).to.be.lte(1_010_000n);

    const pendingAfter = await vault.pendingRewards(user.address);
    expect(pendingAfter).to.eq(0);
  });

  it("requests and finalizes withdraw with public decryption proof", async function () {
    const value = ethers.parseEther("0.5");
    await vault.connect(user).stake({ value });

    await vault.connect(user).requestWithdraw();
    const encrypted = await vault.getEncryptedStake(user.address);

    const handleHex = encrypted as string;
    const decryption = await fhevm.publicDecrypt([handleHex]);
    const clearValue = BigInt(decryption.clearValues[handleHex]);

    const tx = await vault.finalizeWithdraw(encrypted, clearValue, decryption.decryptionProof);
    await tx.wait();

    const [plainAmount] = await vault.stakeDetails(user.address);
    expect(plainAmount).to.eq(0);

    const contractBalance = await ethers.provider.getBalance(await vault.getAddress());
    expect(contractBalance).to.eq(0);
  });
});
