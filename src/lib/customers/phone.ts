export const normalizePhone = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[ーｰ‐‑‒–—―−-]/g, "")
    .replace(/[\s\u3000]/g, "")
    .replace(/\D/g, "");

export const isValidNormalizedPhone = (value: string) => value.length > 0;
