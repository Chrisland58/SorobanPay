import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NetworkStatusIndicator } from './NetworkStatusIndicator';

const mockCheckNetwork = jest.fn().mockResolvedValue(undefined);

jest.mock('@/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: () => ({
    isMismatch: false,
    freighterNetwork: null,
    appNetwork: 'Testnet',
    expectedPassphrase: 'Test SDF Network ; September 2015',
    actualPassphrase: null,
    checkNetwork: mockCheckNetwork,
  }),
}));

jest.mock('@/lib/runtime_config', () => ({
  getNetworkInfo: () => ({
    name: 'Testnet',
    isProduction: false,
  }),
}));

describe('NetworkStatusIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('renders testnet state when online and on Testnet', () => {
    render(<NetworkStatusIndicator isOnline={true} appNetwork="Testnet" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-network-state', 'testnet');
    expect(screen.getAllByText('Testnet').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders mainnet state when online and on Mainnet', () => {
    render(<NetworkStatusIndicator isOnline={true} appNetwork="Mainnet" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-network-state', 'mainnet');
    expect(screen.getAllByText('Mainnet').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders offline state with Retry action and invokes onRetry', () => {
    const onRetry = jest.fn();
    render(<NetworkStatusIndicator isOnline={false} onRetry={onRetry} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-network-state', 'offline');
    expect(screen.getByText('Offline')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders unsupported state when network is unknown and invokes onRecheck', async () => {
    const onRecheck = jest.fn().mockResolvedValue(undefined);
    render(
      <NetworkStatusIndicator
        isOnline={true}
        appNetwork="CustomNet"
        onRecheck={onRecheck}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-network-state', 'unsupported');
    expect(screen.getByText('Unsupported')).toBeInTheDocument();

    const recheckBtn = screen.getByRole('button', { name: 'Recheck' });
    fireEvent.click(recheckBtn);
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1));
  });

  it('renders wallet-mismatch state with direct recovery action', async () => {
    const onRecheck = jest.fn().mockResolvedValue(undefined);
    render(
      <NetworkStatusIndicator
        isOnline={true}
        isMismatch={true}
        freighterNetwork="Mainnet"
        appNetwork="Testnet"
        onRecheck={onRecheck}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-network-state', 'wallet-mismatch');
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
    expect(screen.getByText('Mismatch: Mainnet ≠ Testnet')).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: 'Switch to Testnet' });
    fireEvent.click(switchBtn);
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1));
  });

  it('prioritizes offline over unsupported and wallet-mismatch', () => {
    render(
      <NetworkStatusIndicator
        isOnline={false}
        isUnsupported={true}
        isMismatch={true}
        appNetwork="CustomNet"
      />
    );

    expect(screen.getByRole('status')).toHaveAttribute('data-network-state', 'offline');
  });

  it('transitions to offline and back to online on window events', () => {
    render(<NetworkStatusIndicator appNetwork="Testnet" />);

    expect(screen.getByRole('status')).toHaveAttribute('data-network-state', 'testnet');

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-network-state', 'offline');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-network-state', 'testnet');
  });

  it('re-enables recovery button if onRecheck rejects', async () => {
    const onRecheck = jest.fn().mockRejectedValue(new Error('Network error'));
    render(
      <NetworkStatusIndicator
        isOnline={true}
        isMismatch={true}
        freighterNetwork="Mainnet"
        appNetwork="Testnet"
        onRecheck={onRecheck}
      />
    );

    const btn = screen.getByRole('button', { name: 'Switch to Testnet' });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
