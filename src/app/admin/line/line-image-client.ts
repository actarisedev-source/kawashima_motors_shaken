const acceptedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxSelectedImageBytes = 10 * 1024 * 1024;
const maxPreparedImageBytes = 1024 * 1024;

const loadBrowserImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("画像を読み込めませんでした。"));
    };
    image.src = objectUrl;
  });

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("画像を変換できませんでした。")),
      "image/jpeg",
      quality,
    );
  });

export async function prepareLineImage(file: File) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error("jpg・jpeg・png・webp形式の画像を選択してください。");
  }
  if (file.size > maxSelectedImageBytes) {
    throw new Error("画像は10MB以内で選択してください。");
  }

  const source = await loadBrowserImage(file);
  const initialScale = Math.min(
    1,
    2048 / Math.max(source.naturalWidth, source.naturalHeight),
  );
  let scale = initialScale;
  let quality = 0.9;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToJpeg(canvas, quality);
    if (blob.size <= maxPreparedImageBytes) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "line-image";
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.82;
    quality = Math.max(0.62, quality - 0.06);
  }

  throw new Error("画像を1MB以内に変換できませんでした。");
}
