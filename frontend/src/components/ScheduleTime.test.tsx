import { render, screen, fireEvent } from '@testing-library/react';
import { ScheduleTime } from './ScheduleTime';

describe('ScheduleTime', () => {
  it('renders local time with time zone label and allows inspecting canonical UTC and DST details', () => {
    // 2026-03-08 07:00:00 UTC -> 03:00 AM EDT in America/New_York
    render(
      <ScheduleTime
        timestamp="2026-03-08T07:00:00.000Z"
        timeZone="America/New_York"
      />
    );

    const timeEl = screen.getByText(/03:00 AM EDT/i);
    expect(timeEl).toHaveAttribute('datetime', '2026-03-08T07:00:00.000Z');

    const toggle = screen.getByRole('button', {
      name: /inspect canonical utc timestamp and time zone details/i,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const region = screen.getByRole('region', { name: /schedule time zone details/i });
    expect(region).toHaveTextContent('2026-03-08 07:00:00 UTC');
    expect(region).toHaveTextContent('America/New_York');
    expect(region).toHaveTextContent(/daylight saving time \(DST\)/i);
  });

  it('renders fallback dash when timestamp is invalid or zero', () => {
    const { rerender } = render(<ScheduleTime timestamp={0} />);
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(<ScheduleTime timestamp={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
