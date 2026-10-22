import type { Meta, StoryObj } from '@storybook/react';
import { SubscriptionFormInputs } from '../components/SubscriptionFormInputs';

const meta: Meta<typeof SubscriptionFormInputs> = {
  title: 'Components/SubscriptionIntervalSelector',
  component: SubscriptionFormInputs,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof SubscriptionFormInputs>;

const baseProps = {
  merchantAddress: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
  tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  amount: '50',
  fieldErrors: {},
  isDisabled: false,
  onMerchantChange: () => {},
  onTokenChange: () => {},
  onAmountChange: () => {},
  onIntervalChange: () => {},
};

export const DailyPreset: Story = {
  args: {
    ...baseProps,
    interval: '86400',
  },
};

export const WeeklyPreset: Story = {
  args: {
    ...baseProps,
    interval: '604800',
  },
};

export const MonthlyPreset: Story = {
  args: {
    ...baseProps,
    interval: '2592000',
  },
};

export const QuarterlyPreset: Story = {
  args: {
    ...baseProps,
    interval: '7776000',
  },
};

export const AnnualPreset: Story = {
  args: {
    ...baseProps,
    interval: '31536000',
  },
};

export const CustomInterval: Story = {
  args: {
    ...baseProps,
    interval: '1234567',
  },
};
