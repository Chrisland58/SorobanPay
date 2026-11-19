"""Automated tests for CI dependency cache integrity and trust-boundary isolation."""

from __future__ import annotations

import pathlib
import re
import unittest

WORKFLOWS_DIR = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"
RELEASE_WORKFLOWS = {
    "promotion-pipeline.yml",
    "deploy-testnet.yml",
    "testnet-deploy.yml",
}

LOCKFILE_PATTERN = re.compile(r"hashFiles\([^)]*(?:Cargo\.lock|package-lock\.json)[^)]*\)")
TOOLCHAIN_PATTERN = re.compile(r"(?:rustc_hash|node-version|rust-toolchain)")


def _extract_step_blocks(content: str) -> list[dict[str, str]]:
    """Extract cache-related step blocks from a GitHub Actions workflow YAML."""
    blocks: list[dict[str, str]] = []
    lines = content.splitlines()
    for idx, line in enumerate(lines):
        if "uses:" not in line:
            continue
        if not any(
            action in line
            for action in ("actions/cache@", "Swatinem/rust-cache@", "actions/setup-node@")
        ):
            continue

        # Capture the step block until the next step or dedented section.
        indent = len(line) - len(line.lstrip())
        block_lines = [line]
        for next_line in lines[idx + 1 :]:
            stripped = next_line.strip()
            if not stripped or stripped.startswith("#"):
                block_lines.append(next_line)
                continue
            next_indent = len(next_line) - len(next_line.lstrip())
            if next_indent < indent or (next_indent == indent and stripped.startswith("- ")):
                break
            block_lines.append(next_line)

        blocks.append({"uses": line.strip(), "block": "\n".join(block_lines)})
    return blocks


def validate_workflow_cache_integrity(filename: str, content: str) -> list[str]:
    """Validate cache key scoping and trust-boundary rules for a workflow file."""
    errors: list[str] = []
    is_release = filename in RELEASE_WORKFLOWS
    steps = _extract_step_blocks(content)

    for step in steps:
        uses = step["uses"]
        block = step["block"]

        if "actions/cache@" in uses:
            key_match = re.search(r"^\s*key:\s*(.+)$", block, re.MULTILINE)
            if not key_match:
                errors.append(f"{filename}: actions/cache step missing 'key'")
                continue
            key_val = key_match.group(1).strip()

            if not LOCKFILE_PATTERN.search(key_val):
                errors.append(
                    f"{filename}: actions/cache key must include lockfile hash (Cargo.lock or package-lock.json): {key_val}"
                )
            if not TOOLCHAIN_PATTERN.search(key_val):
                errors.append(
                    f"{filename}: actions/cache key must include toolchain version/hash: {key_val}"
                )
            if re.search(r"^\s*restore-keys:", block, re.MULTILINE):
                errors.append(
                    f"{filename}: actions/cache step must not use broad restore-keys that bypass lockfile/toolchain invalidation"
                )
            if is_release:
                if not key_val.startswith("release-"):
                    errors.append(
                        f"{filename}: release workflow actions/cache key must use 'release-' prefix: {key_val}"
                    )
                if "lookup-only: ${{ github.event_name == 'pull_request' }}" not in block:
                    errors.append(
                        f"{filename}: release workflow actions/cache must set lookup-only for pull_request"
                    )

        elif "Swatinem/rust-cache@" in uses and is_release:
            if "prefix-key: release-rust-" not in block:
                errors.append(
                    f"{filename}: release workflow Swatinem/rust-cache must set 'prefix-key: release-rust-'"
                )
            if "save-if: ${{ github.event_name != 'pull_request' }}" not in block:
                errors.append(
                    f"{filename}: release workflow Swatinem/rust-cache must set save-if to exclude pull_request"
                )

        elif "actions/setup-node@" in uses and is_release:
            if re.search(r"^\s*cache:\s*npm\b", block, re.MULTILINE):
                errors.append(
                    f"{filename}: release workflow must not use shared setup-node 'cache: npm'; use isolated actions/cache with 'release-' prefix"
                )

    return errors


class TestWorkflowCacheIntegrity(unittest.TestCase):
    """Verify all repository CI workflows satisfy cache integrity requirements."""

    def test_all_repository_workflows_pass_cache_integrity(self) -> None:
        workflow_files = sorted(WORKFLOWS_DIR.glob("*.yml"))
        self.assertGreater(len(workflow_files), 0, "Expected workflow files in .github/workflows")

        all_errors: list[str] = []
        for wf in workflow_files:
            all_errors.extend(validate_workflow_cache_integrity(wf.name, wf.read_text(encoding="utf-8")))

        self.assertEqual(all_errors, [], "Cache integrity violations found:\n" + "\n".join(all_errors))

    def test_rejects_missing_lockfile_hash(self) -> None:
        bad_yaml = """
      - uses: actions/cache@v4
        with:
          path: ~/.cargo/registry
          key: ${{ runner.os }}-mutants-${{ steps.rust-toolchain.outputs.rustc_hash }}
"""
        errors = validate_workflow_cache_integrity("mutation-tests.yml", bad_yaml)
        self.assertTrue(any("lockfile hash" in err for err in errors))

    def test_rejects_missing_toolchain_in_key(self) -> None:
        bad_yaml = """
      - uses: actions/cache@v4
        with:
          path: ~/.cargo/registry
          key: ${{ runner.os }}-mutants-${{ hashFiles('contracts/subscription/Cargo.lock') }}
"""
        errors = validate_workflow_cache_integrity("mutation-tests.yml", bad_yaml)
        self.assertTrue(any("toolchain" in err for err in errors))

    def test_rejects_broad_restore_keys(self) -> None:
        bad_yaml = """
      - uses: actions/cache@v4
        with:
          path: ~/.cargo/registry
          key: ${{ runner.os }}-mutants-${{ steps.rust-toolchain.outputs.rustc_hash }}-${{ hashFiles('contracts/subscription/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-mutants-
"""
        errors = validate_workflow_cache_integrity("mutation-tests.yml", bad_yaml)
        self.assertTrue(any("restore-keys" in err for err in errors))

    def test_rejects_release_workflow_without_isolation(self) -> None:
        bad_yaml = """
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: contracts/subscription
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
"""
        errors = validate_workflow_cache_integrity("promotion-pipeline.yml", bad_yaml)
        self.assertTrue(any("prefix-key: release-rust-" in err for err in errors))
        self.assertTrue(any("save-if" in err for err in errors))
        self.assertTrue(any("cache: npm" in err for err in errors))


if __name__ == "__main__":
    unittest.main()
