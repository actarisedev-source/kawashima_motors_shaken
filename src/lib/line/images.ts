export const maxLineImageCount = 4;

export const resolveLineImageUrls = (
  imageUrls: string[] | null | undefined,
  legacyImageUrl: string | null | undefined,
) => {
  const urls = (imageUrls ?? []).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  if (urls.length) return urls.slice(0, maxLineImageCount);
  return legacyImageUrl ? [legacyImageUrl] : [];
};
