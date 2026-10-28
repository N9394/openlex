/**
 * How the terminal app looks, decided once at start (and again when the
 * lawyer changes Settings → Accessibility). No React and no Ink here, so
 * the plain CLI (cli.mjs) can use the same symbols and words.
 *
 * Colours by ROLE only — accent, ok (success), warn, bad (error) — mapped
 * to the 16 colours of the terminal's own theme, so the lawyer's contrast
 * settings apply. An exact amber only with COLORTERM=truecolor and a
 * background we know (COLORFGBG). No colour at all with NO_COLOR, TERM=dumb,
 * when not a terminal, or "Colours: none". Meaning never rests on colour:
 * every coloured mark also has a symbol or a word.
 *
 * Symbols are single-width (✓ ✗ • › … ▸), never emoji; plain ASCII with
 * OPENLEX_ASCII=1 / --ascii, TERM=dumb, the old Windows console or a
 * non-UTF-8 locale.
 *
 * Accessible mode (OPENLEX_ACCESSIBLE=1, INK_SCREEN_READER=true, TERM=dumb,
 * or Settings): no spinners or animation, no borders, labelled lines
 * ("you:", "OpenLex:", "error:"), menus as numbered lists. Reduced motion
 * alone only stops the animation.
 */

const env = process.env

const UNICODE = { clip: '+', pointer: '▸', ok: '✓', bad: '✗', bullet: '•', sep: '·', down: '▾', on: '[x]', off: '[ ]', lock: '[privileged]', mask: '•', bar: '│', prompt: '›', rule: '─', crumb: '›', ell: '…', spin: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], full: '█', empty: '░' }
const ASCII_SYM = { clip: '+', pointer: '>', ok: '+', bad: 'x', bullet: '-', sep: '|', down: 'v', on: '[x]', off: '[ ]', lock: '[privileged]', mask: '*', bar: '|', prompt: '>', rule: '-', crumb: '>', ell: '...', spin: ['*'], full: '#', empty: '-' }

/** The symbols in use (mutated in place by configure, so every importer sees the change). */
export const sym = { ...UNICODE }
/** Role colours (undefined = the terminal's own foreground). */
export const color = { accent: undefined, ok: undefined, warn: undefined, bad: undefined }
/** Everything else decided here. */
export const look = { ascii: false, colorLevel: 0, accessible: false, reducedMotion: false, border: 'round', bell: true }

const truthy = (v) => v !== undefined && v !== '' && v !== '0' && v !== 'false'

/** Non-UTF-8 locale (set, and not UTF-8): the terminal may not draw ✓ or ─. */
function nonUtf8Locale() {
  const l = env.LC_ALL || env.LC_CTYPE || env.LANG
  return !!l && !/utf-?8/i.test(l)
}

/** Light or dark background, from COLORFGBG ("15;0" = light text on black). null = unknown. */
export function background(e = env) {
  const parts = String(e.COLORFGBG || '').split(';')
  const bg = Number(parts[parts.length - 1])
  if (!parts[0] || !Number.isInteger(bg)) return null
  return bg === 7 || bg >= 9 ? 'light' : 'dark'
}

/**
 * Decide the look. prefs: { colours: 'auto'|'none'|'high', ascii, accessible, reducedMotion, bell }.
 * tty: is the output a terminal.
 */
export function configure(prefs = {}, { tty = !!process.stdout.isTTY } = {}) {
  const dumb = env.TERM === 'dumb'
  const conhost = process.platform === 'win32' && !env.WT_SESSION && !env.TERM_PROGRAM && env.ConEmuANSI !== 'ON'
  look.ascii = env.OPENLEX_ASCII === '1' || prefs.ascii === true || (env.OPENLEX_ASCII !== '0' && (dumb || conhost || nonUtf8Locale()))
  look.accessible = truthy(env.OPENLEX_ACCESSIBLE) || env.INK_SCREEN_READER === 'true' || dumb || prefs.accessible === true
  look.reducedMotion = look.accessible || prefs.reducedMotion === true || !tty || truthy(env.OPENLEX_REDUCED_MOTION)
  look.bell = prefs.bell !== false && !look.accessible
  const noColor = (env.NO_COLOR !== undefined && env.NO_COLOR !== '') || dumb || prefs.colours === 'none' || look.accessible
  look.colorLevel = noColor ? 0 : !tty ? 0 : env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' ? 3 : 1
  look.border = look.ascii ? 'classic' : 'round'
  Object.assign(sym, look.ascii ? ASCII_SYM : UNICODE)
  if (!look.colorLevel) Object.assign(color, { accent: undefined, ok: undefined, warn: undefined, bad: undefined })
  else {
    const bg = background()
    // The exact amber only where we know it reads well; otherwise the theme's own yellow.
    const accent = look.colorLevel === 3 && bg && prefs.colours !== 'high' ? (bg === 'dark' ? '#d9a86c' : '#8a5a12') : prefs.colours === 'high' ? 'yellowBright' : 'yellow'
    Object.assign(color, { accent, ok: prefs.colours === 'high' ? 'greenBright' : 'green', warn: prefs.colours === 'high' ? 'yellowBright' : 'yellow', bad: prefs.colours === 'high' ? 'redBright' : 'red' })
  }
  return look
}

configure({}, { tty: !!process.stdout.isTTY || env.OPENLEX_FORCE_TTY === '1' })
