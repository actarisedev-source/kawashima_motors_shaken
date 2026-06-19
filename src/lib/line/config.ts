const readEnvironmentVariable = (name: string) =>
  process.env[name]?.trim() || null;

export const getLineConfig = () => ({
  channelSecret: readEnvironmentVariable("LINE_CHANNEL_SECRET"),
  channelAccessToken: readEnvironmentVariable("LINE_CHANNEL_ACCESS_TOKEN"),
  liffId: readEnvironmentVariable("NEXT_PUBLIC_LIFF_ID"),
  reservationLiffId:
    readEnvironmentVariable("NEXT_PUBLIC_RESERVATION_LIFF_ID") ||
    readEnvironmentVariable("NEXT_PUBLIC_LIFF_ID"),
  loginChannelId: readEnvironmentVariable("LINE_LOGIN_CHANNEL_ID"),
});

export const getLineConfigurationStatus = () => {
  const config = getLineConfig();

  return {
    webhook: Boolean(config.channelSecret),
    messaging: Boolean(config.channelSecret && config.channelAccessToken),
    liff: Boolean(config.liffId && config.loginChannelId),
    reservationLiff: Boolean(
      config.reservationLiffId && config.loginChannelId,
    ),
  };
};
