# Frontend Environment Configuration

Frontend configuration is read from `frontend/.env.local` and, for Next.js `NEXT_PUBLIC_*` variables, embedded in the browser bundle at build time. Never put a password, private key, seed phrase, admin token, or unrestricted API credential in a `NEXT_PUBLIC_*` variable. Public configuration is visible to every site visitor.

## Configure and run

From the repository root:

```bash
cp frontend/.env.example frontend/.env.local
cd frontend
npm run dev
```

The development server should start at `http://localhost:3000`. The example selects Stellar Testnet; replace its contract-ID placeholder with the public contract address deployed to that network before using contract flows. After changing a value, restart `npm run dev`; production builds must be rebuilt with their final public values.

## Frontend application variables

| Variable | Consumer | Required? | Visibility / secret status | Safe default and example |
|---|---|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | `frontend/src/constants/network.ts`; contract flows and onboarding checks | Required for contract transactions; the UI can load without it | Public contract address; not a secret | Empty string. Example: `NEXT_PUBLIC_CONTRACT_ID=`. Set it to the deployed contract address for the selected network. |
| `NEXT_PUBLIC_RPC_URL` | `frontend/src/constants/network.ts`; Soroban RPC reads, simulation, and submission | Optional if the default Testnet endpoint is suitable | Public endpoint; any embedded provider key is exposed | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `frontend/src/constants/network.ts`; transaction construction and network display | Optional if using the Testnet default | Public network identifier; not a secret | `Test SDF Network ; September 2015`. Mainnet: `Public Global Stellar Network ; September 2015`. It must match the wallet and contract network. |
| `NEXT_PUBLIC_API_BASE_URL` | `frontend/src/app/admin/page.tsx` for admin API calls; `frontend/src/hooks/useAnalytics.ts` for consent and analytics events | Optional; needed when those backend features are used outside their local defaults | Public backend origin; not a secret | Admin falls back to `http://localhost:4000`; analytics falls back to `http://localhost:3001`. Configure the appropriate backend origin for deployment. |
| `NEXT_PUBLIC_BACKEND_URL` | `frontend/src/hooks/useAnalyticsData.ts`; merchant analytics data requests | Optional; needed to load analytics from a non-local backend | Public backend origin; not a secret | `http://localhost:3001` |
| `NEXT_PUBLIC_ADMIN_TOKEN` | `frontend/src/app/admin/page.tsx`; initializes the admin token sent in the `X-Admin-Token` request header | Do not configure | **Secret, but unsafe here.** The `NEXT_PUBLIC_` prefix makes the value available in client-side code and the browser bundle. | Unset. The page prompts for an admin token when no value is present. Remove this variable from frontend builds; if a real token was built into a bundle, rotate it. |
| `NEXT_PUBLIC_SENTRY_DSN` | `frontend/src/components/ErrorBoundary.tsx`; optional browser error reporting | Optional | Public DSN identifier, not an authentication secret; restrict the Sentry project and quota | Unset; error reporting to Sentry is skipped. |
| `DEBUG_MODE` | `frontend/src/lib/logger.ts`; enables debug-level console logging when exactly `true` | Optional | Not a credential; avoid enabling in production because logs may include diagnostic context | Unset or any value other than `true`; debug logging stays off. |
| `NEXT_PUBLIC_DEBUG_MODE` | `frontend/src/lib/logger.ts`; browser-build equivalent of `DEBUG_MODE` | Optional | Public setting; not a secret | Unset or any value other than `true`; debug logging stays off. |

The two backend URL variables are intentionally separate: admin requests default to port `4000`, while analytics and merchant analytics default to port `3001`. Set each to the service that implements its endpoints. Do not copy a credential-bearing URL into either variable.

`NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_RPC_URL`, and `NEXT_PUBLIC_NETWORK_PASSPHRASE` also have build arguments/defaults in `frontend/Dockerfile`. Set the intended values when building the image; changing the container environment after a Next.js build does not change values already embedded in the frontend bundle.

## Tool-managed variables

These are consumed by Next.js or the browser test runner rather than being application settings to add to `.env.local`:

| Variable | Consumer | Required? | Default / effect |
|---|---|---|---|
| `NODE_ENV` | Next.js, `frontend/next.config.mjs`, and `frontend/src/components/ErrorBoundary.tsx` | Managed by Next.js | `development` for `npm run dev`; `production` for builds and `npm run start`. Development-only error details are hidden in production. |
| `CI` | `frontend/playwright.config.ts` | No | Unset locally. When set, Playwright uses CI retries/workers and does not reuse an existing server. |

## Troubleshooting

| Symptom | Check and recovery | Expected result |
|---|---|---|
| Contract form reports missing configuration | Set `NEXT_PUBLIC_CONTRACT_ID` in `frontend/.env.local` to the public contract address for the selected network, then restart the dev server or rebuild. | Contract flows can construct transactions for that contract. |
| Wallet reports a network mismatch or RPC requests fail | Compare `NEXT_PUBLIC_NETWORK_PASSPHRASE` and `NEXT_PUBLIC_RPC_URL` with the deployed contract and wallet network. Use the Testnet defaults above for Testnet deployments. | The app, RPC endpoint, contract, and wallet all target the same network. |
| Admin or analytics requests fail against `localhost` after deployment | Set `NEXT_PUBLIC_API_BASE_URL` and/or `NEXT_PUBLIC_BACKEND_URL` to the correct reachable backend origin, then rebuild. Check browser network errors and backend availability; do not paste response bodies containing tokens into logs or support requests. | Requests go to the intended service and no longer target the visitor's own machine. |
| A public variable appears unchanged after editing | Restart `npm run dev`, or rebuild and redeploy the frontend image with the value supplied at build time. | The newly built client bundle uses the updated value. |
| An admin token or provider credential was exposed | Remove it from frontend configuration and deployment build arguments, rotate/revoke it at its issuer, and move privileged credentials to a server-side component. | The old credential is invalidated; no replacement secret is shipped to the browser. |

Do not commit `frontend/.env.local`. The checked-in `frontend/.env.example` contains credential-free Testnet defaults and is the starting point for local setup.