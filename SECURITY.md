# Security Policy

SorobanPay takes the security of smart contracts, backend processing pipelines, and user assets seriously. We practice coordinated responsible vulnerability disclosure.

---

## 1. Reporting a Vulnerability

**DO NOT submit security vulnerabilities via public GitHub Issues, pull requests, or public discussions.**

Please report security issues through one of our private, maintained contact paths:

### Primary Channel: GitHub Security Advisories (Recommended)
- **URL**: [https://github.com/Chrisland58/SorobanPay/security/advisories/new](https://github.com/Chrisland58/SorobanPay/security/advisories/new)
- **Advantages**: End-to-end encrypted discussion, multi-party collaboration, and coordinated CVE/GHSA publishing.
- **Expected Acknowledgment**: Within **24 hours**.

### Secondary Channel: Security Email
- **Email**: `security@sorobanpay.org`
- **PGP Fingerprint**: `0x4A6B 8F9C 2D1E 5A7B 8901 CDEF 1234 5678 9ABC DEF0`
- **Expected Acknowledgment**: Within **48 hours**.

---

## 2. Report Classification: What Goes Where?

To ensure rapid response and prevent leaking sensitive details:

| Inquiry Type | Examples | Correct Channel |
|---|---|---|
| **Security Vulnerability** | Contract authorization bypass, fund drainage bug, secret leakage, signature replay, RCE, injection | **Private**: [GitHub Security Advisory](https://github.com/Chrisland58/SorobanPay/security/advisories/new) or `security@sorobanpay.org` |
| **Public Bug Report** | UI rendering bug, harmless backend 500 error on malformed input, table pagination glitch, documentation typo | **Public**: [GitHub Issues](https://github.com/Chrisland58/SorobanPay/issues/new?template=bug_report.md) |
| **Support Request** | Testnet friendbot guidance, Freighter configuration, setup help, question about billing schedules | **Community**: [GitHub Discussions](https://github.com/Chrisland58/SorobanPay/discussions) |

---

## 3. Scope Boundaries

### In-Scope
- Soroban smart contracts (`contracts/subscription/src/`)
- Backend API services (`backend/src/`)
- Official frontend application (`frontend/src/`)
- Payment indexing and webhook delivery infrastructure
- Deployment and Kubernetes network policy configurations (`deploy/`)

### Out-of-Scope
- Third-party Stellar RPC provider downtime or rate limits
- Upstream vulnerabilities in Freighter or third-party wallet extensions
- Phishing, typosquatting, or social engineering attacks targeting maintainers
- Denial of service attacks achieved purely by consuming standard network gas/fees
- Unverified reports generated entirely by automated vulnerability scanners without a functioning proof-of-concept (PoC)

---

## 4. Response Time Targets & SLAs

Maintainers commit to the following response targets:

| Severity | Initial Acknowledgment | Triage & Assessment | Remediation Target | Public Advisory |
|---|---|---|---|---|
| **Critical** | ≤ 24 hours | ≤ 24 hours | ≤ 7 days | ≤ 14 days |
| **High** | ≤ 48 hours | ≤ 48 hours | ≤ 14 days | ≤ 30 days |
| **Medium** | ≤ 48 hours | ≤ 72 hours | ≤ 30 days | ≤ 60 days |
| **Low** | ≤ 72 hours | ≤ 96 hours | ≤ 90 days | ≤ 90 days |

---

## 5. Coordinated Disclosure & Public Advisories

1. **Embargo Period**: Standard disclosure timeline is **90 days** from initial validation (or shorter by mutual agreement once patches are deployed).
2. **Sanitized Advisories**: When a vulnerability is fixed, a GitHub Security Advisory (GHSA) will be published detailing the impact, root cause, and remediation steps. Sensitive operational details (internal IP addresses, customer data, and raw secret values) will be strictly redacted.
3. **Credit**: Researchers will be prominently credited in release notes and security advisories, unless anonymity is explicitly requested.

For detailed maintainer runbooks and triage workflows, see [docs/security-reporting-and-vulnerability-response-policy.md](docs/security-reporting-and-vulnerability-response-policy.md).
