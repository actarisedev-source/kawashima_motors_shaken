export type LinePushMessage =
  | { type: "text"; text: string }
  | {
      type: "image";
      originalContentUrl: string;
      previewImageUrl: string;
    };

export const buildLinePushMessages = (
  text: string,
  imageUrls: string[],
): LinePushMessage[] => {
  const messages: LinePushMessage[] = [];
  if (text) messages.push({ type: "text", text });
  for (const imageUrl of imageUrls) {
    messages.push({
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });
  }
  return messages;
};

export async function pushLineMessages(
  accessToken: string,
  lineUserId: string,
  messages: LinePushMessage[],
) {
  if (!messages.length) {
    throw new Error("送信するLINEメッセージがありません。");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      to: lineUserId,
      messages,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `LINE Messaging API error: ${response.status}`);
  }
}

export async function pushLineTextMessage(
  accessToken: string,
  lineUserId: string,
  text: string,
) {
  await pushLineMessages(accessToken, lineUserId, [{ type: "text", text }]);
}
