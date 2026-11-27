import { render, screen } from "@testing-library/react";
import {
  TransactionAnnouncer,
  type TransactionLifecycleState,
} from "@/components/TransactionAnnouncer";

describe("TransactionAnnouncer", () => {
  it("renders empty live regions in idle state", () => {
    render(<TransactionAnnouncer state="idle" />);

    const status = screen.getByRole("status");
    const alert = screen.getByRole("alert");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toBeEmptyDOMElement();

    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toBeEmptyDOMElement();
  });

  it("announces signing, submitted, and confirmed states politely with next-action guidance", () => {
    const { rerender } = render(<TransactionAnnouncer state="signing" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /awaiting signature.*wallet extension/i,
    );
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();

    rerender(<TransactionAnnouncer state="submitted" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /submitted to the network.*waiting for on-chain confirmation/i,
    );

    rerender(<TransactionAnnouncer state="confirmed" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /confirmed on-chain.*view the receipt or continue/i,
    );
  });

  it("announces failed state assertively with error detail and next action", () => {
    render(
      <TransactionAnnouncer
        state="failed"
        errorMessage="User rejected signature"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /transaction failed.*user rejected signature.*try again/i,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("avoids repeated announcements when re-rendered with the same state during polling", () => {
    const { rerender } = render(<TransactionAnnouncer state="submitted" />);
    const status = screen.getByRole("status");
    const initialText = status.textContent;

    // Simulate polling re-renders with identical state
    rerender(<TransactionAnnouncer state="submitted" />);
    rerender(<TransactionAnnouncer state="submitted" />);

    expect(status.textContent).toBe(initialText);
  });

  it("supports custom nextAction overrides and resets on idle", () => {
    const states: TransactionLifecycleState[] = ["signing", "idle"];
    const { rerender } = render(
      <TransactionAnnouncer
        state={states[0]}
        nextAction="Open Freighter to sign."
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /open freighter to sign/i,
    );

    rerender(<TransactionAnnouncer state={states[1]} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
