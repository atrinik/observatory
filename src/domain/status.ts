export function statusLabel(status: string): string {
  return status
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function statusClass(status: string): string {
  return `status-${status}`;
}
