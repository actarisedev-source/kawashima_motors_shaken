const readEnvironmentVariable = (name: string) =>
  process.env[name]?.trim() || null;

export const getLineConfig = () => ({
  channelSecret: readEnvironmentVariable("LINE_CHANNEL_SECRET"),
  channelAccessToken: readEnvironmentVariable("LINE_CHANNEL_ACCESS_TOKEN"),
  liffId: readEnvironmentVariable("NEXT_PUBLIC_LIFF_ID"),
});

export const getLineConfigurationStatus = () => {
  const config = getLineConfig();

  return {
    webhook: Boolean(config.channelSecret),
    messaging: Boolean(config.channelSecret && config.channelAccessToken),
    liff: Boolean(config.liffId),
  };
};
