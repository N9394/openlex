// Answers as Markdown, with GitHub tables (remark-gfm). A wide table scrolls
// sideways inside its answer (never the page); long words wrap (.prose-custom).
//
// Nothing in an answer loads by itself (prompt injection, lib/safeUrl.ts):
// an image is shown as "[image: host]", raw HTML is not rendered, and links
// open in the browser only on a click, with the full address on hover and a
// question first when the address looks like it carries data.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { hostOf, linkNeedsConfirm, safeHref } from '../lib/safeUrl'
import { openLink } from '../lib/links'

function SafeLink({ href, children, image }: { href?: string; children?: any; image?: boolean }) {
  const { t } = useTranslation()
  // A jump within the answer (footnotes) stays a plain in-page link.
  if (!image && typeof href === 'string' && /^#[\w-]*$/.test(href)) return <a href={href}>{children}</a>
  const url = safeHref(href)
  if (!url) return <span title={href ? String(href) : undefined}>{children}</span>
  const onClick = (e: any) => {
    e.preventDefault()
    if (image || linkNeedsConfirm(url)) {
      const q = t('markdown.confirmOpen', 'This address was written by the AI. Open it in your browser?\n\n{{url}}\n\nCheck it first: an address can carry text from your documents to the site.', { url })
      if (!window.confirm(q)) return
    }
    openLink(url)
  }
  return (
    <a href={url} title={url} onClick={onClick} onAuxClick={(e) => e.preventDefault()} rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" data-host={hostOf(url)}>
      {children}
    </a>
  )
}

function SafeImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation()
  const host = hostOf(String(src || '')) || t('markdown.imageNoHost', 'not loaded')
  const label = `[${t('markdown.image', 'image')}: ${host}]`
  const text = alt ? `${label} ${alt}` : label
  // Never an <img>: the address is shown, not loaded.
  return safeHref(src) ? <SafeLink href={src} image>{text}</SafeLink> : <span title={src ? String(src) : undefined}>{text}</span>
}

const components = {
  table: ({ node: _node, ...props }: any) => <div className="table-wrap"><table {...props} /></div>,
  a: ({ node: _node, href, children }: any) => <SafeLink href={href}>{children}</SafeLink>,
  img: ({ node: _node, src, alt }: any) => <SafeImage src={src} alt={alt} />,
}

export default function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{children}</ReactMarkdown>
}
