# BashGuard

> A local-first security, governance, and observability companion for Pi.

BashGuard is an open-source project focused on helping developers understand, govern, and audit what Pi does inside a repository.

The project starts with deep Pi integration rather than broad support for every agent harness. Other harnesses may be considered later, but they are not part of the initial product scope.

## Current Status

BashGuard is in the product definition and design phase. The repository currently contains the project's foundational documents and placeholders for future design work.

## Core Ideas

- Observe before enforcing.
- Capture execution provenance, not just shell history.
- Use repository context when evaluating actions.
- Explain every decision.
- Keep policies readable and local-first.
- Build for Pi first.

## Documents

- [Manifesto](MANIFESTO.md)
- [Product Requirements](PRODUCT_REQUIREMENTS.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Competitive Analysis](COMPETITIVE_ANALYSIS.md)
- [Decision Log](DECISIONS.md)
- [Changelog](CHANGELOG.md)

## Planned Documentation

- `docs/concepts/`
- `docs/design/`
- `docs/rfcs/`
- `docs/adr/`

## Working Positioning

BashGuard helps developers govern Pi with context, not just commands.
