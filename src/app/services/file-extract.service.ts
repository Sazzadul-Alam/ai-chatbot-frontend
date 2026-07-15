import { Injectable } from '@angular/core';

export interface ExtractResult {
  text: string;
  ok: boolean;
  note?: string;
}

/**
 * Extracts readable text from an attached file entirely in the browser, so the
 * model can actually read it and nothing leaves the device. Heavy parsers are
 * lazy-loaded (dynamic import) per file type, so they never touch the initial
 * bundle and only download when a matching file is attached.
 *
 * - text / code / csv / json …  → read directly
 * - .pdf                        → pdfjs-dist
 * - .docx                       → mammoth
 * - .xlsx / .xls                → xlsx (SheetJS)
 * - images (png/jpg/…)          → tesseract.js OCR
 */
@Injectable({ providedIn: 'root' })
export class FileExtractService {
  private readonly MAX_CHARS = 50000;

  private readonly TEXT_EXT = [
    'txt','md','markdown','csv','tsv','json','xml','yaml','yml','log','html','htm',
    'css','js','ts','jsx','tsx','java','py','c','cpp','h','hpp','cs','go','rs','rb',
    'php','sql','sh','bash','ini','conf','env','properties','gradle','kt','swift','r',
  ];

  private ext(file: File): string { return (file.name.split('.').pop() || '').toLowerCase(); }
  private clip(s: string): string {
    return s.length > this.MAX_CHARS ? s.slice(0, this.MAX_CHARS) + '\n…[truncated]' : s;
  }

  async extract(file: File): Promise<ExtractResult> {
    const ext = this.ext(file);
    const type = file.type || '';
    try {
      if (type.startsWith('text/') || type === 'application/json' || this.TEXT_EXT.includes(ext)) {
        return { text: this.clip(await file.text()), ok: true };
      }
      if (ext === 'pdf' || type === 'application/pdf') {
        return { text: this.clip(await this.pdf(file)), ok: true };
      }
      if (ext === 'docx' || type.includes('wordprocessingml')) {
        return { text: this.clip(await this.docx(file)), ok: true };
      }
      if (['xlsx','xls','xlsm'].includes(ext) || type.includes('spreadsheet') || type.includes('ms-excel')) {
        return { text: this.clip(await this.sheet(file)), ok: true };
      }
      if (type.startsWith('image/')) {
        const text = (await this.ocr(file)).trim();
        return text
          ? { text: this.clip(text), ok: true, note: 'read via image OCR' }
          : { text: '', ok: false, note: 'no readable text found in the image' };
      }
      return { text: '', ok: false, note: 'unsupported file type' };
    } catch (e) {
      console.error('[FileExtract] failed for', file.name, e);
      return { text: '', ok: false, note: 'could not be parsed' };
    }
  }

  private async pdf(file: File): Promise<string> {
    const pdfjs: any = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it: any) => ('str' in it ? it.str : '')).join(' ') + '\n\n';
      if (out.length > this.MAX_CHARS) break;
    }
    return out;
  }

  private async docx(file: File): Promise<string> {
    const mammoth: any = await import('mammoth');
    const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return res.value || '';
  }

  private async sheet(file: File): Promise<string> {
    const XLSX: any = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    let out = '';
    for (const name of wb.SheetNames) {
      out += `# Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}\n\n`;
      if (out.length > this.MAX_CHARS) break;
    }
    return out;
  }

  private async ocr(file: File): Promise<string> {
    const Tesseract: any = await import('tesseract.js');
    const recognize = Tesseract.recognize || Tesseract.default?.recognize;
    const { data } = await recognize(file, 'eng');
    return data?.text || '';
  }
}
