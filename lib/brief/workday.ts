const TIME_ZONE = 'America/New_York';
const WORKDAY_HOUR = 4;

type DateParts = { year: number; month: number; day: number; hour: number };

function parts(value: Date): DateParts {
  const result: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(value)) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result as DateParts;
}

function localDate(partsValue: DateParts, dayOffset = 0): DateParts {
  const date = new Date(Date.UTC(partsValue.year, partsValue.month - 1, partsValue.day + dayOffset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: WORKDAY_HOUR };
}

function zonedToUtc(value: DateParts): Date {
  const target = Date.UTC(value.year, value.month - 1, value.day, value.hour);
  let candidate = new Date(target);
  for (let attempt = 0; attempt < 2; attempt++) {
    const observed = parts(candidate);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour);
    candidate = new Date(candidate.getTime() + target - observedAsUtc);
  }
  return candidate;
}

export function workday(now = new Date()) {
  const current = parts(now);
  const date = localDate(current, current.hour < WORKDAY_HOUR ? -1 : 0);
  const previous = localDate(date, -1);
  const key = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  return {
    key,
    day: new Date(key + 'T00:00:00.000Z'),
    start: zonedToUtc(date),
    previousStart: zonedToUtc(previous),
    timeZone: TIME_ZONE
  };
}

export function briefItemKey(kind: string, taskId: number, fingerprint: string | null): string {
  return `${kind}:${taskId}:${fingerprint ?? 'unversioned'}`;
}
