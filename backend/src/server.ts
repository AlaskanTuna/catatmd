import { createApp } from './app.js'
import { env } from './config/env.js'

createApp().listen(env.PORT, () => {
  // biome-ignore lint/suspicious/noConsole: startup banner
  console.log(`API listening on :${env.PORT} (${env.NODE_ENV}, llm=${env.LLM_PROVIDER})`)
})
