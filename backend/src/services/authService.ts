/**
 * authService.ts
 *
 * SEP-10 challenge / response flow backed by Redis.
 *
 * Why Redis instead of an in-process Map?
 * ─────────────────────────────────────────
 * When the backend runs as multiple pods (horizontal scaling or a rolling
 * deploy), each pod has its own memory. A challenge created on pod A cannot
 * be verified on pod B, causing ~50 % of auth attempts to fail.  Storing
 * challenges in Redis gives every pod a single, consistent view with
 * automatic TTL expiry — no extra cleanup jobs needed.
 *
 * Storage layout
 * ──────────────
 * Key:   auth:challenge:<publicKey>
 * Value: JSON-serialised AuthChallenge
 * TTL:   CHALLENGE_TTL_SECONDS (default 300 s / 5 min)
 *
 * Atomicity
 * ─────────
 * Verification uses a Lua script to GET + DEL in a single round-trip so a
 * challenge cannot be replayed even under concurrent requests.
 */

import { randomBytes } from 'crypto';
import { Keypair, Transaction, Networks } from '@stellar/stellar-sdk';
import redis from '../lib/redis';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes — matches SEP-10 recommendation
const KEY_PREFIX = 'auth:challenge:';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthChallenge {
  /** Stellar public key (G…) of the party being authenticated. */
  publicKey: string;
  /** Random nonce embedded in the challenge. */
  nonce: string;
  /** Unix timestamp (ms) when the challenge was issued. */
  issuedAt: number;
}

export interface ChallengeResult {
  challenge: AuthChallenge;
  /** The nonce the client must sign to prove key ownership. */
  nonce: string;
}

export interface VerifyResult {
  success: boolean;
  publicKey?: string;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function redisKey(publicKey: string): string {
  return `${KEY_PREFIX}${publicKey}`;
}

/**
 * Atomic GET + DEL via Lua script.
 * Returns the stored value and deletes it in one round-trip, preventing
 * replay attacks even under concurrent verification requests.
 */
const GET_DEL_SCRIPT = `
local val = redis.call('GET', KEYS[1])
if val then
  redis.call('DEL', KEYS[1])
end
return val
`;

// ─── AuthService ─────────────────────────────────────────────────────────────

export class AuthService {
  private readonly networkPassphrase: string;

  constructor(networkPassphrase?: string) {
    this.networkPassphrase =
      networkPassphrase ??
      process.env.NETWORK_PASSPHRASE ??
      Networks.TESTNET;
  }

  /**
   * Issue a new challenge for the given public key.
   *
   * Generates a random nonce, persists it in Redis with a TTL, and returns
   * the challenge object.  Any previous challenge for the same public key is
   * overwritten (last-write-wins — safe because challenges are single-use).
   */
  async createChallenge(publicKey: string): Promise<ChallengeResult> {
    // Validate the public key is a well-formed Stellar address.
    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      throw new Error(`Invalid Stellar public key: ${publicKey}`);
    }

    const nonce = randomBytes(32).toString('hex');
    const challenge: AuthChallenge = {
      publicKey,
      nonce,
      issuedAt: Date.now(),
    };

    await redis.set(
      redisKey(publicKey),
      JSON.stringify(challenge),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );

    return { challenge, nonce };
  }

  /**
   * Verify a signed challenge.
   *
   * The client signs a Stellar transaction whose memo contains the nonce
   * issued in createChallenge.  This method:
   *   1. Atomically retrieves and deletes the challenge from Redis (replay
   *      protection — even concurrent requests cannot reuse the same challenge).
   *   2. Decodes the signed transaction XDR.
   *   3. Checks that the transaction memo matches the stored nonce.
   *   4. Confirms the transaction carries a valid signature from the claimed
   *      public key.
   *
   * @param publicKey  Stellar public key the client claims to own.
   * @param signedXdr  Base64-encoded signed Stellar transaction XDR.
   */
  async verifyChallenge(
    publicKey: string,
    signedXdr: string,
  ): Promise<VerifyResult> {
    // 1. Atomically retrieve + delete from Redis.
    let raw: string | null;
    try {
      raw = (await redis.eval(
        GET_DEL_SCRIPT,
        1,
        redisKey(publicKey),
      )) as string | null;
    } catch (err) {
      console.error('[authService] Redis error during verify:', err);
      return { success: false, error: 'Internal error — please retry' };
    }

    if (!raw) {
      return {
        success: false,
        error: 'No pending challenge for this public key, or challenge expired',
      };
    }

    let stored: AuthChallenge;
    try {
      stored = JSON.parse(raw) as AuthChallenge;
    } catch {
      return { success: false, error: 'Corrupted challenge data' };
    }

    // 2. Decode the signed transaction.
    let tx: Transaction;
    try {
      tx = new Transaction(signedXdr, this.networkPassphrase);
    } catch (err) {
      return { success: false, error: `Invalid transaction XDR: ${(err as Error).message}` };
    }

    // 3. Verify memo matches the stored nonce.
    const memoValue =
      tx.memo.type === 'text' ? tx.memo.value : null;

    if (memoValue !== stored.nonce) {
      return {
        success: false,
        error: 'Transaction memo does not match the issued nonce',
      };
    }

    // 4. Verify the transaction carries a valid signature from publicKey.
    const keypair = Keypair.fromPublicKey(publicKey);
    const txHash = tx.hash();

    const hasSig = tx.signatures.some((sig) => {
      try {
        return keypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!hasSig) {
      return {
        success: false,
        error: 'Transaction is not signed by the claimed public key',
      };
    }

    return { success: true, publicKey };
  }

  /**
   * Delete a pending challenge for the given public key without verifying it.
   * Useful for logout / explicit challenge invalidation flows.
   */
  async invalidateChallenge(publicKey: string): Promise<void> {
    await redis.del(redisKey(publicKey));
  }
}

// Default singleton — used by the auth route.
export const authService = new AuthService();
