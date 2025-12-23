import { useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract, ethers } from 'ethers';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { CUSDT_ABI, CUSDT_ADDRESS, SECRET_RATE_ABI, SECRET_RATE_ADDRESS } from '../config/contracts';
import '../styles/StakingApp.css';

type ReadResult = readonly bigint[] | undefined;

export function SecretRateApp() {
  const { address } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading } = useZamaInstance();

  const { data: stakeSnapshot, refetch: refetchStakeSnapshot } = useReadContract({
    address: SECRET_RATE_ADDRESS,
    abi: SECRET_RATE_ABI,
    functionName: 'stakeDetails',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: encryptedStake, refetch: refetchEncryptedStake } = useReadContract({
    address: SECRET_RATE_ADDRESS,
    abi: SECRET_RATE_ABI,
    functionName: 'getEncryptedStake',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: pendingRewards, refetch: refetchPendingRewards } = useReadContract({
    address: SECRET_RATE_ADDRESS,
    abi: SECRET_RATE_ABI,
    functionName: 'pendingRewards',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: withdrawalHandle, refetch: refetchWithdrawalHandle } = useReadContract({
    address: SECRET_RATE_ADDRESS,
    abi: SECRET_RATE_ABI,
    functionName: 'withdrawalHandle',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: cusdtBalance, refetch: refetchCusdtBalance } = useReadContract({
    address: CUSDT_ADDRESS,
    abi: CUSDT_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const [stakeAmount, setStakeAmount] = useState('0.25');
  const [status, setStatus] = useState('');
  const [staking, setStaking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [decryptingStake, setDecryptingStake] = useState(false);
  const [decryptingCusdt, setDecryptingCusdt] = useState(false);
  const [decryptedStake, setDecryptedStake] = useState<string>('');
  const [decryptedCusdt, setDecryptedCusdt] = useState<string>('');

  const plainStake = useMemo(() => {
    const result = stakeSnapshot as ReadResult;
    return result?.[0] ?? 0n;
  }, [stakeSnapshot]);

  const accruedRewards = useMemo(() => {
    const result = stakeSnapshot as ReadResult;
    return result?.[1] ?? 0n;
  }, [stakeSnapshot]);

  const readableStake = ethers.formatEther(plainStake);
  const readableAccrued = ethers.formatUnits(accruedRewards, 6);
  const readablePending = ethers.formatUnits((pendingRewards as bigint | undefined) ?? 0n, 6);

  const refresh = async () => {
    await Promise.all([
      refetchStakeSnapshot?.(),
      refetchEncryptedStake?.(),
      refetchPendingRewards?.(),
      refetchWithdrawalHandle?.(),
      refetchCusdtBalance?.(),
    ]);
  };

  const handleStake = async () => {
    if (!address) {
      setStatus('Connect your wallet to stake.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }
    const value = Number(stakeAmount);
    if (Number.isNaN(value) || value <= 0) {
      setStatus('Enter a valid amount of ETH.');
      return;
    }

    try {
      setStaking(true);
      setStatus('Sending stake transaction...');
      const vault = new Contract(SECRET_RATE_ADDRESS, SECRET_RATE_ABI, signer);
      const tx = await vault.stake({ value: ethers.parseEther(stakeAmount) });
      await tx.wait();
      setStatus('Stake confirmed.');
      setDecryptedStake('');
      await refresh();
    } catch (err) {
      setStatus(`Stake failed: ${(err as Error).message}`);
    } finally {
      setStaking(false);
    }
  };

  const handleClaim = async () => {
    if (!address) {
      setStatus('Connect your wallet to claim.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }

    try {
      setClaiming(true);
      setStatus('Claiming cUSDT yield...');
      const vault = new Contract(SECRET_RATE_ADDRESS, SECRET_RATE_ABI, signer);
      const tx = await vault.claimInterest();
      await tx.wait();
      setStatus('Yield claimed.');
      setDecryptedCusdt('');
      await refresh();
    } catch (err) {
      setStatus(`Claim failed: ${(err as Error).message}`);
    } finally {
      setClaiming(false);
    }
  };

  const handleWithdraw = async () => {
    if (!address) {
      setStatus('Connect your wallet to withdraw.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }
    if (!instance) {
      setStatus('Relayer is still loading.');
      return;
    }
    const stakeHandle = (await refetchEncryptedStake?.())?.data ?? encryptedStake;
    if (!stakeHandle || stakeHandle === ethers.ZeroHash) {
      setStatus('No stake to withdraw.');
      return;
    }

    try {
      setWithdrawing(true);
      setStatus('Requesting encrypted withdrawal...');
      const vault = new Contract(SECRET_RATE_ADDRESS, SECRET_RATE_ABI, signer);
      const requestTx = await vault.requestWithdraw();
      await requestTx.wait();

      setStatus('Decrypting stake proof...');
      const publicResult = await instance.publicDecrypt([stakeHandle]);
      const clearValues = publicResult.clearValues as Record<string, string | number | bigint>;
      const clearAmountRaw = clearValues[stakeHandle as string];
      const clearAmount = BigInt(clearAmountRaw as string | number | bigint);

      setStatus('Finalizing withdrawal on-chain...');
      const finalizeTx = await vault.finalizeWithdraw(
        stakeHandle,
        clearAmount,
        publicResult.decryptionProof
      );
      await finalizeTx.wait();
      setStatus('Withdrawal complete.');
      setDecryptedStake('');
      await refresh();
    } catch (err) {
      setStatus(`Withdraw failed: ${(err as Error).message}`);
    } finally {
      setWithdrawing(false);
    }
  };

  const decryptStakeAmount = async () => {
    if (!instance || !address || !encryptedStake || encryptedStake === ethers.ZeroHash) {
      setStatus('No encrypted stake to decrypt.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }

    try {
      setDecryptingStake(true);
      const keypair = instance.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const contractAddresses = [SECRET_RATE_ADDRESS];
      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimestamp,
        durationDays
      );

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [
          {
            handle: encryptedStake,
            contractAddress: SECRET_RATE_ADDRESS,
          },
        ],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimestamp,
        durationDays
      );

      const clearValue = result[encryptedStake as string];
      setDecryptedStake(ethers.formatEther(clearValue.toString()));
    } catch (err) {
      setStatus(`Decrypt failed: ${(err as Error).message}`);
    } finally {
      setDecryptingStake(false);
    }
  };

  const decryptCusdtBalance = async () => {
    if (!instance || !address || !cusdtBalance || cusdtBalance === ethers.ZeroHash) {
      setStatus('No encrypted cUSDT to decrypt.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setStatus('No signer available.');
      return;
    }

    try {
      setDecryptingCusdt(true);
      const keypair = instance.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const contractAddresses = [CUSDT_ADDRESS];
      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimestamp,
        durationDays
      );

      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [
          {
            handle: cusdtBalance,
            contractAddress: CUSDT_ADDRESS,
          },
        ],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimestamp,
        durationDays
      );

      const clearValue = result[cusdtBalance as string];
      setDecryptedCusdt(ethers.formatUnits(clearValue.toString(), 6));
    } catch (err) {
      setStatus(`Decrypt failed: ${(err as Error).message}`);
    } finally {
      setDecryptingCusdt(false);
    }
  };

  const hasStake = plainStake > 0n;
  const hasPendingWithdraw = withdrawalHandle && withdrawalHandle !== ethers.ZeroHash;

  return (
    <div className="staking-shell">
      <div className="grid">
        <div className="card hero-card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Private balance</p>
              <h2>Encrypted stake</h2>
            </div>
            <span className="handle-chip">
              {encryptedStake ? `${encryptedStake.slice(0, 8)}...${encryptedStake.slice(-6)}` : '—'}
            </span>
          </div>
          <p className="metric">{hasStake ? `${readableStake} ETH` : '0 ETH'}</p>
          <div className="card-actions">
            <button className="ghost-btn" onClick={decryptStakeAmount} disabled={decryptingStake || zamaLoading}>
              {decryptingStake ? 'Decrypting...' : 'Decrypt stake'}
            </button>
            {decryptedStake && <span className="plaintext-value">{decryptedStake} ETH</span>}
          </div>
        </div>

        <div className="card stat-card">
          <p className="eyebrow">Accrued yield</p>
          <p className="metric">{readableAccrued} cUSDT</p>
          <small className="muted">Stored rewards waiting to be claimed.</small>
        </div>

        <div className="card stat-card">
          <p className="eyebrow">Live pending</p>
          <p className="metric">{readablePending} cUSDT</p>
          <small className="muted">Streaming at 1 cUSDT / ETH / day.</small>
        </div>

        <div className="card stat-card">
          <p className="eyebrow">Encrypted cUSDT</p>
          <p className="handle-chip small">
            {cusdtBalance ? `${cusdtBalance.slice(0, 8)}...${cusdtBalance.slice(-6)}` : '—'}
          </p>
          <div className="card-actions">
            <button className="ghost-btn" onClick={decryptCusdtBalance} disabled={decryptingCusdt || zamaLoading}>
              {decryptingCusdt ? 'Decrypting...' : 'Decrypt balance'}
            </button>
            {decryptedCusdt && <span className="plaintext-value">{decryptedCusdt} cUSDT</span>}
          </div>
        </div>
      </div>

      <div className="actions">
        <div className="card action-card">
          <div className="action-head">
            <div>
              <p className="eyebrow">Stake</p>
              <h3>Deposit ETH</h3>
            </div>
            <span className="chip subtle">FHE write</span>
          </div>
          <p className="muted">
            Stake ETH to start earning cUSDT. Principal stays encrypted; only you can reveal it.
          </p>
          <div className="input-row">
            <label htmlFor="stakeAmount">Amount (ETH)</label>
            <div className="input-with-btn">
              <input
                id="stakeAmount"
                type="number"
                min="0"
                step="0.01"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />
              <button onClick={handleStake} disabled={staking || zamaLoading}>
                {staking ? 'Staking...' : 'Stake'}
              </button>
            </div>
          </div>
        </div>

        <div className="card action-card">
          <div className="action-head">
            <div>
              <p className="eyebrow">Rewards</p>
              <h3>Claim cUSDT</h3>
            </div>
            <span className="chip accent">Yield</span>
          </div>
          <p className="muted">Harvest accrued rewards instantly as encrypted cUSDT.</p>
          <button className="primary-btn" onClick={handleClaim} disabled={claiming || zamaLoading}>
            {claiming ? 'Claiming...' : 'Claim now'}
          </button>
        </div>

        <div className="card action-card">
          <div className="action-head">
            <div>
              <p className="eyebrow">Exit</p>
              <h3>Withdraw stake</h3>
            </div>
            <span className="chip warning">{hasPendingWithdraw ? 'Awaiting proof' : 'Two step'}</span>
          </div>
          <p className="muted">
            We decrypt your encrypted principal via the relayer, then release ETH on-chain once the proof is verified.
          </p>
          <button className="danger-btn" onClick={handleWithdraw} disabled={withdrawing || zamaLoading || !hasStake}>
            {withdrawing ? 'Processing...' : 'Request & finalize'}
          </button>
          {withdrawalHandle && withdrawalHandle !== ethers.ZeroHash ? (
            <p className="muted handle-note">
              Pending handle: {withdrawalHandle.slice(0, 10)}...{withdrawalHandle.slice(-6)}
            </p>
          ) : null}
        </div>
      </div>

      {status && <div className="status-banner">{status}</div>}
    </div>
  );
}
