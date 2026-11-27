# API Schema Generation, Drift Detection & Verification Guide

This guide establishes the standard procedure for authoring, generating, and verifying API schemas in SorobanPay. It distinguishes authoritative runtime source definitions from generated schema artifacts, documents the single-command drift verification workflow, and details mandatory review steps when endpoints change.

---

## 1. Schema Hierarchy: Sources vs. Generated Artifacts vs. Examples

To prevent documentation drift and runtime serialization mismatches, SorobanPay enforces a strict distinction between source code, generated specs, and sample payloads:

```
+----------------------------------------------------------------------------------------------------+
| 1. AUTHORITATIVE SOURCES (Source of Truth)                                                         |
| - Runtime validation models: TypeScript Zod schemas in `backend/src/`                              |
| - Express HTTP route definitions in `backend/src/routes/`                                          |
| - GraphQL resolver signatures and types in `backend/src/graphql/`                                  |
+----------------------------------------------------------------------------------------------------+
                                                 |
                                     (Build / Generator Tooling)
                                                 v
+----------------------------------------------------------------------------------------------------+
| 2. GENERATED ARTIFACTS (Derived & Machine-Checkable)                                               |
| - OpenAPI 3.0 specification: `backend/api/openapi.yaml`                                            |
| - GraphQL SDL document: `backend/api/schema.graphql`                                               |
| - TypeScript client SDK bindings in `frontend/src/lib/api_client.ts`                               |
+----------------------------------------------------------------------------------------------------+
                                                 |
                                         (Contract Testing)
                                                 v
+----------------------------------------------------------------------------------------------------+
| 3. EXAMPLES & CONTRACT FIXTURES (Non-Authoritative Verification)                                   |
| - Consumer Pact contracts in `pacts/`                                                              |
| - Mock fixtures and sample payloads in `frontend/tests/` and `backend/tests/`                      |
+----------------------------------------------------------------------------------------------------+
```

### Key Architectural Invariant
Contributors must **never edit `backend/api/openapi.yaml` or `backend/api/schema.graphql` manually** without updating the corresponding TypeScript/Zod definitions in `backend/src/`. The source code is the single authoritative source of truth.

---

## 2. One-Command Drift Detection

Contributors and CI pipelines can detect any drift between runtime route implementations and exported API specifications using a single command:

```bash
cd backend
npm run schema:verify
```

### What `npm run schema:verify` Validates
1. **Route Parity**: Every route registered on the Express application exists in `backend/api/openapi.yaml`.
2. **HTTP Verb & Parameter Parity**: All query, path, and header parameters declared in Express routes and Zod schemas match the OpenAPI specification.
3. **Response Schema Alignment**: 200, 400, 401, 404, and 500 response definitions reflect the actual JSON response structures.
4. **GraphQL Type Integrity**: All queries and mutations implemented in resolvers are represented in `backend/api/schema.graphql`.

---

## 3. Step-by-Step Review Guide for Endpoint Changes

When creating or modifying an API endpoint, developers and reviewers must follow this checklist:

### Step 1: Update Authoritative Zod Schemas
Define or modify the request and response validation schema in `backend/src/`:
```typescript
export const CreateSubscriptionRequestSchema = z.object({
  merchantAddress: StellarAddressSchema,
  tokenAddress: StellarAddressSchema,
  amount: z.string().regex(/^\d+$/),
  interval: z.number().int().positive(),
});
```

### Step 2: Update Express Route Handler
Mount the route with schema-validated middleware in `backend/src/routes/`:
```typescript
router.post('/subscriptions', validateBody(CreateSubscriptionRequestSchema), ...);
```

### Step 3: Synchronize Specification Artifacts
Update `backend/api/openapi.yaml` (or run automated generator) to reflect the new route, methods, request bodies, and error responses.

### Step 4: Run Drift Verification
```bash
npm run schema:verify
```
*Ensure zero drift errors before committing.*

### Step 5: Pull Request Review Requirements
- [ ] PR description states whether endpoint change is additive (backward-compatible) or breaking.
- [ ] Breaking changes require a version bump in the URL path (`/v2/`) or explicit deprecation notice.
- [ ] CI drift detection step passes.
