// A page of the old desktop server that moved into the chat. Old links
// (bookmarks, an older Word pane, a notification) land here: one plain
// sentence and a button that opens the chat with the command.
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'

export default function Moved({ command, what }: { command: string; what: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="p-10 max-w-xl mx-auto text-center space-y-4" data-testid="moved-note">
      <h1 className="font-serif text-2xl text-parchment">{t('moved.title', '{{what}} moved to the chat', { what })}</h1>
      <p className="text-antique">{t('moved.body', 'Type /{{command}} in the chat — it works there with your matter, your documents and every export.', { command })}</p>
      <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => navigate('/research', { state: { command } })}>
        <MessageSquare size={16} /> {t('moved.open', 'Open the chat with /{{command}}', { command })}
      </button>
    </div>
  )
}
