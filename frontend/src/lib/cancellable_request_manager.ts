/**
 * cancellable_request_manager.ts
 *
 * Manages request identity, AbortController lifecycle, and wallet-context
 * bound state isolation for dashboard, history, and merchant queries (#1575).
 */

export interface WalletContext {
  accountId: string;
  networkId: string;
}

export interface ActiveRequestSession {
  requestId: number;
  context: WalletContext;
  controller: AbortController;
}

export class WalletContextRequestManager {
  private activeSession: ActiveRequestSession | null = null;
  private nextRequestId = 1;

  /**
   * Initiates a new cancellable request session bound to the current wallet context.
   * Any prior in-flight request is immediately aborted and discarded.
   */
  public beginRequest(context: WalletContext): ActiveRequestSession {
    if (this.activeSession) {
      this.activeSession.controller.abort();
    }

    const session: ActiveRequestSession = {
      requestId: this.nextRequestId++,
      context: { ...context },
      controller: new AbortController(),
    };

    this.activeSession = session;
    return session;
  }

  /**
   * Evaluates whether an incoming asynchronous response is valid to apply to UI state.
   * Returns false if the request was superseded, context changed, or aborted.
   */
  public isResponseValid(session: ActiveRequestSession, currentContext: WalletContext): boolean {
    if (!this.activeSession) return false;
    if (this.activeSession.requestId !== session.requestId) return false;
    if (session.controller.signal.aborted) return false;

    const matchesAccount = this.activeSession.context.accountId === currentContext.accountId;
    const matchesNetwork = this.activeSession.context.networkId === currentContext.networkId;

    return matchesAccount && matchesNetwork;
  }

  /**
   * Called when wallet account or network switches.
   * Aborts active requests and purges active session.
   */
  public switchContext(newContext: WalletContext): void {
    if (this.activeSession) {
      this.activeSession.controller.abort();
      this.activeSession = null;
    }
  }

  /**
   * Determines if an error is an intentional cancellation and should be ignored.
   */
  public static isCancellationError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof Error) {
      return error.name === 'AbortError' || error.message.toLowerCase().includes('aborted');
    }
    return false;
  }
}
