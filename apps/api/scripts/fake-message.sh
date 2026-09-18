#!/usr/bin/env bash
#
# Send a fake WhatsApp message to the local webhook and print the bot's reply.
# No WhatsApp account, no Meta app, no tunnel needed.
#
#   ./scripts/fake-message.sh "!help"
#   PORT=3001 ./scripts/fake-message.sh "!echo hello"
#   FROM=212611111111 NAME=Youssef ./scripts/fake-message.sh "!whoami"
#
set -euo pipefail

TEXT="${1:-!help}"
PORT="${PORT:-3000}"
FROM="${FROM:-212600000000}"
NAME="${NAME:-Test User}"
BASE="http://localhost:${PORT}"

# A fresh id every run, otherwise the de-duplication layer correctly ignores
# the second and later sends of the same message.
MESSAGE_ID="wamid.FAKE$(date +%s%N)"

PAYLOAD=$(TEXT="$TEXT" FROM="$FROM" NAME="$NAME" MESSAGE_ID="$MESSAGE_ID" node -e '
const { TEXT, FROM, NAME, MESSAGE_ID } = process.env;
process.stdout.write(JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "0", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550000000", phone_number_id: "111" },
    contacts: [{ wa_id: FROM, profile: { name: NAME } }],
    messages: [{ from: FROM, id: MESSAGE_ID, timestamp: String(Math.floor(Date.now() / 1000)),
                 type: "text", text: { body: TEXT } }],
  } }] }],
}));
')

if ! curl -sf -o /dev/null "${BASE}/whatsapp/messages"; then
  echo "Cannot reach ${BASE} — is the API running? (npm run start:dev)" >&2
  exit 1
fi

curl -s -o /dev/null -X POST "${BASE}/whatsapp/webhook" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD"

echo "you  > ${TEXT}"

curl -s "${BASE}/whatsapp/messages" | MESSAGE_ID="$MESSAGE_ID" node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const entry = JSON.parse(raw).find((m) => m.messageId === process.env.MESSAGE_ID);
  if (!entry) return console.log("bot  > (message was not recorded)");
  if (!entry.reply) return console.log("bot  > (stayed silent)");
  console.log(entry.reply.split("\n").map((line, i) => (i ? "       " : "bot  > ") + line).join("\n"));
});
'
