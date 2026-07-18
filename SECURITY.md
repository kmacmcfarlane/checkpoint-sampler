# Security Policy

## Scope and threat model

Checkpoint Sampler is a **local-first, single-user tool** with **no
authentication**. It is designed to run on your own machine and, optionally, be
reached across a trusted LAN. Every API endpoint — including destructive
operations — is open to anyone who can reach the port. See the
[Security model section of the README](README.md#security-model) for the full
details, including how to safely restrict or expose the service.

Because of this design, the following are **expected behavior, not
vulnerabilities**:

- Unauthenticated access to any endpoint when the port is reachable.
- Full read/write/delete access to configured checkpoint and sample directories.
- LAN exposure when the operator explicitly sets `HOST_BIND=0.0.0.0`.

We *are* interested in reports of issues that break the tool's intended
boundaries, for example:

- Path traversal or reads/writes outside the configured directories.
- Remote code execution, command injection, or SSRF via the backend or its
  ComfyUI integration.
- Leakage of secrets from configuration or logs.
- Denial of service that is trivially triggerable and disproportionate.

## Supported versions

This is a rolling, single-branch project. Only the latest `main` (and the most
recent release, if any) receives security fixes. There are no long-term support
branches.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do not open a public
issue for a security problem.

- **Preferred:** open a private
  [GitHub Security Advisory](https://github.com/kmacmcfarlane/checkpoint-sampler/security/advisories/new)
  ("Report a vulnerability").
- **Alternative:** email the maintainer at
  `kmac.mcfarlane@gmail.com` with a description and reproduction steps.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal proof of concept if possible).
- The affected version or commit.

## What to expect

This is a hobby/open-source project maintained on a best-effort basis:

- We aim to acknowledge reports within about a week.
- Valid issues will be triaged and fixed on `main`; we will keep you informed of
  progress and coordinate a disclosure timeline with you.
- There is **no bug-bounty program** and no monetary reward — but credit is
  gladly given to reporters who wish to be acknowledged.
