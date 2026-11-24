import type { Meta, StoryObj } from '@storybook/react';
import {
  TransactionProgressIndicator,
  type TransactionProgressStep,
} from '../components/TransactionProgressIndicator';

const defaultSteps: TransactionProgressStep[] = [
  { id: 'build', label: 'Building transaction', status: 'completed' },
  { id: 'sign', label: 'Signing with Freighter', status: 'in-progress' },
  { id: 'submit', label: 'Submitting to network', status: 'pending' },
  { id: 'confirm', label: 'Waiting for confirmation', status: 'pending' },
];

const meta: Meta<typeof TransactionProgressIndicator> = {
  title: 'Components/StepIndicator',
  component: TransactionProgressIndicator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof TransactionProgressIndicator>;

export const Step1Active: Story = {
  args: {
    title: 'Creating Subscription',
    description: 'Preparing contract invocation parameters...',
    currentStepIndex: 0,
    steps: [
      { id: 'build', label: 'Building transaction', status: 'in-progress' },
      { id: 'sign', label: 'Signing with Freighter', status: 'pending' },
      { id: 'submit', label: 'Submitting to network', status: 'pending' },
      { id: 'confirm', label: 'Waiting for confirmation', status: 'pending' },
    ],
  },
};

export const Step2Active: Story = {
  args: {
    title: 'Creating Subscription',
    description: 'Please approve the transaction prompt in your Freighter wallet.',
    currentStepIndex: 1,
    steps: defaultSteps,
  },
};

export const Step3Active: Story = {
  args: {
    title: 'Creating Subscription',
    description: 'Broadcasting signed transaction to Soroban RPC...',
    currentStepIndex: 2,
    steps: [
      { id: 'build', label: 'Building transaction', status: 'completed' },
      { id: 'sign', label: 'Signing with Freighter', status: 'completed' },
      { id: 'submit', label: 'Submitting to network', status: 'in-progress' },
      { id: 'confirm', label: 'Waiting for confirmation', status: 'pending' },
    ],
  },
};

export const FailedStep: Story = {
  args: {
    title: 'Transaction Failed',
    description: 'An error occurred while confirming on-chain.',
    currentStepIndex: 2,
    isFailed: true,
    errorMessage: 'Transaction reverted with code: HostError(Error(Contract, #1))',
    steps: [
      { id: 'build', label: 'Building transaction', status: 'completed' },
      { id: 'sign', label: 'Signing with Freighter', status: 'completed' },
      { id: 'submit', label: 'Submitting to network', status: 'error', error: 'Transaction simulation failed.' },
      { id: 'confirm', label: 'Waiting for confirmation', status: 'pending' },
    ],
  },
};

export const DarkMode: Story = {
  args: {
    title: 'Creating Subscription',
    description: 'Please approve the transaction in Freighter.',
    currentStepIndex: 1,
    steps: defaultSteps,
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
