type CompositionAwareEvent = Event & {
  isComposing?: boolean;
  keyCode?: number;
};

export function isImeCompositionActive(
  trackedComposition: boolean,
  nativeEvent?: Event | null,
) {
  const event = nativeEvent as CompositionAwareEvent | null | undefined;

  return (
    trackedComposition ||
    event?.isComposing === true ||
    event?.keyCode === 229
  );
}
