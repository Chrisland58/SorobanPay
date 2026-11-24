import type { Meta, StoryObj } from '@storybook/react';
import { NetworkMismatchBanner } from '../components/NetworkMismatchBanner';

const meta: Meta<typeof NetworkMismatchBanner> = {
  title: 'Components/NetworkMismatchBanner',
  component: NetworkMismatchBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof NetworkMismatchBanner>;

export const FreighterOnMainnetAppOnTestnet: Story = {
  args: {
    isMismatch: true,
    freighterNetwork: 'Mainnet',
    appNetwork: 'Testnet',
  },
};

export const FreighterOnTestnetAppOnMainnet: Story = {
  args: {
    isMismatch: true,
    freighterNetwork: 'Testnet',
    appNetwork: 'Mainnet',
  },
};

export const NetworksAligned: Story = {
  args: {
    isMismatch: false,
    freighterNetwork: 'Testnet',
    appNetwork: 'Testnet',
  },
};

export const DarkMode: Story = {
  args: {
    isMismatch: true,
    freighterNetwork: 'Mainnet',
    appNetwork: 'Testnet',
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
