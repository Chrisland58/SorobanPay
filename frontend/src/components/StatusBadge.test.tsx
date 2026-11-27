import { render, screen } from '@testing-library/react';
import { StatusBadge, type StatusVariant } from './StatusBadge';

describe('StatusBadge', () => {
  const variants: { variant: StatusVariant; label: string }[] = [
    { variant: 'success', label: 'Active' },
    { variant: 'error', label: 'Overdue' },
    { variant: 'warning', label: 'Paused' },
    { variant: 'info', label: 'Pending' },
    { variant: 'neutral', label: 'Expired' },
  ];

  it('renders both an icon and text label for every variant (WCAG 1.4.1)', () => {
    const iconPaths = new Set<string>();

    for (const { variant, label } of variants) {
      const { container, unmount } = render(
        <StatusBadge variant={variant}>{label}</StatusBadge>,
      );

      expect(screen.getByText(label)).toBeInTheDocument();

      const svg = container.querySelector('svg[aria-hidden="true"]');
      expect(svg).not.toBeNull();

      const pathData = svg?.querySelector('path')?.getAttribute('d') ?? '';
      expect(pathData.length).toBeGreaterThan(0);
      iconPaths.add(pathData);

      unmount();
    }

    // Every variant uses a distinct icon so states remain distinguishable in grayscale
    expect(iconPaths.size).toBe(variants.length);
  });

  it('applies srLabel to aria-label when provided', () => {
    render(
      <StatusBadge variant="success" srLabel="Payment is due and collectable">
        Due
      </StatusBadge>,
    );

    const badge = screen.getByLabelText('Payment is due and collectable');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Due');
  });

  it('supports inline display mode without pill border', () => {
    const { container } = render(
      <StatusBadge variant="info" display="inline">
        Pending
      </StatusBadge>,
    );

    const el = container.firstElementChild;
    expect(el?.className).not.toContain('rounded-full');
    expect(el?.className).toContain('text-status-info-text');
  });

  it('omits the icon when showIcon is false', () => {
    const { container } = render(
      <StatusBadge variant="neutral" showIcon={false}>
        Expired
      </StatusBadge>,
    );

    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
