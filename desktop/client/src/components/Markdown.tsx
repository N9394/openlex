// Answers as Markdown, with GitHub tables (remark-gfm). A wide table scrolls
// sideways inside its answer (never the page); long words wrap (.prose-custom).
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components = {
  table: ({ node: _node, ...props }: any) => <div className="table-wrap"><table {...props} /></div>,
  a: ({ node: _node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

export default function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
}
