import { getLineConfig } from "@/lib/line/config";

type LineIdTokenProfile = {
  sub: string;
  name: string | null;
  picture: string | null;
};

type LineIdTokenResponse = {
  sub?: unknown;
  name?: unknown;
  picture?: unknown;
};

export class LineLoginConfigurationError extends Error {}

export async function verifyLineIdToken(
  idToken: string,
): Promise<LineIdTokenProfile | null> {
  const { loginChannelId } = getLineConfig();

  if (!loginChannelId) {
    throw new LineLoginConfigurationError(
      "LINE_LOGIN_CHANNEL_ID is not configured.",
    );
  }

  const body = new URLSearchParams({
    id_token: idToken,
    client_id: loginChannelId,
  });
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const profile = (await response.json()) as LineIdTokenResponse;

  if (typeof profile.sub !== "string" || !profile.sub) {
    return null;
  }

  return {
    sub: profile.sub,
    name: typeof profile.name === "string" ? profile.name : null,
    picture: typeof profile.picture === "string" ? profile.picture : null,
  };
}
