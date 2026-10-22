import { render, screen } from '@testing-library/react';
import { NetworkMismatchBanner } from './NetworkMismatchBanner';

jest.mock('@stellar/freighter-api', () => ({
  getNetwork: jest.fn(),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
  }),
}));

describe('NetworkMismatchBanner', () => {
  it('does not render when there is no mismatch', () => {
    const { container } = render(
      <NetworkMismatchBanner isMismatch={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders prominent warning when Freighter is on Mainnet and app is on Testnet', () => {
    render(
      <NetworkMismatchBanner
        isMismatch={true}
        freighterNetwork="Mainnet"
        appNetwork="Testnet"
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Network Mismatch Detected')).toBeInTheDocument();
    expect(
      screen.getByText(/Freighter is on/i)
    ).toHaveTextContent('Freighter is on Mainnet but this app is configured for Testnet. Switch Freighter to Testnet to proceed.');
  });

  it('renders prominent warning when Freighter is on Testnet and app is on Mainnet', () => {
    render(
      <NetworkMismatchBanner
        isMismatch={true}
        freighterNetwork="Testnet"
        appNetwork="Mainnet"
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(/Freighter is on/i)
    ).toHaveTextContent('Freighter is on Testnet but this app is configured for Mainnet. Switch Freighter to Mainnet to proceed.');
  });
});
