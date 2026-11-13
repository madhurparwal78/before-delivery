/** One CSV cell: text beginning with =, +, -, @, tab or CR is neutralised with a leading quote; numbers are never changed. */
function csvCell(value: string | number): string {
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const csvText = (lines: (string | number)[][]): string => lines.map((line) => line.map(csvCell).join(',') + '\n').join('')
