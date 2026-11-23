# Protocol Configuration View

The `get_config` method exposes a stable, read-only snapshot of active protocol parameters for integrators.

## Usage

```typescript
const config = await contract.get_config();
// config.min_interval_secs: minimum payment interval (86400 = 1 day)
// config.max_interval_secs: maximum payment interval (31536000 = 365 days)
// config.max_payment_amount: maximum per-payment amount in base units (1e18)
// config.schema_version: version integer for breaking-change detection
// config.min_ttl_ledgers: minimum storage TTL extension
// config.max_ttl_ledgers: maximum storage TTL extension
```

## Guarantees

- **No authorization required**: any caller can invoke `get_config`.
- **Read-only**: calling `get_config` does not modify any storage entry.
- **Active values**: the returned parameters are what the contract currently enforces—not proposals or legacy values.
- **No private state**: admin keys, fee recipients, upgrade authority, and any other administrative data are excluded.
- **Stable shape**: the `ProtocolConfig` struct fields are versioned; use `schema_version` to detect future breaking changes.

## Example: pre-flight validation

```typescript
const cfg = await contract.get_config();

if (interval < cfg.min_interval_secs || interval > cfg.max_interval_secs) {
  throw new Error(`Interval must be between ${cfg.min_interval_secs} and ${cfg.max_interval_secs} seconds`);
}
if (amount > cfg.max_payment_amount) {
  throw new Error(`Amount ${amount} exceeds protocol maximum ${cfg.max_payment_amount}`);
}
```
