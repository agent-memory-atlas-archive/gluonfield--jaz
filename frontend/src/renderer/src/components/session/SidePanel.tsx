import type { Attachment, QueuedAction, Session, SessionEvent } from '@/lib/api/types'
import type { BrowserAnnotation } from '@/lib/messageContext'
import type { ProviderSubagentView } from '@/lib/providerSubagents'
import { BrowserPanelSlot } from '@/components/browser/BrowserWorkspace'
import type { SendMessageHandler, SendMessageOptions } from '@/lib/sendMessage'
import type { SpawnedThreadView } from '@/lib/spawnedThreads'
import type { TaskSurface } from '@/lib/taskSurface'
import { CodeDiffPanel } from '@/components/session/CodeDiffPanel'
import { FileReaderPanel } from '@/components/session/FileReaderPanel'
import { OverviewPanel } from '@/components/session/OverviewPanel'
import { SideChatPanel } from '@/components/session/SideChatPanel'
import { TerminalPanel } from '@/components/session/TerminalPanel'
import { SidePanelTabMenu } from '@/components/session/SidePanelTabs'
import type { useSidePanelState } from '@/components/session/SidePanelState'

export function SidePanel({
  session, panel, progress, subagents, spawnedThreads, working,
  sideChatAvailable, sideChatEvents, onAddBrowserAnnotation, onUploadAttachment,
  onSend, onQueuePrompt, onQueueAction, onSendSideChat,
}: {
  session: Session
  panel: ReturnType<typeof useSidePanelState>
  progress?: TaskSurface
  subagents: ProviderSubagentView[]
  spawnedThreads: SpawnedThreadView[]
  working: boolean
  sideChatAvailable: boolean
  sideChatEvents: SessionEvent[]
  onAddBrowserAnnotation?: (annotation: BrowserAnnotation, screenshot?: Attachment) => void
  onUploadAttachment?: (file: File) => Promise<Attachment>
  onSend: SendMessageHandler
  onQueuePrompt: SendMessageHandler
  onQueueAction: (action: QueuedAction, label: string) => Promise<void>
  onSendSideChat: (sideChatID: string, message: string, options?: SendMessageOptions) => Promise<void>
}) {
  return (
    <>
      {panel.open && panel.mode === 'overview' ? (
        <OverviewPanel
          session={session}
          progress={progress}
          subagents={subagents}
          spawnedThreads={spawnedThreads}
          working={working}
          onSend={onSend}
          onQueuePrompt={onQueuePrompt}
          onQueueAction={onQueueAction}
        />
      ) : null}
      <div hidden={panel.mode !== 'tabs'} className="h-full p-2" data-thread-find-shortcuts="off">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] bg-surface shadow-sm">
          <div className="relative flex min-h-0 flex-1 flex-col">
            {!panel.tabs.length ? <SidePanelTabMenu empty sideChatAvailable={sideChatAvailable} onAdd={panel.addTab} /> : null}
            {panel.tabs.map((tab) => {
              const active = panel.activeTab?.id === tab.id
              const visible = panel.open && panel.mode === 'tabs' && active
              return (
                <div
                  key={tab.id}
                  id={`panel-body-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={`panel-tab-${tab.id}`}
                  hidden={!active}
                  inert={!visible}
                  className="h-full min-h-0"
                >
                  {tab.kind === 'preview' ? (
                    <BrowserPanelSlot
                      sessionId={tab.id}
                      visible={visible}
                      embedded
                      onAddBrowserAnnotation={onAddBrowserAnnotation}
                      onUploadAttachment={onUploadAttachment}
                    />
                  ) : tab.kind === 'terminal' ? (
                    <TerminalPanel session={session} visible={visible} />
                  ) : tab.kind === 'file' ? (
                    <FileReaderPanel sessionId={session.id} fileRef={tab.file} visible={visible} onOpenFile={panel.openFile} />
                  ) : tab.kind === 'diff' ? (
                    <CodeDiffPanel sessionId={session.id} visible={visible} />
                  ) : (
                    <SideChatPanel
                      sessionId={session.id}
                      events={sideChatEvents}
                      visible={visible}
                      fileRoot={session.runtime_ref?.cwd}
                      onUploadAttachment={onUploadAttachment}
                      onSend={onSendSideChat}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
