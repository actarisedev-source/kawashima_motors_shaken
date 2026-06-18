export type Customer = {
  id: string;
  tenantId: string;
  name: string;
  nameKana: string | null;
  phone: string | null;
  lineUserId: string | null;
  lineDisplayName: string | null;
  linePictureUrl: string | null;
  lineLinkedAt: string | null;
  lineStatus: string;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
};
