import { useState } from 'react'
import { Cookie } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BrowserProfileImportDialog } from './BrowserProfileImportDialog'

export function BrowserProfileImport() {
  const api = window.jaz?.browserProfiles
  const [open, setOpen] = useState(false)
  if (!api) {
    return null
  }
  return <>
    <Button className="min-h-10" onClick={() => setOpen(true)}><Cookie size={15} />Import cookies and passwords</Button>
    {open ? <BrowserProfileImportDialog api={api} onClose={() => setOpen(false)} /> : null}
  </>
}
