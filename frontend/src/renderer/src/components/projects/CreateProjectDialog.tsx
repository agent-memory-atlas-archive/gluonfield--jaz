import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ArrowUp, ChevronRight, Folder, FolderPlus, GitBranch, Home, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
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
  }

  return (
    <Modal
      open
      title="New project"
      description="Choose a folder on the Jaz server."
      size="lg"
      onClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button
            className="h-10"
            disabled={!canChoose || folderName !== null}
            onClick={() => setFolderName('')}
          >
            <FolderPlus size={15} />
            New folder
          </Button>
          <div className="flex gap-2">
            <Button className="h-10" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              className="h-10"
              disabled={!canChoose || folderName !== null}
              onClick={() => add.mutate(currentPath)}
            >
              {add.isPending ? <LoaderCircle size={15} className="animate-spin" /> : null}
              Create project
            </Button>
          </div>
        </div>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const path = (pathInput ?? currentPath).trim()
            if (path) goTo(path)
          }}
        >
          <Button className="size-10 p-0" aria-label="Workspace folder" title="Workspace folder" onClick={() => goTo('')}>
            <Home size={16} />
          </Button>
          <Button
            className="size-10 p-0"
            aria-label="Parent folder"
            title="Parent folder"
            disabled={!dirs.data?.parent}
            onClick={() => dirs.data && goTo(dirs.data.parent)}
          >
            <ArrowUp size={16} />
          </Button>
          <Input
            aria-label="Project directory"
            className="h-10 min-w-0 flex-1 font-mono text-[12px]"
            value={pathInput ?? currentPath}
            placeholder="Directory path"
            spellCheck={false}
            onChange={(event) => setPathInput(event.target.value)}
          />
          <Button type="submit" className="size-10 p-0" aria-label="Go to folder" title="Go to folder">
            <ArrowRight size={16} />
          </Button>
        </form>
        <div className="h-64 overflow-y-auto rounded-control bg-surface p-1" aria-label="Folders" aria-busy={dirs.isFetching}>
          {dirs.isPending ? (
            <div role="status" className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-3">
              <LoaderCircle size={15} className="animate-spin" />
              Loading folders…
            </div>
          ) : dirs.isError ? (
            <p role="alert" className="break-words p-3 text-[13px] text-danger">{dirs.error.message}</p>
          ) : dirs.data.dirs.length ? (
            dirs.data.dirs.map((dir) => (
              <button
                key={dir.path}
                type="button"
                onClick={() => goTo(dir.path)}
                title={dir.path}
                className="flex h-10 w-full items-center gap-2.5 rounded-control px-3 text-left text-[13px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:outline-none"
              >
                <Folder size={17} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{dir.name}</span>
                {dir.git ? <GitBranch size={13} className="shrink-0 text-ink-3" aria-label="git repository" /> : null}
                <ChevronRight size={14} className="shrink-0 text-ink-3" />
              </button>
            ))
          ) : (
            <p className="p-3 text-[13px] text-ink-3">No subfolders</p>
          )}
        </div>
        {folderName !== null ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (canChoose && folderName.trim()) createFolder.mutate({ parent: currentPath, name: folderName })
            }}
          >
            <Input
              autoFocus
              aria-label="New folder name"
              placeholder="Folder name"
              className="h-10 min-w-0 flex-1"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
            />
            <Button type="submit" className="h-10" disabled={!canChoose || !folderName.trim()}>
              {createFolder.isPending ? 'Creating…' : 'Create folder'}
            </Button>
            <Button className="h-10" onClick={() => {
              setFolderName(null)
              createFolder.reset()
            }}>Cancel</Button>
          </form>
        ) : null}
        {add.error || createFolder.error ? (
          <p role="alert" className="break-words text-[13px] text-danger">{(add.error ?? createFolder.error)?.message}</p>
        ) : null}
      </fieldset>
    </Modal>
  )
}
