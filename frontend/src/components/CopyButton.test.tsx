import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('renders with default label and custom text', () => {
    render(<CopyButton text="GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD" />);
    const button = screen.getByRole('button', { name: /copy to clipboard/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Copy');
  });

  it('copies text via Clipboard API and displays visual feedback for 2s', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const user = userEvent.setup();

    render(<CopyButton text="test-tx-hash-1234" label="Copy tx hash" />);
    const button = screen.getByRole('button', { name: /copy tx hash to clipboard/i });
    await user.click(button);

    expect(writeText).toHaveBeenCalledWith('test-tx-hash-1234');
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('falls back to execCommand when Clipboard API fails or is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = jest.fn().mockReturnValue(true);

    render(<CopyButton text="fallback-value" label="Copy address" />);
    const button = screen.getByRole('button', { name: /copy address to clipboard/i });
    fireEvent.click(button);

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('supports keyboard navigation via tab and enter', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const user = userEvent.setup();

    render(<CopyButton text="keyboard-nav" label="Copy" />);
    await user.tab();
    const button = screen.getByRole('button', { name: /copy to clipboard/i });
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(writeText).toHaveBeenCalledWith('keyboard-nav');
  });
});
