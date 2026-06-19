export async function pushLineTextMessage(
  accessToken: string,
  lineUserId: string,
  text: string,
) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `LINE Messaging API error: ${response.status}`);
  }
}
