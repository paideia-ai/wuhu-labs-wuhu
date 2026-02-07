import { useState } from 'react'
import { Button } from '@wuhu/shadcn/components/button'
import { Textarea } from '@wuhu/shadcn/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wuhu/shadcn/components/select'

export function InputArea({
  isGenerating,
  queueMode,
  onSend,
  onInterrupt,
  onQueueModeChange,
}: {
  isGenerating: boolean
  queueMode: 'steer' | 'followUp'
  onSend: (text: string) => void
  onInterrupt: () => void
  onQueueModeChange: (mode: 'steer' | 'followUp') => void
}) {
  const [prompt, setPrompt] = useState('')

  const handleSend = () => {
    const text = prompt.trim()
    if (!text) return
    onSend(text)
    setPrompt('')
  }

  const buttonLabel = isGenerating
    ? `Queue ${queueMode === 'steer' ? 'Steer' : 'Follow-up'}`
    : 'Send'

  return (
    <div className='border-t p-4'>
      <div className='mb-2 flex items-center gap-2'>
        <Select
          value={queueMode}
          onValueChange={(value) => {
            if (value === 'steer' || value === 'followUp') {
              onQueueModeChange(value)
            }
          }}
        >
          <SelectTrigger className='w-[180px]'>
            <SelectValue placeholder='Queue behavior' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='followUp'>Follow-up</SelectItem>
            <SelectItem value='steer'>Steer</SelectItem>
          </SelectContent>
        </Select>
        {isGenerating && (
          <Button variant='outline' size='sm' onClick={onInterrupt}>
            Interrupt
          </Button>
        )}
      </div>

      <Textarea
        rows={3}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            handleSend()
          }
        }}
        placeholder={isGenerating
          ? 'Queue a steer or follow-up...'
          : 'Send a message...'}
      />
      <div className='mt-2 flex items-center justify-between'>
        <p className='text-xs text-muted-foreground'>
          Enter sends. Shift+Enter inserts a new line.
        </p>
        <Button onClick={handleSend} disabled={!prompt.trim()}>
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}
