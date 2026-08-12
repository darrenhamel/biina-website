// Minimal ambient types for pdf-parse (the package ships no declarations).
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info?: unknown;
    metadata?: unknown;
  }
  interface PdfParseOptions {
    pagerender?: (pageData: {
      getTextContent: (opts: unknown) => Promise<{ items: Array<{ str: string }> }>;
    }) => Promise<string> | string;
    max?: number;
  }
  function pdfParse(data: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
