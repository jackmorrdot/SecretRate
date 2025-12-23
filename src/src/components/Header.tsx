import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="header-title-block">
          <span className="header-pill">FHE secured</span>
          <h1 className="header-title">SecretRate</h1>
          <p className="header-subtitle">
            Stake ETH privately, stream cUSDT rewards, and decrypt balances only when you want to.
          </p>
        </div>
        <div className="header-actions">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
