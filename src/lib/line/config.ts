export const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  liffId: process.env.NEXT_PUBLIC_LIFF_ID,
};

export const isLineConfigured = Boolean(
  lineConfig.channelSecret && lineConfig.channelAccessToken,
);
