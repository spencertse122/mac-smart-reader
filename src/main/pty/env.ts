const UTF8 = /utf-?8/i

// Environment for the terminal's shell. Apps started from Finder/Dock get no LANG/LC_* from launchd
// (Terminal.app sets them itself), so without this zsh runs in the C locale and mangles non-ASCII text.
export function ptyEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SmartReader' })
  // LC_ALL overrides LC_CTYPE, which overrides LANG
  const effective = env.LC_ALL || env.LC_CTYPE || env.LANG
  if (effective && UTF8.test(effective)) return env
  if (env.LC_ALL) delete env.LC_ALL
  if (env.LC_CTYPE) delete env.LC_CTYPE
  if (!env.LANG || !UTF8.test(env.LANG)) env.LANG = 'en_US.UTF-8'
  return env
}
