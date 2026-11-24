import type { Meta, StoryObj } from '@storybook/react';
import { CopyButton } from '../components/CopyButton';

const meta: Meta<typeof CopyButton> = {
  title: 'Components/CopyButton',
  component: CopyButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    text: { control: 'text', description: 'Text to copy to clipboard' },
    label: { control: 'text', description: 'Button label' },
  },
};

export default meta;
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {
  args: {
    text: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
    label: 'Copy address',
  },
};

export const LongText: Story = {
  args: {
    text: 'ca729ff5e9c013b53c1555df089602adbe482e1858a74bbf3358df8b1a5bd8319fbcbe833a69634e3f32e60938fc286bcad3efce6a6a978f895fb823057e0569',
    label: 'Copy transaction hash',
  },
};

export const DarkMode: Story = {
  args: {
    text: 'CCONTRACTID1234567890STEL41TOKENCONTRACTADDRESSEXAMPLE',
    label: 'Copy contract ID',
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
