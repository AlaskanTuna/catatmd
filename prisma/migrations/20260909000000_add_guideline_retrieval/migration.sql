-- Guideline retrieval (#220, #225): CPG documents and their retrievable
-- chunks, searched by Postgres full-text and pgvector cosine similarity.
-- The 1024-dimension width matches Qwen text-embedding-v4 as configured in
-- backend/src/lib/llm/embeddings.ts; changing either means re-embedding.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "guideline_document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "sourceLicence" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT,
    "pageCount" INTEGER NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guideline_document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guideline_chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "embedding" vector(1024),
    "tsv" tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce("heading", '') || ' ' || "text")
    ) STORED,

    CONSTRAINT "guideline_chunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guideline_chunk_documentId_ordinal_idx" ON "guideline_chunk"("documentId", "ordinal");
CREATE INDEX "guideline_chunk_tsv_idx" ON "guideline_chunk" USING GIN ("tsv");
CREATE INDEX "guideline_chunk_embedding_idx" ON "guideline_chunk" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "guideline_chunk" ADD CONSTRAINT "guideline_chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "guideline_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
