#!/usr/bin/env bash
#
# Import a call transcript, meeting notes or a document into the bot's
# knowledge, so it can answer questions from it.
#
#   ./scripts/import.sh call-12-sep.txt --title "Weekly call 12 Sep" --date 2026-09-12
#   ./scripts/import.sh rules.md --title "Group rules" --type note
#   ./scripts/import.sh notes.txt --title "Pricing" --scope -1001234567890
#
# Types: meeting (default) | note | chat | qa
# Re-importing the same title replaces the previous import.
#
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: ./scripts/import.sh <file> --title \"Weekly call 12 Sep\" [--type meeting] [--date 2026-09-12] [--scope <chat id>]" >&2
  exit 1
fi
shift

TITLE="$(basename "$FILE")"
TYPE="meeting"
DATE=""
SCOPE=""
AUTHOR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --title)  TITLE="$2"; shift 2 ;;
    --type)   TYPE="$2"; shift 2 ;;
    --date)   DATE="$2"; shift 2 ;;
    --scope)  SCOPE="$2"; shift 2 ;;
    --author) AUTHOR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"
TOKEN="${KNOWLEDGE_INGEST_TOKEN:-}"

PAYLOAD=$(FILE="$FILE" TITLE="$TITLE" TYPE="$TYPE" DATE="$DATE" SCOPE="$SCOPE" AUTHOR="$AUTHOR" node -e '
  const fs = require("fs");
  const { FILE, TITLE, TYPE, DATE, SCOPE, AUTHOR } = process.env;
  process.stdout.write(JSON.stringify({
    title: TITLE,
    content: fs.readFileSync(FILE, "utf8"),
    type: TYPE,
    ...(DATE ? { date: DATE } : {}),
    ...(SCOPE ? { scope: SCOPE } : {}),
    ...(AUTHOR ? { author: AUTHOR } : {}),
  }));
')

echo "Importing \"$TITLE\" ($(wc -c < "$FILE") bytes)..."

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${BASE}/knowledge/documents" \
  -H 'Content-Type: application/json' \
  ${TOKEN:+-H "Authorization: Bearer ${TOKEN}"} \
  -d "$PAYLOAD")

STATUS=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

case "$STATUS" in
  201|200) echo "$BODY" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const b=JSON.parse(r);console.log(`Imported as ${b.imported} chunk(s) ✅`)})' ;;
  401) echo "Rejected: set KNOWLEDGE_INGEST_TOKEN to the same value as the server." >&2; exit 1 ;;
  000) echo "Cannot reach ${BASE} — is the API running? (npm run start:dev)" >&2; exit 1 ;;
  *)   echo "Failed (HTTP $STATUS): $BODY" >&2; exit 1 ;;
esac
