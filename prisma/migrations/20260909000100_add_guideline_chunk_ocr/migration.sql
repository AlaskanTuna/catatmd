-- Scanned CPG pages are OCRed; the flag lets the UI say so beside a citation.
ALTER TABLE "guideline_chunk" ADD COLUMN "ocr" BOOLEAN NOT NULL DEFAULT false;
