export interface DeletionCountdown {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  label: string;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

export function getDeletionCountdown(
  deletionEffectiveAt: string,
  now = Date.now()
): DeletionCountdown {
  const target = Date.parse(deletionEffectiveAt);
  const remainingMs = Number.isFinite(target)
    ? Math.max(0, target - now)
    : 0;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return {
    expired: remainingMs <= 0,
    days,
    hours,
    minutes,
    seconds,
    label: `${days}d ${two(hours)}:${two(minutes)}:${two(seconds)}`
  };
}
