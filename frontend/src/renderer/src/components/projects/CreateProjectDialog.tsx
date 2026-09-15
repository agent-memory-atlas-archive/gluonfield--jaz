import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ArrowUp, Check, ChevronRight, Folder, FolderPlus, GitBranch, Home, LoaderCircle, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { addProject, createFilesystemDir, listFilesystemDirs, type Project } from '@/lib/api/sessions'
import { keys } from '@/lib/query/keys'

export function CreateProjectDialog({
  initialPath = '',
  onClose,
  onCreated,
}: {
  initialPath?: string
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const queryClient = useQueryClient()
  const pathRef = useRef<HTMLInputElement>(null)
  const newFolderRef = useRef<HTMLButtonElement>(null)
  const [browse, setBrowse] = useState(initialPath)
  const [pathInput, setPathInput] = useState<string | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const dirs = useQuery({
    queryKey: keys.filesystemDirs(browse),
    queryFn: () => listFilesystemDirs(browse),
    retry: false,
  })
  const add = useMutation({
    mutationFn: addProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: keys.projects })
      onCreated(project)
    },
  })
  const createFolder = useMutation({
    mutationFn: ({ parent, name }: { parent: string; name: string }) => createFilesystemDir(parent, name),
    onSuccess: ({ path }) => {
      queryClient.invalidateQueries({ queryKey: keys.filesystemDirs(browse) })
      goTo(path)
    },
  })
  const busy = add.isPending || createFolder.isPending
  const currentPath = dirs.data?.path ?? browse
  const canChoose = dirs.isSuccess && pathInput === null && !busy

  const goTo = (path: string) => {
    if (path === browse) dirs.refetch()
    setBrowse(path)
    setPathInput(null)
    setFolderName(null)
    add.reset()
    createFolder.reset()
    requestAnimationFrame(() => pathRef.current?.focus())
  }

  const cancelFolder = () => {
    setFolderName(null)
    createFolder.reset()
    requestAnimationFrame(() => newFolderRef.current?.focus())
  }

  return (
    <Modal
      open
      chromeless
      title="New project"
      size="md"
      className="h-[440px]"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="flex h-full flex-col">
        <header className="shrink-0 px-5 py-4 pr-14">
          <h2 className="text-sm font-semibold text-ink">New project</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">Jaz server</p>
        </header>
        <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <form
            className="flex shrink-0 items-center gap-1 border-y border-border bg-surface/50 px-2 py-1"
            onSubmit={(event) => {
              event.preventDefault()
              const path = (pathInput ?? currentPath).trim()
              if (path) goTo(path)
            }}
          >
            <Button className="size-10 p-0" aria-label="Workspace folder" title="Workspace folder" onClick={() => goTo('')}>
              <Home size={15} />
            </Button>
            <Button
              className="size-10 p-0"
              aria-label="Parent folder"
              title="Parent folder"
              disabled={!dirs.data?.parent}
              onClick={() => dirs.data && goTo(dirs.data.parent)}
            >
              <ArrowUp size={15} />
            </Button>
            <input
              ref={pathRef}
              aria-label="Project directory"
              className="h-8 min-w-0 flex-1 rounded-[6px] bg-bg px-2 font-mono text-[11px] text-ink-2 outline-none ring-1 ring-border transition-[box-shadow] duration-150 focus:ring-primary/60"
              value={pathInput ?? currentPath}
              placeholder="Directory path"
              spellCheck={false}
              onChange={(event) => setPathInput(event.target.value)}
            />
            <Button type="submit" className="size-10 p-0" aria-label="Go to folder" title="Go to folder">
              <ArrowRight size={15} />
            </Button>
          </form>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-gutter:stable]" aria-label="Folders" aria-busy={dirs.isFetching}>
            {folderName !== null ? (
              <form
                data-escape-surface=""
                className="flex h-11 items-center gap-1 rounded-control bg-surface pl-2.5 pr-1"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  cancelFolder()
                }}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (canChoose && folderName.trim()) createFolder.mutate({ parent: currentPath, name: folderName })
                }}
              >
                <FolderPlus size={16} className="mr-1 shrink-0 text-primary" />
                <Input
                  autoFocus
                  aria-label="New folder name"
                  placeholder="Folder name"
                  className="h-8 min-w-0 flex-1"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
                <Button type="submit" className="size-10 p-0" aria-label="Create folder" title="Create folder" disabled={!canChoose || !folderName.trim()}>
                  {createFolder.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={16} />}
                </Button>
                <Button className="size-10 p-0" aria-label="Cancel new folder" title="Cancel new folder" onClick={cancelFolder}>
                  <X size={15} />
                </Button>
              </form>
            ) : null}
            {add.error || createFolder.error ? (
              <p role="alert" className="break-words px-2.5 py-2 text-[12px] text-danger">{(add.error ?? createFolder.error)?.message}</p>
            ) : null}
            {dirs.isPending ? (
              <div role="status" className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-3">
                <LoaderCircle size={15} className="animate-spin" />
                Loading folders…
              </div>
            ) : dirs.isError ? (
              <p role="alert" className="break-words px-2.5 py-2 text-[12px] text-danger">{dirs.error.message}</p>
            ) : dirs.data.dirs.length ? (
              dirs.data.dirs.map((dir) => (
                <button
                  key={dir.path}
                  type="button"
                  onClick={() => goTo(dir.path)}
                  title={dir.path}
                  className="flex h-10 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px] text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:outline-none"
                >
                  <Folder size={16} className="shrink-0 text-primary/75" />
                  <span className="min-w-0 flex-1 truncate">{dir.name}</span>
                  {dir.git ? <GitBranch size={12} className="shrink-0 text-ink-3" aria-label="git repository" /> : null}
                  <ChevronRight size={13} className="shrink-0 text-ink-3" />
                </button>
              ))
            ) : folderName === null ? (
              <p className="flex h-full items-center justify-center text-[13px] text-ink-3">No subfolders</p>
            ) : null}
          </div>
        </fieldset>
        <footer className="flex shrink-0 items-center justify-between gap-1 border-t border-border px-3 py-2">
          <Button
            ref={newFolderRef}
            size="sm"
            className="h-10"
            disabled={!canChoose || folderName !== null}
            onClick={() => setFolderName('')}
          >
            <FolderPlus size={14} />
            New folder
          </Button>
          <div className="flex gap-1">
            <Button size="sm" className="h-10" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              className="h-10 min-w-[108px]"
              disabled={!canChoose || folderName !== null}
              onClick={() => add.mutate(currentPath)}
            >
              {add.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  )
}
