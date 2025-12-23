import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'SecretRate',
  projectId: 'b8a6a4a02c0e4c6f9af4c449601aa9df',
  chains: [sepolia],
  ssr: false,
});
