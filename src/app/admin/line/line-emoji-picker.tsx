"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

const recentEmojiStorageKey = "kawashima-line-recent-emojis";
const recentEmojiUpdatedEvent = "kawashima-line-recent-emojis-updated";
const favoriteEmojiStorageKey = "kawashima-line-favorite-emojis";
const favoriteEmojiUpdatedEvent = "kawashima-line-favorite-emojis-updated";
const maxRecentEmojis = 30;
const maxFavoriteEmojis = 30;

type EmojiCategoryId =
  | "favorites"
  | "recent"
  | "faces"
  | "symbols"
  | "schedule"
  | "vehicles"
  | "contact"
  | "nature"
  | "food";

type EmojiCategory = {
  id: Exclude<EmojiCategoryId, "favorites" | "recent">;
  label: string;
  searchKeywords: string[];
  emojis: string[];
};

type EmojiEntry = {
  emoji: string;
  keywords: string[];
};

const emojiList = (value: string) => value.trim().split(/\s+/);

const emojiCategories: EmojiCategory[] = [
  {
    id: "faces",
    label: "😊 顔・感情",
    searchKeywords: [
      "顔",
      "感情",
      "笑顔",
      "スマイル",
      "嬉しい",
      "悲しい",
      "ありがとう",
      "お辞儀",
    ],
    emojis: emojiList(`
      😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌
      😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐
      🤓 😎 🥳 🤩 🥺 🥹 😢 😭 😤 😠 😡 🤬 🤯
      😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🫡 🤭 🫢 🫣
      😶 😐 😑 🙄 😬 😮 😴 🙇 🙏 🤝
    `),
  },
  {
    id: "symbols",
    label: "❤️ ハート・記号",
    searchKeywords: [
      "ハート",
      "記号",
      "気持ち",
      "OK",
      "チェック",
      "警告",
      "矢印",
      "案内",
    ],
    emojis: emojiList(`
      ❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 💔
      ❣️ 💕 💞 💓 💗 💖 💘 💝 💟
      👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉
      👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 🫶 💪
      ✨ ⭐ 🌟 💫 ⚡ 🔥 💥
      ✅ ☑️ ✔️ ❌ ❎ ⭕ 🆗 🆕
      ⚠️ 🚨 ❗ ❕ ❓ ❔ ‼️ ⁉️
      ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↔️ ↕️
    `),
  },
  {
    id: "schedule",
    label: "📅 予定・日付",
    searchKeywords: [
      "予定",
      "日付",
      "予約",
      "カレンダー",
      "時間",
      "時刻",
      "イベント",
      "プレゼント",
    ],
    emojis: emojiList(`
      📅 🗓️ 📆 ⏰ ⌚ ⏱️ ⏲️ 🕰️ ⌛ ⏳
      🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛
      🌅 🌄 🌇 🌆 🌃 🌉
      🎉 🎊 🎈 🎁 🎀 🪅 🪩 🎂 🍰
      🌸 🎏 🎐 🎑 🎃 🎄 🎍 🎎
      📝 📋 📌 📍 🔖 🏷️
    `),
  },
  {
    id: "vehicles",
    label: "🚗 車・整備",
    searchKeywords: [
      "車",
      "自動車",
      "整備",
      "工具",
      "車検",
      "修理",
      "タイヤ",
      "ガソリン",
    ],
    emojis: emojiList(`
      🚗 🚙 🚕 🚖 🚌 🚍 🚎 🚐 🛻 🚚 🚛 🚜
      🏎️ 🚓 🚑 🚒 🚔 🚘 🛵 🏍️ 🛺 🚲
      🛞 ⛽ 🅿️ 🚦 🚥 🛣️ 🛤️ 🏁
      🔧 🪛 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🧰 🧲
      🔋 🪫 💡 🧯 🦺 🥽
      🏭 🏢 🏠 🏪 🧾
    `),
  },
  {
    id: "contact",
    label: "📞 連絡",
    searchKeywords: [
      "連絡",
      "電話",
      "メール",
      "メッセージ",
      "案内",
      "通知",
      "LINE",
      "手紙",
    ],
    emojis: emojiList(`
      📞 ☎️ 📱 📲 📳 📴
      ✉️ 📧 📨 📩 📤 📥 💌
      💬 🗨️ 🗯️ 🗣️ 👤 👥
      📢 📣 🔔 🔕 📯
      📝 ✏️ 🖊️ 🖋️ 🖌️ 🖍️
      📄 📃 📑 📊 📈 📉
      📎 🖇️ 📌 📍 🔗 🌐
      💻 🖥️ ⌨️ 🖱️ 🖨️ 📡
    `),
  },
  {
    id: "nature",
    label: "🌤 天気・自然",
    searchKeywords: [
      "天気",
      "自然",
      "晴れ",
      "雨",
      "雪",
      "季節",
      "花",
      "動物",
    ],
    emojis: emojiList(`
      ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️
      ☔ 💧 💦 🌊 ❄️ ☃️ ⛄ 🌬️ 💨 🌪️ 🌫️
      🌈 ☄️ ⭐ 🌟 🌙 🌛 🌜 🌝 🌞
      🌸 🌷 🌹 🥀 🌺 🌻 🌼 💐
      🌱 🪴 🌲 🌳 🌴 🌵 🌾 🍀 ☘️ 🍁 🍂 🍃
      🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯
      🐦 🐤 🦋 🐞 🐝 🐠
    `),
  },
  {
    id: "food",
    label: "🍴 食べ物・飲み物",
    searchKeywords: [
      "食べ物",
      "飲み物",
      "食事",
      "ランチ",
      "おやつ",
      "果物",
      "料理",
      "ドリンク",
    ],
    emojis: emojiList(`
      🍴 🍽️ 🥢
      🍎 🍏 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒
      🍑 🥭 🍍 🥝 🍅 🥑 🥦 🥒 🌽 🥕
      🥔 🍠 🧅 🧄 🍄
      🍞 🥐 🥖 🥨 🥯 🥞 🧇 🧀
      🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯
      🍳 🍲 🥗 🍿 🧂 🍱 🍙 🍚 🍛 🍜 🍣 🍤
      🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🍫
      ☕ 🍵 🫖 🧃 🥤 🧋 🍺 🍻 🥂 🍷
    `),
  },
];

const emojiKeywordDictionary: Record<string, string[]> = {
  "😊": ["笑顔", "にこにこ", "スマイル"],
  "😂": ["笑い", "大笑い"],
  "🙇": ["お辞儀", "お願いします", "すみません"],
  "🙏": ["お願い", "感謝", "ありがとう"],
  "❤️": ["ハート", "愛", "赤"],
  "👍": ["いいね", "OK", "了解"],
  "👌": ["OK", "オーケー"],
  "🆗": ["OK", "オーケー"],
  "✅": ["OK", "完了", "チェック"],
  "⚠️": ["警告", "注意"],
  "❗": ["重要", "注意"],
  "🎁": ["プレゼント", "贈り物", "ギフト"],
  "📅": ["予約", "日付", "カレンダー"],
  "🗓️": ["予約", "予定", "カレンダー"],
  "⏰": ["時間", "時刻", "アラーム"],
  "🚗": ["車", "自動車", "乗用車"],
  "🛞": ["タイヤ", "車輪"],
  "🔧": ["工具", "整備", "レンチ"],
  "🛠️": ["工具", "整備", "修理"],
  "📞": ["電話", "連絡"],
  "☎️": ["電話", "連絡"],
  "📱": ["電話", "スマホ", "携帯"],
  "📢": ["お知らせ", "案内", "告知"],
  "☀️": ["天気", "晴れ"],
  "☔": ["天気", "雨", "傘"],
  "❄️": ["天気", "雪", "冬"],
  "🌸": ["春", "桜", "花"],
  "🍁": ["秋", "紅葉"],
  "🎄": ["冬", "クリスマス"],
  "🍴": ["食べ物", "食事", "料理"],
  "🍱": ["食べ物", "弁当", "食事"],
  "☕": ["飲み物", "コーヒー"],
};

const categoryTabs: Array<{ id: EmojiCategoryId; label: string }> = [
  { id: "favorites", label: "⭐ お気に入り" },
  { id: "recent", label: "🕒 履歴" },
  ...emojiCategories.map(({ id, label }) => ({ id, label })),
];

const allEmojiEntries = Array.from(
  new Map(
    emojiCategories.flatMap((category) =>
      category.emojis.map((emoji) => [
        emoji,
        {
          emoji,
          keywords: [
            ...category.searchKeywords,
            ...(emojiKeywordDictionary[emoji] ?? []),
          ],
        } satisfies EmojiEntry,
      ]),
    ),
  ).values(),
);

const emojiEntryMap = new Map(
  allEmojiEntries.map((entry) => [entry.emoji, entry]),
);

function parseStoredEmojis(value: string | null, limit: number) {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        ),
      ),
    ).slice(0, limit);
  } catch {
    return [];
  }
}

function toEmojiEntries(emojis: string[]) {
  return emojis.map(
    (emoji) =>
      emojiEntryMap.get(emoji) ?? {
        emoji,
        keywords: [],
      },
  );
}

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
  const emojiListRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const selectionRef = useRef({ start: value.length, end: value.length });
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<EmojiCategoryId>("favorites");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [favoriteEmojis, setFavoriteEmojis] = useState<string[]>([]);

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("ja");
  const displayedEmojis = useMemo(() => {
    if (normalizedSearchQuery) {
      return allEmojiEntries.filter((entry) =>
        entry.keywords.some((keyword) =>
          keyword.toLocaleLowerCase("ja").includes(normalizedSearchQuery),
        ),
      );
    }

    if (activeCategory === "favorites") {
      return toEmojiEntries(favoriteEmojis);
    }
    if (activeCategory === "recent") {
      return toEmojiEntries(recentEmojis);
    }

    const category = emojiCategories.find(
      (item) => item.id === activeCategory,
    );
    return toEmojiEntries(category?.emojis ?? []);
  }, [
    activeCategory,
    favoriteEmojis,
    normalizedSearchQuery,
    recentEmojis,
  ]);

  const activeScrollKey = normalizedSearchQuery
    ? `search:${normalizedSearchQuery}`
    : activeCategory;

  useEffect(() => {
    try {
      setRecentEmojis(
        parseStoredEmojis(
          window.localStorage.getItem(recentEmojiStorageKey),
          maxRecentEmojis,
        ),
      );
      setFavoriteEmojis(
        parseStoredEmojis(
          window.localStorage.getItem(favoriteEmojiStorageKey),
          maxFavoriteEmojis,
        ),
      );
    } catch {
      setRecentEmojis([]);
      setFavoriteEmojis([]);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === recentEmojiStorageKey) {
        setRecentEmojis(
          parseStoredEmojis(event.newValue, maxRecentEmojis),
        );
      }
      if (event.key === favoriteEmojiStorageKey) {
        setFavoriteEmojis(
          parseStoredEmojis(event.newValue, maxFavoriteEmojis),
        );
      }
    };
    const handleRecentEmojiUpdate = (event: Event) => {
      setRecentEmojis(
        (event as CustomEvent<string[]>).detail.slice(0, maxRecentEmojis),
      );
    };
    const handleFavoriteEmojiUpdate = (event: Event) => {
      setFavoriteEmojis(
        (event as CustomEvent<string[]>).detail.slice(0, maxFavoriteEmojis),
      );
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(recentEmojiUpdatedEvent, handleRecentEmojiUpdate);
    window.addEventListener(
      favoriteEmojiUpdatedEvent,
      handleFavoriteEmojiUpdate,
    );
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        recentEmojiUpdatedEvent,
        handleRecentEmojiUpdate,
      );
      window.removeEventListener(
        favoriteEmojiUpdatedEvent,
        handleFavoriteEmojiUpdate,
      );
    };
  }, []);

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

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      if (emojiListRef.current) {
        emojiListRef.current.scrollTop =
          scrollPositionsRef.current[activeScrollKey] ?? 0;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeScrollKey, open]);

  function rememberSelection() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function saveRecentEmojis(emojis: string[]) {
    setRecentEmojis(emojis);
    try {
      window.localStorage.setItem(
        recentEmojiStorageKey,
        JSON.stringify(emojis),
      );
    } catch {
      // The picker remains usable when browser storage is unavailable.
    }
    window.dispatchEvent(
      new CustomEvent<string[]>(recentEmojiUpdatedEvent, {
        detail: emojis,
      }),
    );
  }

  function insertEmoji(emoji: string) {
    if (disabled) return;

    const { start, end } = selectionRef.current;
    const nextValue = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
    if (nextValue.length > maxLength) return;

    const nextCursor = start + emoji.length;
    selectionRef.current = { start: nextCursor, end: nextCursor };
    onValueChange(nextValue);
    saveRecentEmojis(
      [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(
        0,
        maxRecentEmojis,
      ),
    );

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function toggleFavorite(emoji: string) {
    const isFavorite = favoriteEmojis.includes(emoji);
    const nextFavoriteEmojis = isFavorite
      ? favoriteEmojis.filter((item) => item !== emoji)
      : [
          emoji,
          ...favoriteEmojis.filter((item) => item !== emoji),
        ].slice(0, maxFavoriteEmojis);

    setFavoriteEmojis(nextFavoriteEmojis);
    try {
      window.localStorage.setItem(
        favoriteEmojiStorageKey,
        JSON.stringify(nextFavoriteEmojis),
      );
    } catch {
      // The picker remains usable when browser storage is unavailable.
    }
    window.dispatchEvent(
      new CustomEvent<string[]>(favoriteEmojiUpdatedEvent, {
        detail: nextFavoriteEmojis,
      }),
    );
  }

  function handleTextareaKeyUp(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    selectionRef.current = {
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
    };
  }

  const emptyMessage = normalizedSearchQuery
    ? "一致する絵文字がありません。"
    : activeCategory === "favorites"
      ? "お気に入りの絵文字はありません。"
      : "使用履歴はまだありません。";

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
              className="absolute right-0 top-full z-40 mt-2 w-[min(470px,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-3 shadow-lg"
            >
              <label className="sr-only" htmlFor={`${textareaId}-emoji-search`}>
                絵文字を検索
              </label>
              <input
                id={`${textareaId}-emoji-search`}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="絵文字を検索"
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <div
                role="tablist"
                aria-label="絵文字カテゴリ"
                className="mt-2 flex gap-1 overflow-x-auto border-b border-slate-200 pb-2"
              >
                {categoryTabs.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    role="tab"
                    aria-selected={
                      !normalizedSearchQuery &&
                      activeCategory === category.id
                    }
                    onClick={() => {
                      setSearchQuery("");
                      setActiveCategory(category.id);
                    }}
                    className={`shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                      !normalizedSearchQuery &&
                      activeCategory === category.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                    }`}
                  >
                    {category.label}
                  </button>
                ))}
              </div>

              <div
                ref={emojiListRef}
                onScroll={(event) => {
                  scrollPositionsRef.current[activeScrollKey] =
                    event.currentTarget.scrollTop;
                }}
                className="mt-3 grid max-h-72 grid-cols-6 gap-1 overflow-y-auto pr-1 sm:grid-cols-8"
              >
                {displayedEmojis.length ? (
                  displayedEmojis.map(({ emoji }) => {
                    const isFavorite = favoriteEmojis.includes(emoji);
                    return (
                      <div
                        key={emoji}
                        className="relative h-12 w-12 rounded-md hover:bg-blue-50"
                      >
                        <button
                          type="button"
                          title={`${emoji}を挿入`}
                          aria-label={`${emoji}を挿入`}
                          onClick={() => insertEmoji(emoji)}
                          className="grid h-full w-full cursor-pointer place-items-center rounded-md pt-1 text-xl focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
                        >
                          {emoji}
                        </button>
                        <button
                          type="button"
                          title={
                            isFavorite
                              ? "お気に入りから削除"
                              : "お気に入りに追加"
                          }
                          aria-label={`${emoji}を${
                            isFavorite
                              ? "お気に入りから削除"
                              : "お気に入りに追加"
                          }`}
                          aria-pressed={isFavorite}
                          onClick={() => toggleFavorite(emoji)}
                          className={`absolute right-0.5 top-0.5 grid h-4 w-4 cursor-pointer place-items-center rounded text-[11px] leading-none transition-colors ${
                            isFavorite
                              ? "text-amber-500"
                              : "text-slate-300 hover:text-amber-500"
                          }`}
                        >
                          {isFavorite ? "★" : "☆"}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="col-span-full py-8 text-center text-xs font-normal text-slate-500">
                    {emptyMessage}
                  </p>
                )}
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
