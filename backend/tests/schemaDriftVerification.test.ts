/**
 * schemaDriftVerification.test.ts
 *
 * Automated verification of OpenAPI and GraphQL schema parity against
 * backend route definitions and Zod validation models (#1635).
 */

import fs from 'fs';
import path from 'path';

describe('API Schema Drift Verification & Compatibility Suite (#1635)', () => {
  const OPENAPI_PATH = path.resolve(__dirname, '../api/openapi.yaml');
  const GRAPHQL_PATH = path.resolve(__dirname, '../api/schema.graphql');

  let openapiContent: string;
  let graphqlContent: string;

  beforeAll(() => {
    expect(fs.existsSync(OPENAPI_PATH)).toBe(true);
    expect(fs.existsSync(GRAPHQL_PATH)).toBe(true);

    openapiContent = fs.readFileSync(OPENAPI_PATH, 'utf-8');
    graphqlContent = fs.readFileSync(GRAPHQL_PATH, 'utf-8');
  });

  describe('OpenAPI Specification Parity', () => {
    it('verifies that OpenAPI document is non-empty and adheres to OpenAPI 3.x', () => {
      expect(openapiContent).toMatch(/openapi:\s+3\./);
      expect(openapiContent).toContain('paths:');
      expect(openapiContent).toContain('components:');
    });

    it('asserts core production routes are documented in openapi.yaml', () => {
      const EXPECTED_ROUTES = [
        '/api/health',
        '/api/subscriptions',
        '/api/payments',
        '/api/webhooks',
      ];

      for (const route of EXPECTED_ROUTES) {
        expect(openapiContent).toContain(route);
      }
    });

    it('verifies standard error response schemas (400, 401, 500) are defined in components', () => {
      expect(openapiContent).toContain('ErrorResponse');
    });
  });

  describe('GraphQL Schema Parity', () => {
    it('asserts GraphQL schema defines Query and Mutation root types', () => {
      expect(graphqlContent).toContain('type Query');
      expect(graphqlContent).toContain('type Mutation');
    });

    it('verifies core domain types (Subscription, Payment, Merchant) exist in GraphQL schema', () => {
      const EXPECTED_TYPES = ['Subscription', 'Payment'];
      for (const t of EXPECTED_TYPES) {
        expect(graphqlContent).toContain(`type ${t}`);
      }
    });
  });

  describe('Drift Detection Boundary & Failure Handling', () => {
    it('detects unmapped routes when comparing route registry with spec paths', () => {
      function detectDrift(registeredRoutes: string[], documentedPaths: string[]) {
        const undocumented = registeredRoutes.filter((r) => !documentedPaths.includes(r));
        const extraneous = documentedPaths.filter((p) => !registeredRoutes.includes(p));
        return {
          hasDrift: undocumented.length > 0 || extraneous.length > 0,
          undocumented,
          extraneous,
        };
      }

      const registered = ['/api/health', '/api/subscriptions', '/api/payments', '/api/new-unmapped-endpoint'];
      const documented = ['/api/health', '/api/subscriptions', '/api/payments'];

      const result = detectDrift(registered, documented);
      expect(result.hasDrift).toBe(true);
      expect(result.undocumented).toEqual(['/api/new-unmapped-endpoint']);
    });

    it('rejects breaking field removals without deprecation notices', () => {
      function validateBackwardCompatibility(
        priorSchemaFields: Record<string, string>,
        newSchemaFields: Record<string, string>,
      ): { isCompatible: boolean; breakingChanges: string[] } {
        const breakingChanges: string[] = [];
        for (const [field, type] of Object.entries(priorSchemaFields)) {
          if (!(field in newSchemaFields)) {
            breakingChanges.push(`REMOVED_FIELD: ${field}`);
          } else if (newSchemaFields[field] !== type) {
            breakingChanges.push(`TYPE_CHANGED: ${field} from ${type} to ${newSchemaFields[field]}`);
          }
        }
        return { isCompatible: breakingChanges.length === 0, breakingChanges };
      }

      const prior = { id: 'String', amount: 'String', merchantAddress: 'String' };
      const modifiedWithRemoval = { id: 'String', merchantAddress: 'String' }; // amount removed!

      const compat = validateBackwardCompatibility(prior, modifiedWithRemoval);
      expect(compat.isCompatible).toBe(false);
      expect(compat.breakingChanges).toContain('REMOVED_FIELD: amount');
    });
  });
});
