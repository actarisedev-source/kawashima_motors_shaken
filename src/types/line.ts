export type LineProfile = {
  id: string;
  tenantId: string;
  customerId: string | null;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  followedAt: string | null;
  unfollowedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LineWebhookEventType = "follow" | "unfollow" | "message" | "postback";

