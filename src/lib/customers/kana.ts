const hiraganaPattern = /^[ぁ-ゖゝゞー\s　]+$/;

export const kanaErrorMessage = "ふりがなはひらがなで入力してください。";

export const isValidHiragana = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === 0 || hiraganaPattern.test(trimmed);
};
