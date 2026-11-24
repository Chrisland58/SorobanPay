import type { Meta, StoryObj } from '@storybook/react';
import { SuccessCard } from '../components/SuccessCard';
import { TransactionTimeline } from '../components/TransactionTimeline';

/**
 * SuccessCard is shown immediately after a subscription is created on-chain.
 * It displays the transaction hash, an animated 4-step transaction timeline,
 * a summary of the subscription parameters, and guidance on what happens next.
 *
 * The component uses `role="alert"` so screen readers announce the success
 * message as soon as it appears in the DOM.
 *
 * The timeline (issue #1434):
 *  - Animates 4 steps in sequence with 500 ms delay each
 *  - Shows timestamps for each step
 *  - Links to Stellar Expert on the final step
 *  - Respects `prefers-reduced-motion`
 *  - Print stylesheet formats all steps statically as a receipt
 */
const meta: Meta<typeof SuccessCard> = {
  title: 'Components/SuccessCard',
  component: SuccessCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Post-subscription success confirmation. Shows the transaction hash, ' +
          'an animated transaction journey timeline, subscription summary, and ' +
          'next-steps guidance. Uses `role="alert"` for accessible announcement.',
      },
    },
  },
  argTypes: {
    onReset: { action: 'create another clicked' },
    data: {
      description: 'Subscription data to display in the card',
    },
  },
};

export default meta;
type Story = StoryObj<typeof SuccessCard>;

const sampleTxHash =
  'a3f1b2c4d5e6f7081234567890abcdef1234567890abcdef1234567890abcdef12';

const confirmedAt = new Date(Date.now() - 6000).toISOString();

/**
 * Standard 30-day monthly subscription — the most common case.
 * Watch the 4-step timeline animate in when the story loads.
 */
export const Monthly: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '100',
      interval: '2592000', // 30 days
      confirmedAt,
      networkName: 'Testnet',
    },
  },
};

/**
 * Daily subscription — interval is 1 day (86400 seconds).
 * Tests the singular "day" label (no trailing 's').
 */
export const Daily: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '10',
      interval: '86400', // 1 day
      confirmedAt,
      networkName: 'Testnet',
    },
  },
};

/**
 * Annual subscription — interval is 365 days (31536000 seconds).
 * The maximum interval supported by the contract.
 */
export const Annual: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '1200',
      interval: '31536000', // 365 days
      confirmedAt,
      networkName: 'Testnet',
    },
  },
};

/**
 * Long transaction hash — tests the `break-all` overflow handling on the hash display.
 */
export const LongTxHash: Story = {
  name: 'Long Transaction Hash',
  args: {
    data: {
      txHash:
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '500',
      interval: '2592000',
      confirmedAt,
      networkName: 'Testnet',
    },
  },
};

/**
 * TransactionTimeline in isolation — useful for verifying the animation
 * sequence and reduced-motion behaviour without the full SuccessCard context.
 */
export const TimelineOnly: Story = {
  name: 'Transaction Timeline (isolated)',
  render: () => (
    <div className="bg-gray-950 rounded-xl p-6 w-96">
      <TransactionTimeline
        txHash={sampleTxHash}
        confirmedAt={confirmedAt}
        networkName="Testnet"
      />
    </div>
  ),
};

/**
 * Mainnet variant — Stellar Expert link points to the public network.
 */
export const Mainnet: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '250',
      interval: '2592000',
      confirmedAt,
      networkName: 'Mainnet',
    },
  },
};
