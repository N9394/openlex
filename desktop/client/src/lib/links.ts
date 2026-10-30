// Links the App opens in the browser. One place, so they are easy to change.

/** "Set it up for me (book a call)". A dedicated setup event will replace this link later. */
export const SETUP_CALL_URL = 'https://calendly.com/nicolas-jansa'

const DOCS = 'https://github.com/N9394/openlex/blob/main/docs/guides'
export const GUIDES_URL = `${DOCS}/README.md`
export const CLOUD_KEY_GUIDE_URL = `${DOCS}/cloud-key.md`
export const TROUBLESHOOTING_URL = `${DOCS}/troubleshooting.md`

export function openLink(url: string) {
  const b = (window as any).lexvault?.openExternal
  if (b) b(url)
  else window.open(url, '_blank', 'noopener')
}
