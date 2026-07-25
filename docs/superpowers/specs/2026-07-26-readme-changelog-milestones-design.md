# README Changelog Milestones Design

## Goal

Keep the README changelog compact while preserving the releases that explain the
project's major capability, reliability, and safety transitions. Detailed release
notes remain exclusively in `CHANGELOG.md`.

## README structure

The `Changelog` section contains:

1. The existing five most recent release summaries (`v0.29.0` through `v0.28.0`).
2. A `历史里程碑` subsection with six one-line phase summaries, in reverse
   chronological order:
   - `v0.26.0–v0.27.0`: billing safety, atomic downloads, resilient pagination,
     packaged Skill distribution, and release quality gates.
   - `v0.22.0–v0.23.0`: fetch-all semantics, machine-readable partial results,
     token self-healing, API domain migration, fund flow, and institution search.
   - `v0.19.0–v0.20.0`: EDE indicator APIs, US announcements and financial
     statements, credential redaction, and fail-soft pagination.
   - `v0.16.0–v0.18.0`: server-backed reference data, stricter endpoint-specific
     filters, and official-account content.
   - `v0.14.0–v0.15.0`: cross-market realtime and US K-line support, reliable
     full-market sharding, and concept data.
   - `v0.12.0–v0.13.0`: concurrent pagination, connection reuse, streaming I/O,
     K-line sharding, HK financials, EDB, and stock pools.
3. One link to `CHANGELOG.md` for full details and all other versions.

## Editorial rules

- Each README entry is one sentence with no nested bullets.
- Describe user-visible capability or a material reliability/safety transition.
- Omit individual parameters, error codes, probe results, test counts, and patch
  mechanics from README.
- Do not duplicate or remove detailed entries in `CHANGELOG.md`.
- Keep the complete README changelog section near 20 lines.

## Verification

- README contains exactly five recent summaries and six historical milestones.
- Every version or version range referenced by README exists in `CHANGELOG.md`.
- The documentation consistency unit test passes.
- `git diff --check` reports no formatting errors.
