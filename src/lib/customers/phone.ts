export const normalizePhone = (value: string) => value.replace(/\D/g, "");

export const isValidNormalizedPhone = (value: string) => value.length > 0;
