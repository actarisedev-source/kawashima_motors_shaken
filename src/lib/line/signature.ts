import { createHmac, timingSafeEqual } from "node:crypto";

export const verifyLineWebhookSignature = (
  rawBody: string,
  signature: string,
  channelSecret: string,
) => {
  const expectedSignature = createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(signature);

  return expected.length === received.length && timingSafeEqual(expected, received);
};
