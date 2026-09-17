import { expect, test } from 'bun:test'
import { utils, write } from 'xlsx'
import { readSpreadsheet, spreadsheetRows } from './spreadsheet'

test('CSV preserves quoted newlines, leading zeroes and text that resembles dates', () => {
  const file = readSpreadsheet(new TextEncoder().encode('Name,Code,Note\r\n"Motor, large",00123,"line one\nline two"\r\n1-2,00456,plain').buffer)
  expect(spreadsheetRows(file.Sheets[file.SheetNames[0]])).toEqual([
    ['Name', 'Code', 'Note'],
    ['Motor, large', '00123', 'line one\nline two'],
    ['1-2', '00456', 'plain'],
  ])
})

test.each(['xlsx', 'xls'])('%s exposes all sheets and formatted cached values', (bookType) => {
  const book = utils.book_new()
  const sheet = utils.aoa_to_sheet([['Part', 'Cost'], ['Motor', 12.5]])
  sheet.B2.z = '$0.00'
  utils.book_append_sheet(book, sheet, 'BOM')
  utils.book_append_sheet(book, utils.aoa_to_sheet([['Volume'], [500]]), 'Scenarios')
  const loaded = readSpreadsheet(write(book, { type: 'array', bookType }))
  expect(loaded.SheetNames).toEqual(['BOM', 'Scenarios'])
  expect(spreadsheetRows(loaded.Sheets.BOM)[1]).toEqual(['Motor', '$12.50'])
  expect(spreadsheetRows(loaded.Sheets.Scenarios)[1]).toEqual(['500'])
})

test('large CSV previews retain enough data to disclose the row limit', () => {
  const text = Array.from({ length: 2000 }, (_, index) => `${index},value`).join('\n')
  const file = readSpreadsheet(new TextEncoder().encode(text).buffer)
  expect(spreadsheetRows(file.Sheets[file.SheetNames[0]])).toHaveLength(1001)
})
