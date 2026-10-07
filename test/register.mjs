/** Register the dev-only `@deepseek-ai/*` resolve hook. Used via `node --import`. */

import { register } from 'node:module'

register('./resolve-dsh.mjs', import.meta.url)
