"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

const emojiCategories = [
  {
    label: "よく使う",
    emojis: ["😊", "🙇", "🙏", "❤️", "👍", "✨", "📢", "📅", "🚗", "✅", "⚠️", "➡️"],
  },
  {
    label: "顔・感情",
    emojis: ["😊", "😂", "😄", "😃", "🙂", "🙇", "🙏", "👏", "👍", "💕", "❤️", "🎉"],
  },
  {
    label: "記号",
    emojis: ["✅", "☑️", "⚠️", "❗", "❓", "➡️", "⬇️", "⭐", "✨", "⭕", "❌", "💡"],
  },
  {
    label: "予定・連絡",
    emojis: ["📢", "📅", "⏰", "📞", "✉️", "🎁", "🎉", "📍", "📝", "🔔", "📣", "💬"],
  },
  {
    label: "車・整備",
    emojis: ["🚗", "🚙", "🔧", "🛠️", "⚙️", "🔩", "🧰", "🅿️", "⛽", "🚘", "🚐", "🏁"],
  },
] as const;

type LineEmojiPickerProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
};

export function LineEmojiPicker({
  label,
  value,
  onValueChange,
  rows = 10,
  maxLength = 5000,
  className = "",
  disabled = false,
}: LineEmojiPickerProps) {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);

  useEffect(() => {
    selectionRef.current = {
      start: Math.min(selectionRef.current.start, value.length),
      end: Math.min(selectionRef.current.end, value.length),
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        textareaRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function rememberSelection() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function insertEmoji(emoji: string) {
    if (disabled) return;

    const { start, end } = selectionRef.current;
    const nextValue = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
    if (nextValue.length > maxLength) return;

    const nextCursor = start + emoji.length;
    selectionRef.current = { start: nextCursor, end: nextCursor };
    onValueChange(nextValue);

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleTextareaKeyUp(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    selectionRef.current = {
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
    };
  }

  return (
    <div className="grid gap-2 text-sm font-semibold text-slate-700">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={textareaId}>{label}</label>
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">😊</span>
            絵文字
          </button>

          {open ? (
            <div
              role="dialog"
              aria-label="絵文字を選択"
              className="absolute right-0 top-full z-40 mt-2 w-[min(320px,calc(100vw-3rem))] rounded-md border border-slate-200 bg-white p-3 shadow-lg"
            >
              <div
                role="tablist"
                aria-label="絵文字カテゴリ"
                className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-2"
              >
                {emojiCategories.map((category, index) => (
                  <button
                    key={category.label}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === index}
                    onClick={() => setActiveCategory(index)}
                    className={`shrink-0 cursor-pointer px-2 py-1 text-xs font-semibold transition-colors ${
                      activeCategory === index
                        ? "text-blue-700"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-6 gap-1">
                {emojiCategories[activeCategory].emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    title={`${emoji}を挿入`}
                    aria-label={`${emoji}を挿入`}
                    onClick={() => insertEmoji(emoji)}
                    className="grid h-10 w-10 cursor-pointer place-items-center rounded-md text-xl transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        id={textareaId}
        value={value}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        onChange={(event) => {
          onValueChange(event.target.value);
          selectionRef.current = {
            start: event.target.selectionStart,
            end: event.target.selectionEnd,
          };
        }}
        onSelect={rememberSelection}
        onClick={rememberSelection}
        onKeyUp={handleTextareaKeyUp}
        onBlur={rememberSelection}
        className={className}
      />
    </div>
  );
}
