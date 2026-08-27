#!/usr/bin/env bash
# Enforce pre-fab's hard limit on concurrent subagents (see CLAUDE.md).
#
# Slot-file counter: one file per running agent. Wired up in
# .claude/settings.json as PreToolUse (acquire), SubagentStop (release)
# and SessionStart (reset).
set -uo pipefail

LIMIT=3
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
DIR="$ROOT/.claude/.agent-slots"
mkdir -p "$DIR" 2>/dev/null

count() { find "$DIR" -type f 2>/dev/null | wc -l | tr -d ' '; }

case "${1:-}" in
  acquire)
    # Drop slots older than 2h so an agent that died without firing
    # SubagentStop cannot wedge the limit shut permanently.
    find "$DIR" -type f -mmin +120 -delete 2>/dev/null
    n=$(count)
    if [ "$n" -ge "$LIMIT" ]; then
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"pre-fab hard limit: %s subagents already running (max %s). This is a project rule in CLAUDE.md, not a suggestion. Wait for one to finish, or do the work inline."}}\n' "$n" "$LIMIT"
      exit 0
    fi
    : > "$DIR/slot-$(date +%s)-$$-${RANDOM}"
    ;;
  release)
    f=$(find "$DIR" -type f 2>/dev/null | head -1)
    [ -n "$f" ] && rm -f "$f"
    ;;
  reset)
    rm -f "$DIR"/slot-* 2>/dev/null
    ;;
  count)
    count
    ;;
esac
exit 0
