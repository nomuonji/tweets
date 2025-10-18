export function cn(
  ...classes: Array<string | undefined | null | false>
): string {
  return classes.filter(Boolean).join(" ");
}

export function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

