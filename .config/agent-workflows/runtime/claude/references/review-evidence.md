# Review evidence examples

An evidence-backed finding links a changed line to observable behavior:

```
P1 | src/session.ts:42 | retry path reuses an expired token after refresh failure | clear the cached token before returning the error
```

When the diff alone cannot prove a concern, qualify it:

```
No readiness claim: the changed request path has no focused test receipt and the staging runtime was unavailable.
```

Do not convert style preferences, unmeasured performance theories, or unrelated code into blocking defects.
