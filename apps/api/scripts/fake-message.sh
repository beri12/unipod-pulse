#!/usr/bin/env bash
#
# Send a fake message to the local bot and print its reply.
# No WhatsApp account, no Telegram bot, no Meta app, no tunnel needed.
#
#   ./scripts/fake-message.sh "!help"
#   CHANNEL=telegram ./scripts/fake-message.sh "/ping"
#   CHANNEL=telegram GROUP=1 ./scripts/fake-message.sh "/ping@UniPodPulseBot"
#   FROM=212611111111 NAME=Youssef ./scripts/fake-message.sh "!whoami"
#   PORT=3001 ./scripts/fake-message.sh "!echo hello"
#
set -euo pipefail

TEXT="${1:-!help}"
PORT="${PORT:-3000}"
CHANNEL="${CHANNEL:-whatsapp}"
NAME="${NAME:-Test User}"
GROUP="${GROUP:-0}"
BASE="http://localhost:${PORT}"

if ! curl -sf -o /dev/null "${BASE}/bot/messages"; then
  echo "Cannot reach ${BASE} — is the API running? (npm run start:dev)" >&2
  exit 1
fi

# A fresh id every run, otherwise the de-duplication layer correctly ignores
# the second and later sends of the same message.
UNIQUE="$(date +%s%N)"

if [ "$CHANNEL" = "telegram" ]; then
  FROM="${FROM:-555001}"
  ENDPOINT="${BASE}/telegram/webhook"
  MATCH_ID=""
  PAYLOAD=$(TEXT="$TEXT" FROM="$FROM" NAME="$NAME" GROUP="$GROUP" UNIQUE="$UNIQUE" node -e '
    const { TEXT, FROM, NAME, GROUP, UNIQUE } = process.env;
    const isGroup = GROUP === "1";
    const messageId = Number(UNIQUE.slice(-9));
    process.stdout.write(JSON.stringify({
      update_id: messageId,
      message: {
        message_id: messageId,
        from: { id: Number(FROM), is_bot: false, first_name: NAME },
        chat: isGroup
          ? { id: -100123456, type: "supergroup", title: "UniPod Community" }
          : { id: Number(FROM), type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: TEXT,
      },
    }));
  ')
  MATCH_ID=$(echo "$PAYLOAD" | node -e '
    let raw=""; process.stdin.on("data",c=>raw+=c).on("end",()=>{
      const m = JSON.parse(raw).message;
      process.stdout.write(`${m.chat.id}:${m.message_id}`);
    });
  ')
else
  FROM="${FROM:-212600000000}"
  ENDPOINT="${BASE}/whatsapp/webhook"
  MATCH_ID="wamid.FAKE${UNIQUE}"
  PAYLOAD=$(TEXT="$TEXT" FROM="$FROM" NAME="$NAME" MESSAGE_ID="$MATCH_ID" node -e '
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
fi

curl -s -o /dev/null -X POST "$ENDPOINT" -H 'Content-Type: application/json' -d "$PAYLOAD"

echo "you  > ${TEXT}"

curl -s "${BASE}/bot/messages" | MATCH_ID="$MATCH_ID" node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const entry = JSON.parse(raw).find((m) => m.messageId === process.env.MATCH_ID);
  if (!entry) return console.log("bot  > (message was not recorded)");
  if (!entry.reply) return console.log("bot  > (stayed silent)");
  console.log(entry.reply.split("\n").map((line, i) => (i ? "       " : "bot  > ") + line).join("\n"));
});
'
