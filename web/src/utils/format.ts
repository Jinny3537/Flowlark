import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
dayjs.extend(relativeTime);
let dateStyle = 'relative';
export function setDateStyle(value?: string) { dateStyle = value === 'absolute' ? 'absolute' : 'relative'; }

export function fmtTime(value?: string | number | Date | null) {
  if (!value) return '-';
  const d = dayjs(value);
  return d.isValid() ? (dateStyle === 'absolute' ? d.format('YYYY-MM-DD HH:mm') : d.locale('zh-cn').fromNow()) : String(value);
}

export function textOf(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export function fmtAbsolute(value?: string | number | Date | null) {
  if (!value) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(value);
}

export function fmtSize(bytes?: number | null) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
