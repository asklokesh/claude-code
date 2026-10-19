#!/bin/bash
# Regression tests: --max-iterations values with leading zeros or overflow.
set -uo pipefail

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="$PLUGIN/scripts/setup-ralph-loop.sh"
HOOK="$PLUGIN/hooks/stop-hook.sh"
FAILURES=0

fail() { echo "FAIL: $*"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok: $*"; }

# rounds_until_stop DIR MAX_ROUNDS -> prints hook runs before state removal, or -1
rounds_until_stop() {
  local dir="$1" rounds="$2" i
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"still working"}]}}\n' > "$dir/t.jsonl"
  for ((i = 1; i <= rounds; i++)); do
    if [[ ! -f "$dir/.claude/ralph-loop.local.md" ]]; then echo $((i - 1)); return; fi
    (cd "$dir" && echo "{\"session_id\":\"s1\",\"transcript_path\":\"$dir/t.jsonl\"}" | env -u CLAUDE_CODE_SESSION_ID bash "$HOOK" >/dev/null 2>&1)
  done
  if [[ -f "$dir/.claude/ralph-loop.local.md" ]]; then echo -1; else echo "$rounds"; fi
}

check_cap() {
  local input="$1" expected="$2" dir out rounds
  dir="$(mktemp -d)"
  out="$(cd "$dir" && env -u CLAUDE_CODE_SESSION_ID bash "$SETUP" "do the task" --max-iterations "$input" 2>&1)" || { fail "$input: setup failed: $out"; return; }
  if grep -q 'value too great for base\|Max iterations: unlimited' <<<"$out"; then fail "$input: bad setup output"; return; fi
  grep -q "^max_iterations: $expected\$" "$dir/.claude/ralph-loop.local.md" || { fail "$input: state not normalized to $expected"; return; }
  rounds="$(rounds_until_stop "$dir" 12)"
  if [[ "$rounds" == "$expected" ]]; then pass "$input stops at $expected"; else fail "$input: stopped after $rounds, want $expected"; fi
  rm -rf "$dir"
}

check_cap 8 8
check_cap 08 8
check_cap 09 9
check_cap 010 10

for big in 9223372036854775808 18446744073709551616; do
  dir="$(mktemp -d)"
  (cd "$dir" && env -u CLAUDE_CODE_SESSION_ID bash "$SETUP" "do the task" --max-iterations "$big" >/dev/null 2>&1)
  status=$?
  if [[ $status -eq 1 ]] && [[ ! -f "$dir/.claude/ralph-loop.local.md" ]]; then pass "$big rejected"; else fail "$big: status $status"; fi
  rm -rf "$dir"
done

# Hand-edited state file with leading zero / overflow must not run forever.
for edited in 08 9223372036854775808; do
  dir="$(mktemp -d)"
  (cd "$dir" && env -u CLAUDE_CODE_SESSION_ID bash "$SETUP" "do the task" --max-iterations 8 >/dev/null 2>&1)
  sed -i.bak "s/^max_iterations:.*/max_iterations: $edited/" "$dir/.claude/ralph-loop.local.md"
  rounds="$(rounds_until_stop "$dir" 12)"
  if [[ "$rounds" != "-1" ]]; then pass "hook stops on state max_iterations $edited"; else fail "hook ran forever on $edited"; fi
  rm -rf "$dir"
done

if [[ $FAILURES -ne 0 ]]; then
  echo "$FAILURES failure(s)"
  exit 1
fi
echo "All tests passed"
