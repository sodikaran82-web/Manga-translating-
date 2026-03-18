import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';

// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfConversionOptions {
  pages?: number[]; // Array of page numbers to convert (1-indexed). If undefined, convert all.
  format?: 'image/png' | 'image/jpeg';
}

export async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const pdf = await getDocument({ 
    data: uint8Array,
    cMapUrl: `https://unpkg.com/pdfjs-dist@${version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${version}/standard_fonts/`,
  }).promise;
  return pdf.numPages;
}

export async function convertPdfToImages(file: File, options?: PdfConversionOptions): Promise<File[]> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const pdf = await getDocument({ 
    data: uint8Array,
    cMapUrl: `https://unpkg.com/pdfjs-dist@${version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${version}/standard_fonts/`,
  }).promise;
  
  const numPages = pdf.numPages;
  const imageFiles: File[] = [];
  
  const pagesToConvert = options?.pages && options.pages.length > 0 
    ? options.pages.filter(p => p >= 1 && p <= numPages)
    : Array.from({ length: numPages }, (_, i) => i + 1);
    
  if (pagesToConvert.length === 0) {
    throw new Error(`No valid pages selected. The PDF has ${numPages} page(s).`);
  }
    
  const outputFormat = options?.format || 'image/png';
  const fileExtension = outputFormat === 'image/jpeg' ? '.jpg' : '.png';

  for (const i of pagesToConvert) {
    const page = await pdf.getPage(i);
    
    // Set scale for good quality
    const scale = 2.0;
    const viewport = page.getViewport({ scale });
    
    // Prepare canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error('Could not create canvas context');
    }
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    // Fill with white background to prevent transparent areas becoming black in JPEG
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Render PDF page into canvas context
    const renderContext: any = {
      canvasContext: context,
      viewport: viewport,
      background: 'white'
    };
    
    await page.render(renderContext).promise;
    
    // Convert canvas to blob
    const imageFile = await new Promise<File>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const fileName = numPages > 1 
            ? file.name.replace(/\.pdf$/i, `_page_${i}${fileExtension}`)
            : file.name.replace(/\.pdf$/i, fileExtension);
          const imgFile = new File([blob], fileName, {
            type: outputFormat,
            lastModified: Date.now(),
          });
          resolve(imgFile);
        } else {
          reject(new Error('Could not convert canvas to blob'));
        }
      }, outputFormat, outputFormat === 'image/jpeg' ? 0.92 : undefined);
    });
    
    imageFiles.push(imageFile);
  }
  
  return imageFiles;
}
