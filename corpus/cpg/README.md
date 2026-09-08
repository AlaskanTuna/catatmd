# CPG Corpus

## What Lives Here

- `manifest.json` tracks every Malaysian CPG document id, title, year, source URL and the local filename the ingest script matched it to.
- `raw/` is gitignored; downloaded PDFs live here while the script processes them.
- The same PDFs are also stored in the private Supabase bucket after ingestion.

## How To Add Documents

1. Download a CPG from the Academy of Medicine portal into `raw/`.
2. Run `bun run corpus:ingest --dry-run` to check extraction and chunking without writes.
3. Run `bun run corpus:ingest` to embed, index and upload.

## How Scanned Pages Are Handled

Pages with fewer than 80 non-whitespace characters are rendered at 200 dpi and OCRed with Tesseract `eng+msa`. Chunks from those pages carry an `ocr` flag that the UI shows beside citations. Recognition errors remain possible, so a scanned page still needs the same clinical review as a typed page.

## Licence Status

Reuse terms for the Academy of Medicine corpus are unconfirmed, tracked in GitHub issue #250. This is a private prototype; nothing in this directory is redistributed.
