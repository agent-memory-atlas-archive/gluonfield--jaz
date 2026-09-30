import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useCreateBot } from '@/components/bots/NewBotPicker'
import { Button } from '@/components/ui/Button'

export const Route = createFileRoute('/bots/')({
  component: BotsIndex,
})

function BotsIndex() {
  const create = useCreateBot()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-sm text-ink-2">Bots keep working on their own, on your schedule.</p>
      <Button variant="primary" size="lg" disabled={create.isPending} onClick={() => create.mutate()}>
        <Plus size={15} />
        New bot
      </Button>
    </div>
  )
}
