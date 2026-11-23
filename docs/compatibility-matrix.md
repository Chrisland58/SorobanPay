# SorobanPay Version Compatibility Matrix & End-of-Support Policy

This document serves as the **authoritative compatibility reference** for integrators, node operators, and frontend developers deploying SorobanPay. It specifies the validated combinations of **Backend API versions**, **Contract Storage Schema versions**, **Contract Semver**, and **Frontend releases**, along with breaking change notes, minimum compatible versions, and the End-of-Support (EOS) lifecycle policy.

---

## 1. Authoritative Compatibility Matrix

| Backend API | Contract Schema (`STORAGE_VERSION`) | Contract Semver | Frontend Release | `@stellar/stellar-sdk` | Minimum Node.js | Status | Authoritative Git Tag / Artifact Digest |
|---|---|---|---|---|---|---|---|
| **v1** | **1** | `1.0.0` | `1.0.0` | `11.x` | `>=18.0.0 <21.0.0` | **Deprecated** (Sunset: 2026-12-31) | Tag: [`v1.0.0`](https://github.com/Chrisland58/SorobanPay/releases/tag/v1.0.0)<br>`sha256:7a4a92349f6d107b0832ebed92d67b1c17849d70` |
| **v1** | **2** | `1.1.0` | `1.1.0` | `11.x` | `>=18.0.0 <21.0.0` | **Active** (Recommended for v1) | Tag: [`v1.1.0`](https://github.com/Chrisland58/SorobanPay/releases/tag/v1.1.0)<br>`sha256:5f4020c9a3b15a45802d2b1e484537f8574e6d3a` |
| **v2** | **2** | `1.1.0` | `1.2.0` | `12.x` | `>=20.0.0` | **Active** (Current production) | Tag: [`v1.2.0`](https://github.com/Chrisland58/SorobanPay/releases/tag/v1.2.0)<br>`sha256:9dec89a1c2b3e4f5a6b7c8d9e0f1a2b3c4d5e6f7` |

---

## 2. Minimum Compatible Versions

For existing deployments, below are the minimum component versions required to operate without failure:

| Target Component | Minimum Backend API | Minimum Contract Schema | Minimum Frontend | Minimum Stellar SDK |
|---|---|---|---|---|
| **Contract Schema 1** | `v1` | `1` | `1.0.0` | `11.0.0` |
| **Contract Schema 2** | `v1` | `2` | `1.0.0` | `11.2.0` |
| **Backend API v2** | `v2` | `2` | `1.2.0` | `12.0.0` |

---

## 3. Breaking Change Notes by Version Boundary

### 3.1 Contract Schema 1 → Schema 2
- **On-chain layout changes:** `SubscriptionData` gains `grace_period: Option<u64>`, `paused_until: Option<u64>`, and `overdue_since: Option<u64>`.
- **Migration requirement:** Existing contracts deployed under schema 1 must execute `migrate(admin)` to update instance storage schema to version 2.
- **Client impact:** Clients reading contract storage directly via Soroban RPC must account for optional fields in `SubscriptionData` XDR serialization.

### 3.2 Backend API v1 → API v2
- **Data format standardization:** All date-time responses in API v2 are normalized to ISO-8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- **Webhook security header upgrade:** Webhook signatures require HMAC-SHA256 headers (`X-SorobanPay-Signature-256`) or Ed25519 payload signatures.
- **Deprecation headers:** Calls to API v1 include RFC 8594 headers (`Deprecation: true`, `Sunset: Sat, 31 Dec 2026 23:59:59 GMT`, `Link: <https://api.sorobanpay.com/v2>; rel="successor-version"`).

### 3.3 Frontend 1.0.0 → 1.2.0
- **Stellar SDK upgrade:** Upgrades `@stellar/stellar-sdk` from `11.x` to `12.x`.
- **Node runtime:** Frontend build and SSR now require Node.js 20+ LTS.

---

## 4. End-of-Support (EOS) and Deprecation Policy

SorobanPay adheres to a predictable deprecation and retirement lifecycle to ensure operational stability for merchants and integrators:

### 4.1 Support Stages
1. **Active**: The version is actively maintained, receives bug fixes, performance optimizations, and security patches.
2. **Deprecated**: The version is superseded by a newer release. It continues to operate and receives critical security patches only. Deprecation notice is published at least **90 days** prior to sunset.
3. **End-of-Support (Sunset)**: The version is retired. Backend endpoints may return HTTP `410 Gone`, and contract integrations are no longer tested or supported.

### 4.2 Lifecycle Policy Rules
- **Active Support Window**: Every major version receives active support for a minimum of **12 months** from general availability.
- **Deprecation Notice Window**: Integrators are given a minimum of **90 calendar days** notification prior to any endpoint or contract interface sunset.
- **Security Patch Grace Period**: Critical security vulnerabilities (CVE high/critical) are backported to deprecated releases for up to **30 calendar days** following initial deprecation.

---

## 5. Maintenance Ownership & Release Update Procedure

### 5.1 Maintenance Owner
- **Primary Owner:** Core Integrations Team (`@sorobanpay/integrations-core`)
- **Contact:** `integrations-team@sorobanpay.org`
- **Verification Cadence:** Audited on every release tag and during quarterly dependency reviews.

### 5.2 Release Update Step (Preventing Stale Entries)
To prevent the matrix from becoming stale, updating this matrix is an **obligatory checklist step** in `docs/release-process.md` for every release:

1. **When bumping Backend API (`MAJOR` or `MINOR`):**
   - Add new row in `docs/compatibility-matrix.md`.
   - Update `COMPATIBILITY_MATRIX` constant in `backend/src/services/compatibilityService.ts`.
   - If deprecating an older API version, set its `sunsetDate` and `deprecationDate`.

2. **When bumping Contract Schema (`STORAGE_VERSION`):**
   - Record the new schema version, compiled contract semver, and WASM artifact SHA-256 digest.
   - Specify required migration commands (`migrate(admin)`).

3. **When releasing Frontend:**
   - Update `minimumCompatible` and frontend release versions across all corresponding rows.

4. **Automated Verification:**
   - Run the automated compatibility suite (`backend/tests/compatibilityService.test.ts`) to verify that the matrix and deprecation assertions pass.
