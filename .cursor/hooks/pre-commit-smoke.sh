#!/usr/bin/env bash
# Cursor agent hook: run smoke before `git commit` in this repo.
input=$(cat)
command=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.command||""))}catch{process.stdout.write("")}})')

case "$command" in
  *git\ commit*|*git\ \ commit*)
    ;;
  *)
    printf '%s\n' '{"permission":"allow"}'
    exit 0
    ;;
esac

# Allow commits that skip hooks only when the user/agent explicitly passed --no-verify
# (agents must not use --no-verify unless the user asked).
if printf '%s' "$command" | grep -qE -- '--no-verify|-n([[:space:]]|$)'; then
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! (cd "$ROOT" && ./scripts/smoke.sh); then
  printf '%s\n' '{"permission":"deny","user_message":"Smoke suite failed. Fix failures (or run ./scripts/smoke.sh) before committing.","agent_message":"Pre-commit smoke failed. Run ./scripts/smoke.sh, fix failures, extend test/smoke.test.ts if you added UI, then commit again."}'
  exit 0
fi

printf '%s\n' '{"permission":"allow"}'
exit 0
