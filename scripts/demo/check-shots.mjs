import { pathToFileURL } from 'node:url'
import { main } from './record.mjs'

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry === import.meta.url) await main({ record: false })
