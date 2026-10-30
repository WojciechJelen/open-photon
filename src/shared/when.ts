// How the pages say when something happened. Pure, client-safe and loadable by Node.

/** `at` in the reader's time: "Today at 1:15 PM", "Yesterday at…", else its date and time. */
export function dayAndTime(at: string, now = new Date()) {
  const started = new Date(at);
  const time = started.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const midnight = (date: Date) => new Date(date).setHours(0, 0, 0, 0);
  // Rounded: a day with a clock change is not 24 hours long.
  const days = Math.round((midnight(now) - midnight(started)) / 86_400_000);

  if (days < 2) {
    return `${days === 0 ? "Today" : "Yesterday"} at ${time}`;
  }

  const date = started.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: started.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });

  return `${date} at ${time}`;
}
