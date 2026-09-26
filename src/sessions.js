// The US session in New York time, and the stretches when it is shut.
// Stock tokens trade around the clock; the market that prices them does not.

const NY = "America/New_York";

function nyParts(ts) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: p.weekday };
}

// Unix seconds for a wall-clock time in New York, daylight saving included.
export function nyTime(y, m, d, h, min = 0) {
  let guess = Date.UTC(y, m - 1, d, h, min) / 1000;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(guess);
    const drift = (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) / 1000) - Date.UTC(y, m - 1, d, h, min) / 1000;
    if (!drift) break;
    guess -= drift;
  }
  return guess;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Every close-to-next-open gap between two timestamps. US holidays are not
// modelled: a holiday Monday simply shows up as a longer weekend in the data.
export function closedPeriods(from, to) {
  const out = [];
  let day = nyParts(from);
  let cursor = Date.UTC(day.y, day.m - 1, day.d) / 1000;
  for (; cursor < to + 86400; cursor += 86400) {
    const dt = new Date(cursor * 1000);
    const wd = dt.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const close = nyTime(y, m, d, 16);
    let next = new Date(cursor * 1000 + 86400000);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = new Date(next.getTime() + 86400000);
    const open = nyTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 9, 30);
    if (close < from || open > to) continue;
    out.push({ close, open, kind: open - close > 36 * 3600 ? "weekend" : "night", label: `${WEEKDAY[wd]} ${d} ${dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}` });
  }
  return out;
}

// Is the US market in its regular session right now?
export function marketOpen(ts) {
  const p = nyParts(ts);
  if (p.wd === "Sat" || p.wd === "Sun") return false;
  const mins = p.h * 60 + p.min;
  return mins >= 570 && mins < 960;
}

// The window in which market makers can mint and burn stock tokens:
// Monday 02:00 to Saturday 02:00 Central European time. Outside it, only
// the tokens already out there can trade, so liquidity is thinner.
export function mintWindowOpen(ts) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value]));
  const h = +p.hour % 24;
  if (p.weekday === "Sun") return false;
  if (p.weekday === "Sat") return h < 2;
  if (p.weekday === "Mon") return h >= 2;
  return true;
}

// The regular session that most recently closed before `ts`.
export function lastClose(ts) {
  let t = ts;
  for (let i = 0; i < 8; i++, t -= 86400) {
    const p = nyParts(t);
    if (p.wd === "Sat" || p.wd === "Sun") continue;
    const c = nyTime(p.y, p.m, p.d, 16);
    if (c <= ts) return c;
  }
  return null;
}
