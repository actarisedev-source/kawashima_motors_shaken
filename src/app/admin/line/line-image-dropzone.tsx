"use client";

import Image from "next/image";
import { useRef, useState, type DragEvent } from "react";

const acceptedImageTypes =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

type LineImageDropzoneProps = {
  disabled?: boolean;
  file: File | null;
  onRemove: () => void;
  onSelectFile: (file: File) => Promise<void> | void;
  previewUrl: string;
  processing?: boolean;
};

export function LineImageDropzone({
  disabled = false,
  file,
  onRemove,
  onSelectFile,
  previewUrl,
  processing = false,
}: LineImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const isDisabled = disabled || processing;

  async function selectFile(selectedFile: File | null) {
    if (!selectedFile || isDisabled) return;

    try {
      await onSelectFile(selectedFile);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDragEnter(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled || !event.dataTransfer.types.includes("Files")) return;

    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDisabled) event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled) return;

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (isDisabled) return;

    void selectFile(event.dataTransfer.files.item(0));
  }

  return (
    <div className="grid gap-2">
      <label className="text-sm font-semibold text-slate-700">添付画像</label>
      <input
        ref={inputRef}
        type="file"
        accept={acceptedImageTypes}
        disabled={isDisabled}
        onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
        className="sr-only"
        tabIndex={-1}
      />
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          "grid min-h-36 w-full cursor-pointer place-items-center gap-2 rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors duration-200",
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-blue-50/60",
          isDisabled ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
      >
        <span className="text-sm font-semibold text-slate-700">
          {file
            ? "別の画像をここにドラッグ＆ドロップ"
            : "画像をここにドラッグ＆ドロップ"}
        </span>
        <span className="text-xs text-slate-500">または</span>
        <span className="rounded-md border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">
          {file ? "画像を変更" : "ファイルを選択"}
        </span>
        <span className="text-xs text-slate-500">
          JPEG / PNG / WebP ・ 最大10MB
        </span>
      </button>

      {processing ? (
        <p className="text-sm font-semibold text-blue-700">
          画像を最適化しています...
        </p>
      ) : null}

      {file ? (
        <div className="flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm">
          {previewUrl ? (
            <Image
              src={previewUrl}
              alt="選択した画像"
              width={64}
              height={64}
              unoptimized
              className="h-14 w-14 shrink-0 rounded-md border border-blue-100 bg-white object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-blue-950">{file.name}</p>
            <p className="mt-1 text-xs text-slate-600">
              {Math.ceil(file.size / 1024)}KB
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 cursor-pointer font-semibold text-red-600 transition hover:text-red-700"
          >
            画像を削除
          </button>
        </div>
      ) : null}
    </div>
  );
}
