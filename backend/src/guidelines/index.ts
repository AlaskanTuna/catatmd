export {
  CITABLE_DOCUMENT_IDS,
  type CitableDocumentId,
  corpusIdsFor,
  documentRef,
  GUIDELINE_CORPUS_VERSION,
  parseDocumentRef,
} from './documents.js'
export { modernizeCitationId, withLegacyCitations } from './legacy.js'
export { serialiseCorpusForPrompt } from './prompt.js'
