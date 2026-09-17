import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { sessionFileRawUrl } from '@/lib/api/sessions'
import { readAPIResponse } from '@/lib/api/response'
import { keys } from '@/lib/query/keys'
import { readSpreadsheet, spreadsheetRows } from '@/lib/spreadsheet'

export default function SpreadsheetFileView({ sessionId, path, visible }: {
  sessionId: string
  path: string
  visible: boolean
}) {
  const [selected, setSelected] = useState('')
  const file = useQuery({
    queryKey: [...keys.sessionFile(sessionId, path), 'spreadsheet'],
    queryFn: async ({ signal }) => {
      const response = await fetch(sessionFileRawUrl(sessionId, path), { signal })
      if (!response.ok) {
        await readAPIResponse(response)
      }
      return readSpreadsheet(await response.arrayBuffer())
    },
    enabled: visible,
    staleTime: 15_000,
  })
  const name = file.data?.SheetNames.includes(selected) ? selected : file.data?.SheetNames[0]
  const sheet = name ? file.data?.Sheets[name] : undefined
  const rows = useMemo(() => sheet ? spreadsheetRows(sheet) : [], [sheet])
  const columns = rows.reduce((count, row) => Math.max(count, row.length), 0)
  if (file.isPending) {
    return <p className="p-3 text-[12px] text-ink-3">Loading spreadsheet…</p>
  }
  if (file.isError) {
    return <p className="p-3 text-[12px] text-danger">Couldn&apos;t open the file: {file.error.message}</p>
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {file.data.SheetNames.length > 1 ? (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <select aria-label="Worksheet" value={name} onChange={(event) => setSelected(event.target.value)} className="max-w-full rounded bg-surface px-2 py-1 text-[12px] text-ink">
            {file.data.SheetNames.map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>
      ) : null}
      <div className="scrollbar-quiet min-h-0 flex-1 overflow-auto">
        {rows.length ? (
          <table aria-label={name} className="w-full border-separate border-spacing-0 text-[12px] text-ink-2 tabular-nums select-text">
            <tbody>
              {rows.slice(0, 1000).map((row, index) => (
                <tr key={index}>
                  <th scope="row" className="sticky left-0 w-10 border-r border-b border-border bg-surface px-2 py-1.5 text-right font-normal text-ink-3">{index + 1}</th>
                  {Array.from({ length: columns }, (_, column) => (
                    <td key={column} className="max-w-96 min-w-24 border-r border-b border-border px-3 py-1.5 align-top whitespace-pre-wrap break-words">{row[column]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-3 text-[12px] text-ink-3">Empty worksheet.</p>}
      </div>
      {rows.length > 1000 || sheet?.['!fullref'] ? <p className="border-t border-border px-3 py-2 text-[12px] text-ink-3">Showing the first 1,000 rows.</p> : null}
    </div>
  )
}
