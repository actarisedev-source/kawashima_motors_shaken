"use client";

import { useEffect, useRef, useState } from "react";
import { maxLineImageCount } from "@/lib/line/images";
import { prepareLineImage } from "./line-image-client";

export type LineImageAttachment = {
  file: File;
  previewUrl: string;
};

export function useLineImageAttachments(
  onError: (message: string) => void,
  onChange?: () => void,
) {
  const [attachments, setAttachments] = useState<LineImageAttachment[]>([]);
  const [processing, setProcessing] = useState(false);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    },
    [],
  );

  async function addFiles(files: File[]) {
    if (!files.length || processing) return;
    if (attachments.length + files.length > maxLineImageCount) {
      onError("添付画像は4枚まで選択できます。");
      return;
    }

    setProcessing(true);
    try {
      const preparedFiles = await Promise.all(files.map(prepareLineImage));
      const additions = preparedFiles.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setAttachments((current) => [...current, ...additions]);
      onChange?.();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "画像の処理に失敗しました。",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function replaceFile(index: number, file: File) {
    if (processing || !attachments[index]) return;
    setProcessing(true);
    try {
      const prepared = await prepareLineImage(file);
      const replacement = {
        file: prepared,
        previewUrl: URL.createObjectURL(prepared),
      };
      setAttachments((current) =>
        current.map((attachment, currentIndex) => {
          if (currentIndex !== index) return attachment;
          URL.revokeObjectURL(attachment.previewUrl);
          return replacement;
        }),
      );
      onChange?.();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "画像の処理に失敗しました。",
      );
    } finally {
      setProcessing(false);
    }
  }

  function removeFile(index: number) {
    setAttachments((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
    onChange?.();
  }

  function clearFiles() {
    for (const attachment of attachmentsRef.current) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    setAttachments([]);
    onChange?.();
  }

  return {
    attachments,
    addFiles,
    clearFiles,
    files: attachments.map((attachment) => attachment.file),
    processing,
    removeFile,
    replaceFile,
  };
}
