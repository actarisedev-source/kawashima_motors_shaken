"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MonthlyReservationSummary } from "@/lib/reservations/monthly-counts";
import { adminCalendarReservationCountDotClassNames } from "./shared/admin-date-calendar-modal";

type TooltipPosition = {
  left: number;
  top: number;
};

const VIEWPORT_PADDING = 8;
const TOOLTIP_GAP = 8;

export function MonthlyReservationSummaryCard({
  summary,
}: {
  summary: MonthlyReservationSummary;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
  });
  const tooltipOpen = isHovered || isPinned;
  const tooltipId = `monthly-summary-${summary.key}`;

  const updateTooltipPosition = useCallback(() => {
    const button = buttonRef.current;
    const tooltip = tooltipRef.current;

    if (!button || !tooltip) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const spaceAbove = buttonRect.top - VIEWPORT_PADDING;
    const spaceBelow =
      window.innerHeight - buttonRect.bottom - VIEWPORT_PADDING;
    const showAbove =
      spaceAbove >= tooltipRect.height + TOOLTIP_GAP ||
      spaceAbove >= spaceBelow;
    const preferredTop = showAbove
      ? buttonRect.top - tooltipRect.height - TOOLTIP_GAP
      : buttonRect.bottom + TOOLTIP_GAP;
    const maxTop = Math.max(
      VIEWPORT_PADDING,
      window.innerHeight - tooltipRect.height - VIEWPORT_PADDING,
    );
    const maxLeft = Math.max(
      VIEWPORT_PADDING,
      window.innerWidth - tooltipRect.width - VIEWPORT_PADDING,
    );

    setTooltipPosition({
      left: Math.min(
        Math.max(
          buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2,
          VIEWPORT_PADDING,
        ),
        maxLeft,
      ),
      top: Math.min(Math.max(preferredTop, VIEWPORT_PADDING), maxTop),
    });
  }, []);

  useLayoutEffect(() => {
    if (tooltipOpen) {
      updateTooltipPosition();
    }
  }, [tooltipOpen, updateTooltipPosition]);

  useEffect(() => {
    if (!tooltipOpen) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !buttonRef.current?.contains(event.target)
      ) {
        setIsPinned(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHovered(false);
        setIsPinned(false);
      }
    };

    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tooltipOpen, updateTooltipPosition]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-controls={tooltipId}
        aria-expanded={tooltipOpen}
        onMouseEnter={() => {
          updateTooltipPosition();
          setIsHovered(true);
        }}
        onMouseLeave={() => setIsHovered(false)}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") {
            updateTooltipPosition();
            setIsPinned((current) => !current);
          }
        }}
        onClick={(event) => {
          if (event.detail === 0) {
            updateTooltipPosition();
            setIsPinned((current) => !current);
          }
        }}
        className="flex min-h-[78px] w-full cursor-pointer flex-col items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <span className="text-sm font-semibold text-slate-600">
          {summary.label}
        </span>
        <span className="mt-1 flex items-baseline justify-center text-blue-600">
          <span className="text-2xl font-bold leading-none">
            {summary.count}
          </span>
          <span className="ml-0.5 text-xs font-semibold text-slate-700">
            件
          </span>
        </span>
      </button>
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        aria-hidden={!tooltipOpen}
        style={tooltipPosition}
        className={`pointer-events-none fixed z-50 w-48 max-w-[calc(100vw-1rem)] rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg transition-opacity ${
          tooltipOpen ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-slate-900">
          {summary.label}予約状況
        </p>
        <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
          <dt className="inline-flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${adminCalendarReservationCountDotClassNames.accepting}`}
              aria-hidden="true"
            />
            受付中
          </dt>
          <dd className="text-right font-semibold">{summary.accepting}件</dd>
          <dt className="inline-flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${adminCalendarReservationCountDotClassNames.confirmed}`}
              aria-hidden="true"
            />
            確認済
          </dt>
          <dd className="text-right font-semibold">{summary.confirmed}件</dd>
          <dt className="inline-flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full bg-slate-400"
              aria-hidden="true"
            />
            完了
          </dt>
          <dd className="text-right font-semibold">{summary.completed}件</dd>
          <dt className="mt-1 border-t border-slate-200 pt-2 font-semibold text-slate-900">
            合計
          </dt>
          <dd className="mt-1 border-t border-slate-200 pt-2 text-right font-bold text-slate-900">
            {summary.count}件
          </dd>
        </dl>
      </div>
    </div>
  );
}
