---
name: stating-current-state
description: Edit a substantial status report or handoff for current-state clarity when the user requests that editorial pass. Do not load for every ordinary reply.
---

# Stating Current State

## Overview

A report says what is true now and what the reader must do with it. It is not a record of how the
author arrived there.

The failure this addresses is shape, not discipline: the content is accurate, but it carries a
second layer about the author's own trajectory — what was previously claimed, what turned out
wrong, who caught it, how the belief was revised. That layer is invisible to the writer because
each sentence feels warranted in isolation. It costs the reader attention and makes them adjudicate
the author's reliability instead of the subject.

## The Recipe

Every user-facing message contains these parts, in this order, and nothing else:

1. **The current state or answer.** What is true, phrased as a fact about the subject.
2. **What it rests on** — the exact command, file:line, receipt, or query — included only where the
   reader would otherwise have to take it on faith.
3. **What the reader must decide or do**, if anything.

**A corrected fact enters at step 1, in its normal place, in the same voice as any other fact.**
"JATO ingested 3,188 rows at 09:00 today" is the whole correction. The reader gets the true state;
that it replaces something is not information about JATO.

## Quick Reference

| Instead of | Write |
|---|---|
| "I was wrong about X — it's actually Y" | "X is Y" |
| "Correcting my earlier claim: the count is 79" | "The count is 79" |
| "Good catch, you're right, I'd said Z" | "Z" (the corrected fact) |
| "I verified this myself rather than trusting memory" | the evidence line, or nothing |
| "Two corrections worth stating plainly" | the two corrected facts, in place |
| "My earlier framing was backwards" | the correct framing |
| "This turned out better than I said" | the current number |

## When a Correction Does Need Its Own Sentence

Conditional on an observable predicate — not on how significant the error feels:

- **The reader has already acted on the superseded fact, or is about to.** Then state the new fact
  and what it changes for their decision: "The demo number can't create a lead, so the allowlist
  step has no input." Still about the subject, not about the author.
- **A durable artifact still carries the old claim.** Name the artifact and fix it.
- **The reader asks what changed.** Answer directly.

Absent one of these, the corrected fact stands alone.

## Applies Equally To

Chat messages, artifacts, PR descriptions, commit messages, plan and status files, handoff capsules,
and messages to other agents. A status file that narrates its own revision history is the same
failure in a place that outlives the conversation.

## Common Mistakes

- **Trading a long correction for a short one.** "Turns out it's 79, not 72" is still the delta.
  Write "79".
- **Attributing the catch.** Crediting who found an error is about the author's process. Route
  genuine credit to the person or agent directly, not through a report to a third party.
- **Hedging the whole message because one part was revised.** Confidence is per-claim.
- **Keeping the scaffolding after cutting the apology.** "To be clear," "for accuracy," "to be
  precise," and "worth stating plainly" are the same layer with the emotion removed.

## Red Flags

The message contains the words: *wrong, correction, corrected, earlier, previously, actually,
turns out, I'd said, mea culpa, to be fair, good catch, I should have, I stated.*

Each is a signal the sentence is about the author's trajectory. Delete the sentence and check
whether any fact was lost. Usually nothing was.
