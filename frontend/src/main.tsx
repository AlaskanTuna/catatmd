import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './index.css'
import { ThemeProvider } from './lib/theme.js'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

/*
 * Pull request previews answer `/api` in the browser, installed before the
 * first query can fire. A build without the flag folds this to a resolved
 * promise, and the stub's chunk is never emitted.
 */
const ready =
  import.meta.env.VITE_PREVIEW_STUB === 'true'
    ? import('./preview/stub.js').then(({ installPreviewStub }) => {
        installPreviewStub()
      })
    : Promise.resolve()

void ready.then(() =>
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
)
