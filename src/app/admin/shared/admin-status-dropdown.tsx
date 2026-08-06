"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type MenuPosition = {
  left: number;
  top: number;
  width: number;
};

type AdminStatusDropdownProps<T extends string> = {
  value: T;
  options: readonly T[];
  disabled?: boolean;
  label: string;
  buttonClassName?: string;
  onChange: (value: T) => void;
};

export function AdminStatusDropdown<T extends string>({
  value,
  options,
  disabled = false,
  label,
  buttonClassName = "",
  onChange,
}: AdminStatusDropdownProps<T>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = `admin-status-listbox-${useId().replaceAll(":", "")}`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.indexOf(value)),
  );
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;

    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportPadding = 8;
    const menuGap = 6;
    const width = Math.max(rect.width, 112);
    const menuHeight = options.length * 40 + 8;
    const hasRoomBelow =
      rect.bottom + menuGap + menuHeight <= window.innerHeight - viewportPadding;
    const canOpenAbove =
      rect.top - menuGap - menuHeight >= viewportPadding;
    const preferredTop =
      !hasRoomBelow && canOpenAbove
        ? rect.top - menuGap - menuHeight
        : rect.bottom + menuGap;
    const top = Math.min(
      Math.max(viewportPadding, preferredTop),
      window.innerHeight - menuHeight - viewportPadding,
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );

    setMenuPosition({ left, top, width });
  }, [options.length]);

  const closeMenu = () => {
    setIsOpen(false);
    setMenuPosition(null);
  };

  const openMenu = (nextIndex = options.indexOf(value)) => {
    if (disabled || !options.length) return;

    setActiveIndex(Math.max(0, nextIndex));
    setIsOpen(true);
  };

  const selectOption = (option: T) => {
    closeMenu();

    if (option !== value) {
      onChange(option);
    }

    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !options.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        const selectedIndex = Math.max(0, options.indexOf(value));
        openMenu(
          event.key === "ArrowDown"
            ? selectedIndex
            : Math.max(0, selectedIndex),
        );
        return;
      }

      setActiveIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + options.length) % options.length;
      });
      return;
    }

    if (event.key === "Home" && isOpen) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End" && isOpen) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();

      if (isOpen) {
        selectOption(options[activeIndex]);
      } else {
        openMenu();
      }
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === "Tab" && isOpen) {
      closeMenu();
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(Math.max(0, options.indexOf(value)));
    }
  }, [isOpen, options, value]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          isOpen ? `${listboxId}-option-${activeIndex}` : undefined
        }
        onClick={() => {
          if (isOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex items-center justify-center outline-none ${buttonClassName}`}
      >
        <span>{value}</span>
        <span
          aria-hidden="true"
          className={`absolute right-2.5 text-[11px] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          ▼
        </span>
      </button>

      {isOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={label}
              style={{
                position: "fixed",
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuPosition.width,
              }}
              className="z-[100] overflow-hidden rounded-lg border border-white/10 bg-zinc-900 p-1 text-sm font-semibold text-white shadow-xl"
            >
              {options.map((option, index) => {
                const isSelected = option === value;
                const isActive = index === activeIndex;

                return (
                  <div
                    key={option}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={`grid h-10 cursor-pointer grid-cols-[16px_1fr] items-center gap-2 rounded-md px-2.5 transition-colors ${
                      isActive ? "bg-zinc-700" : "bg-transparent"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="text-center text-xs font-bold"
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                    <span className="text-left">{option}</span>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
