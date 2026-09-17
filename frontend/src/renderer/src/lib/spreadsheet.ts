import { read, utils, type WorkSheet } from 'xlsx'

export function readSpreadsheet(data: ArrayBuffer) {
  return read(data, { type: 'array', dense: true, raw: true, sheetRows: 1001 })
}

export function spreadsheetRows(sheet: WorkSheet): string[][] {
  return utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true })
}
