-- CreateTable
CREATE TABLE "DocChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],

    CONSTRAINT "DocChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocChunk_docId_index_key" ON "DocChunk"("docId", "index");

-- AddForeignKey
ALTER TABLE "DocChunk" ADD CONSTRAINT "DocChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
