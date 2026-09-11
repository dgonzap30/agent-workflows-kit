#!/usr/bin/env bash
# Supplemental deterministic check; native sandbox/approval policy remains active.
exec python3 "$HOME/.config/agent-workflows/hooks/security-guard.py"
