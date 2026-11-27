import React from "react";
import { render, screen } from "@testing-library/react";
import { SubscriptionFormInputs } from "@/components/SubscriptionFormInputs";

jest.mock("@/components/HelpTooltip", () => ({ HelpTooltip: () => null }));
jest.mock("@/components/TokenCombobox", () => ({
  TokenCombobox: ({ id }: { id: string }) => <input id={id} />,
}));

const baseProps = {
  merchantAddress: "",
  tokenAddress: "",
  amount: "",
  interval: "",
  fieldErrors: {},
  isDisabled: false,
  onMerchantChange: jest.fn(),
  onTokenChange: jest.fn(),
  onAmountChange: jest.fn(),
  onIntervalChange: jest.fn(),
};

describe("SubscriptionFormInputs error summary", () => {
  it("links announced errors to their fields and retains inline descriptions", () => {
    render(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{
          merchantAddress: "Enter a valid merchant address.",
          amount: "Amount must be greater than zero.",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("There is a problem");
    expect(screen.getByRole("link", { name: /merchant address/i })).toHaveAttribute(
      "href",
      "#merchantAddress",
    );
    expect(screen.getByRole("link", { name: /amount/i })).toHaveAttribute(
      "href",
      "#amount",
    );
    expect(screen.getByLabelText(/merchant address/i)).toHaveAttribute(
      "aria-describedby",
      "help-merchant err-merchant",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("focuses the summary only when the owning form requests it", () => {
    const { rerender } = render(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{ amount: "Amount must be greater than zero." }}
      />,
    );
    expect(screen.getByRole("alert")).not.toHaveFocus();

    rerender(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{ amount: "Amount must be greater than zero." }}
        focusErrorSummaryRequest={1}
      />,
    );
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("synchronizes as errors are corrected and disappears when all are resolved", () => {
    const { rerender } = render(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{
          merchantAddress: "Enter a valid merchant address.",
          tokenAddress: "Enter a valid token address.",
          amount: "Amount must be greater than zero.",
          interval: "Select a valid interval.",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveAttribute("tabIndex", "-1");
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: /token contract address/i })).toHaveAttribute(
      "href",
      "#tokenAddress",
    );
    expect(screen.getByRole("link", { name: /interval/i })).toHaveAttribute(
      "href",
      "#interval",
    );

    // Correct one error
    rerender(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{
          tokenAddress: "Enter a valid token address.",
          amount: "Amount must be greater than zero.",
        }}
      />,
    );

    expect(screen.queryByRole("link", { name: /merchant address/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);

    // Clear all errors
    rerender(<SubscriptionFormInputs {...baseProps} fieldErrors={{}} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not render or throw when focus is requested with no errors", () => {
    render(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{}}
        focusErrorSummaryRequest={1}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
