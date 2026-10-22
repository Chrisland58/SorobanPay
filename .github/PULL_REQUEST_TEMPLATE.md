## Summary

<!-- Describe what this PR does and why. Link the related issue. -->

Closes #

## Changes

<!-- List the key changes made in this PR. -->

- 
- 

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] CI / tooling / infrastructure change
- [ ] Refactor (no functional change)

## Checklist

### Tests
- [ ] I have added or updated unit tests for the changes
- [ ] All existing tests pass locally (`make test` for contract, `npm test` for frontend/backend)
- [ ] Integration tests updated if applicable

### Documentation
- [ ] Code is self-documenting or inline comments are added for complex logic
- [ ] README or `docs/` updated if the change affects setup, usage, or architecture
- [ ] CHANGELOG / `CHANGES.md` updated if this is a notable change

### Breaking Changes
- [ ] This PR introduces **no breaking changes**
  - _If it does_, describe the migration path below:

<!-- Breaking change migration notes (delete if not applicable):
  - What breaks:
  - How to migrate:
-->

### Smart Contract (if applicable)
- [ ] Contract changes are backward compatible with existing on-chain subscriptions
- [ ] New entry points / events are documented in `docs/contract-api.md` or `docs/events.md`
- [ ] Fee / budget estimates updated in README if costs changed

### Frontend (if applicable)
- [ ] Type check passes: `npm run type-check`
- [ ] Lint passes: `npm run lint`
- [ ] Wallet connection states (Disconnected / Connected / Submitting / Success / Error) remain intact

### Backend (if applicable)
- [ ] No secrets committed (checked `.env.example`, not `.env`)
- [ ] New environment variables added to `.env.example` with descriptions

## Screenshots / Recordings (if UI changes)

<!-- Attach screenshots or a short screen recording showing the change. -->

## Additional Notes

<!-- Anything else reviewers should know — edge cases, known issues, follow-up work. -->
