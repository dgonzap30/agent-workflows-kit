# Verification examples

Run the command named by the project rather than replacing it with a generic fallback.

```sh
if pnpm test:unit; then status=0; else status=$?; fi
printf 'test:unit exit=%s\n' "$status"
exit "$status"
```

If output must be summarized, write it to a file or capture it after the command finishes; never let a display filter determine the required command's result.

```sh
log=$(mktemp "${TMPDIR:-/tmp}/project-test.XXXXXX")
trap 'rm -f "$log"' EXIT
if pnpm test:unit > "$log" 2>&1; then status=0; else status=$?; fi
tail -n 30 "$log"
exit "$status"
```
