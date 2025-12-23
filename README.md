# SecretRate

SecretRate is a privacy-first ETH staking vault that keeps user principal encrypted on-chain and pays yield in
confidential cUSDT. It is built on Zama's FHEVM stack so balances can remain hidden while the contract still
computes rewards deterministically.

## Overview
- Stake ETH while keeping the staked amount encrypted on-chain.
- Earn yield at a fixed rate of 1 cUSDT per 1 ETH per day (cUSDT uses 6 decimals).
- Claim yield at any time as confidential cUSDT.
- Withdraw staked ETH through a two-step flow that uses a relayer decryption proof.
- Decrypt your own encrypted stake and cUSDT balances in the UI when needed.

## Problems This Project Solves
- **On-chain privacy loss**: Standard staking reveals exact principal amounts; SecretRate keeps the principal encrypted.
- **Private rewards**: Yield payouts are issued as confidential tokens so reward balances are not publicly visible.
- **Verifiable yield logic**: Rewards are computed on-chain with a fixed formula, removing off-chain calculation risk.
- **Safe withdrawals**: A public decryption proof is used so the contract can safely release funds without revealing
  the stake amount ahead of time.

## Advantages
- **Encrypted principal**: Stakes are stored as `euint64` and only revealed with explicit user or public decryption.
- **Deterministic yield**: 1 cUSDT / ETH / day, accrued per second and claimable at any time.
- **Non-custodial**: Users control their funds and only the vault can mint rewards.
- **FHEVM-native**: Uses Zama FHEVM primitives (`allow`, `makePubliclyDecryptable`, proof verification).
- **Clear separation of concerns**: ConfidentialUSDT handles token logic, SecretRate handles staking and yield.
- **Auditable flow**: Event emissions mark stake, claim, and withdrawal lifecycles.

## How It Works (End-to-End)
1. **Stake ETH**
   - User sends ETH to `stake()`.
   - Contract converts the deposit to an encrypted `euint64` and adds it to the encrypted balance.
   - The encrypted balance is ACL-enabled so the user can decrypt it later.

2. **Accrue Rewards**
   - Rewards accrue over time based on the plain ETH amount stored for accounting.
   - Formula: `(stake * REWARD_PER_ETH_PER_DAY * elapsedSeconds) / (1 ether * 86400)`.

3. **Claim Yield**
   - `claimInterest()` mints confidential cUSDT to the user.
   - Rewards are stored as `uint256` and minted as encrypted cUSDT with 6 decimals.

4. **Withdraw ETH**
   - `requestWithdraw()` makes the encrypted balance publicly decryptable and emits a handle.
   - A relayer produces a proof of decryption for that handle.
   - `finalizeWithdraw()` verifies the proof and releases the ETH to the owner.

## Smart Contracts
- `contracts/SecretRate.sol`
  - ETH staking vault with encrypted balances and fixed-rate reward accrual.
  - Two-step withdrawal flow with public decryption proof verification.
  - Uses `ReentrancyGuard` and explicit checks for stake size limits.

- `contracts/ConfidentialUSDT.sol`
  - Confidential ERC7984 token (cUSDT) used for rewards.
  - Minting is restricted to the SecretRate vault via `setMinter()`.

## Frontend
- Located under `src/` (Vite + React).
- **Reads** use `viem` via `wagmi` hooks.
- **Writes** use `ethers` v6 signers.
- Uses Zama relayer APIs for user decryption and public decryption proofs.
- Addresses and ABIs are hardcoded in `src/src/config/contracts.ts` (no frontend environment variables).
- After deploying to Sepolia, paste the ABI from `deployments/sepolia/*.json` into the TS config file and update
  contract addresses.

## Tech Stack
- **Solidity 0.8.27**
- **Hardhat** + `hardhat-deploy`
- **Zama FHEVM** (`@fhevm/hardhat-plugin`, `@fhevm/solidity`)
- **OpenZeppelin** (`ReentrancyGuard`, `Ownable`, ERC7984)
- **React + Vite**
- **wagmi + RainbowKit**
- **viem** for read calls
- **ethers v6** for write calls

## Project Structure
```
contracts/            # Solidity contracts
  SecretRate.sol
  ConfidentialUSDT.sol
deploy/               # Deployment scripts
  deploy.ts
tasks/                # Hardhat tasks
  secretRate.ts
test/                 # Contract tests
  SecretRate.ts
deployments/          # Network deployment artifacts
src/                  # Frontend app (Vite + React)
docs/                 # Zama docs references
```

## Setup and Usage

### Prerequisites
- Node.js 20+
- npm

### Install Dependencies
```
npm install
```

Frontend dependencies (run inside `src/`):
```
npm install
```

### Configure Hardhat (Contracts Only)
Create a `.env` file at the repository root with:
```
PRIVATE_KEY=your_private_key
INFURA_API_KEY=your_infura_api_key
ETHERSCAN_API_KEY=optional
```
- Deployments use `PRIVATE_KEY` only (no mnemonic).

### Compile and Test
```
npm run compile
npm run test
```

### Local Deployment
Start a local node and deploy:
```
npx hardhat node
npx hardhat deploy --network hardhat
```

### Sepolia Deployment
```
npx hardhat deploy --network sepolia
```
After deployment, update `src/src/config/contracts.ts` with:
- SecretRate and ConfidentialUSDT addresses
- ABI arrays copied from `deployments/sepolia/*.json`

### Frontend Dev Server
From the frontend folder:
```
npm run dev
```

### Useful Tasks
```
# Print deployed contract addresses
npx hardhat task:vault-address --network sepolia

# Stake ETH (amount in ETH)
npx hardhat task:stake-eth --amount 0.5 --network sepolia

# Claim yield
npx hardhat task:claim-yield --network sepolia

# Decrypt stake (FHEVM mock or relayer enabled)
npx hardhat task:decrypt-stake --network sepolia
```

## Security and Privacy Notes
- Encrypted balances are stored as `euint64`; staking more than `uint64` max is rejected.
- Withdrawals require a valid decryption proof tied to the encrypted handle.
- Rewards are calculated from plain accounting values for deterministic yield.
- This repo is a prototype; production deployments should undergo professional audits.

## Roadmap
- Variable and governance-controlled interest rates
- Multi-asset support (LSTs or ERC20 staking)
- Auto-compounding or vault share tokens
- Deeper analytics and encrypted performance metrics
- Formal security review and invariant testing

## License
BSD-3-Clause-Clear (see `LICENSE`).
