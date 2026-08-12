const firstLineScheduledHour = 8;
const lastLineScheduledHour = 20;
const lineScheduledTimeStepMinutes = 15;

export const lineScheduledTimeOptions = Array.from(
  {
    length:
      ((lastLineScheduledHour - firstLineScheduledHour) * 60) /
        lineScheduledTimeStepMinutes +
      1,
  },
  (_, index) => {
    const totalMinutes =
      firstLineScheduledHour * 60 + index * lineScheduledTimeStepMinutes;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  },
);

const allowedLineScheduledTimes = new Set(lineScheduledTimeOptions);

export const isAllowedLineScheduledTime = (time: string) =>
  allowedLineScheduledTimes.has(time);
