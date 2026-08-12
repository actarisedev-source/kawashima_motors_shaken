"use client";

import Image from "next/image";
import {
  useRef,
  useState,
  type DragEvent,
} from "react";
import { maxLineImageCount } from "@/lib/line/images";
import type { LineImageAttachment } from "./use-line-image-attachments";

const acceptedImageTypes =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

type LineImageDropzoneProps = {
  attachments: LineImageAttachment[];
  disabled?: boolean;
  onAddFiles: (files: File[]) => Promise<void> | void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
  onReplaceFile: (index: number, file: File) => Promise<void> | void;
  processing?: boolean;
};

export function LineImageDropzone({
  attachments,
  disabled = false,
  onAddFiles,
  onMove,
  onRemove,
  onReplaceFile,
  processing = false,
}: LineImageDropzoneProps) {
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const [dragTarget, setDragTarget] = useState<"add" | number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const isDisabled = disabled || processing;
  const canAdd = attachments.length < maxLineImageCount;

  async function addSelectedFiles(files: File[]) {
    if (!files.length || isDisabled) return;
    await onAddFiles(files);
    if (addInputRef.current) addInputRef.current.value = "";
  }

  async function replaceSelectedFile(file: File | null) {
    const index = replaceIndexRef.current;
    if (!file || index === null || isDisabled) return;
    await onReplaceFile(index, file);
    replaceIndexRef.current = null;
    if (replaceInputRef.current) replaceInputRef.current.value = "";
  }

  function openReplaceDialog(index: number) {
    replaceIndexRef.current = index;
    replaceInputRef.current?.click();
  }

  function preventFileNavigation(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDisabled) event.dataTransfer.dropEffect = "copy";
  }

  function isImageSortDrag(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes(
      "application/x-line-image-index",
    );
  }

  function handleAddDrop(event: DragEvent<HTMLButtonElement>) {
    preventFileNavigation(event);
    setDragTarget(null);
    if (!canAdd || isDisabled) return;
    void addSelectedFiles(Array.from(event.dataTransfer.files));
  }

  function handleReplaceDrop(event: DragEvent<HTMLDivElement>, index: number) {
    preventFileNavigation(event);
    setDragTarget(null);
    if (isDisabled) return;
    if (isImageSortDrag(event)) {
      const fromIndex =
        draggedIndexRef.current ??
        Number(event.dataTransfer.getData("application/x-line-image-index"));
      if (Number.isInteger(fromIndex)) onMove(fromIndex, index);
      draggedIndexRef.current = null;
      setDraggingIndex(null);
      return;
    }
    const file = event.dataTransfer.files.item(0);
    if (file) void onReplaceFile(index, file);
  }

  function handleSortDragStart(event: DragEvent<HTMLDivElement>, index: number) {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    draggedIndexRef.current = index;
    setDraggingIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-line-image-index", String(index));
  }

  function handleSortDragOver(event: DragEvent<HTMLDivElement>, index: number) {
    preventFileNavigation(event);
    if (isDisabled) return;
    if (!isImageSortDrag(event)) {
      setDragTarget(index);
      return;
    }

    event.dataTransfer.dropEffect = "move";
    const fromIndex = draggedIndexRef.current;
    if (fromIndex === null || fromIndex === index) {
      setDragTarget(index);
      return;
    }
    onMove(fromIndex, index);
    draggedIndexRef.current = index;
    setDraggingIndex(index);
    setDragTarget(index);
  }

  function finishSortDrag() {
    draggedIndexRef.current = null;
    setDraggingIndex(null);
    setDragTarget(null);
  }

  function moveByStep(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= attachments.length || isDisabled) return;
    onMove(index, nextIndex);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-slate-700">添付画像</label>
        <span className="text-xs font-semibold text-slate-500">
          {attachments.length} / {maxLineImageCount}枚
        </span>
      </div>
      <input
        ref={addInputRef}
        type="file"
        multiple
        accept={acceptedImageTypes}
        disabled={isDisabled || !canAdd}
        onChange={(event) =>
          void addSelectedFiles(Array.from(event.target.files ?? []))
        }
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept={acceptedImageTypes}
        disabled={isDisabled}
        onChange={(event) =>
          void replaceSelectedFile(event.target.files?.[0] ?? null)
        }
        className="sr-only"
        tabIndex={-1}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {attachments.map((attachment, index) => (
          <div
            key={attachment.previewUrl}
            draggable={!isDisabled}
            onDragStart={(event) => handleSortDragStart(event, index)}
            onDragEnd={finishSortDrag}
            onDragEnter={(event) => {
              preventFileNavigation(event);
              if (!isDisabled) setDragTarget(index);
            }}
            onDragOver={(event) => handleSortDragOver(event, index)}
            onDragLeave={(event) => {
              preventFileNavigation(event);
              if (!isImageSortDrag(event)) setDragTarget(null);
            }}
            onDrop={(event) => handleReplaceDrop(event, index)}
            className={`group relative grid min-h-36 cursor-grab content-between overflow-hidden rounded-md border bg-white p-2 text-left transition active:cursor-grabbing ${
              draggingIndex === index
                ? "z-10 -translate-y-1 scale-[1.02] opacity-80 shadow-lg"
                : "shadow-sm"
            } ${
              dragTarget === index
                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                : "border-slate-200 hover:border-blue-300"
            } ${isDisabled ? "opacity-60" : ""}`}
          >
            {dragTarget === index && draggingIndex !== null ? (
              <span className="pointer-events-none absolute inset-y-2 left-1 z-20 w-1 rounded-full bg-blue-500" />
            ) : null}
            <div className="relative aspect-[4/3] overflow-hidden rounded bg-slate-100">
              <Image
                src={attachment.previewUrl}
                alt={`選択した画像${index + 1}`}
                fill
                unoptimized
                className="object-cover"
              />
              <span className="absolute left-1.5 top-1.5 rounded bg-slate-950/70 px-1.5 py-0.5 text-xs font-bold text-white">
                {index + 1}
              </span>
            </div>
            <p className="mt-2 truncate text-xs font-semibold text-slate-700">
              {attachment.file.name}
            </p>
            <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-1">
              <span className="truncate text-xs text-slate-500">
                {Math.ceil(attachment.file.size / 1024)}KB
              </span>
              <button
                type="button"
                aria-label={`画像${index + 1}を左へ移動`}
                disabled={isDisabled || index === 0}
                onClick={() => moveByStep(index, -1)}
                className="grid min-h-9 min-w-9 place-items-center rounded text-base font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`画像${index + 1}を右へ移動`}
                disabled={isDisabled || index === attachments.length - 1}
                onClick={() => moveByStep(index, 1)}
                className="grid min-h-9 min-w-9 place-items-center rounded text-base font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                →
              </button>
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => openReplaceDialog(index)}
                className="min-h-8 rounded px-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed"
              >
                変更
              </button>
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => onRemove(index)}
                className="col-span-2 min-h-8 rounded px-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed"
              >
                削除
              </button>
            </div>
          </div>
        ))}

        {canAdd ? (
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => addInputRef.current?.click()}
            onDragEnter={(event) => {
              preventFileNavigation(event);
              if (!isDisabled) setDragTarget("add");
            }}
            onDragOver={preventFileNavigation}
            onDragLeave={(event) => {
              preventFileNavigation(event);
              setDragTarget(null);
            }}
            onDrop={handleAddDrop}
            className={`grid cursor-pointer place-items-center gap-2 rounded-md border-2 border-dashed px-3 py-5 text-center transition ${
              attachments.length ? "min-h-36" : "col-span-2 min-h-36 sm:col-span-4"
            } ${
              dragTarget === "add"
                ? "border-blue-500 bg-blue-50"
                : "border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-blue-50/60"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="text-2xl font-light text-blue-600">＋</span>
            <span className="text-sm font-semibold text-slate-700">
              {attachments.length
                ? "画像を追加"
                : "画像をここにドラッグ＆ドロップ"}
            </span>
            {!attachments.length ? (
              <span className="text-xs text-slate-500">またはファイルを選択</span>
            ) : null}
            <span className="text-xs text-slate-500">
              JPEG / PNG / WebP ・ 最大10MB/枚
            </span>
          </button>
        ) : null}
      </div>

      {processing ? (
        <p className="text-sm font-semibold text-blue-700">
          画像を最適化しています...
        </p>
      ) : null}
    </div>
  );
}
