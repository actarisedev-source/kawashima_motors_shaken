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

export type LineWebhookEvent = {
  type: string;
  timestamp: number;
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery: boolean;
  };
  source?: {
    type: "user" | "group" | "room";
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  mode?: "active" | "standby";
};

export type LineWebhookPayload = {
  destination?: string;
  events: LineWebhookEvent[];
};
