import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';

// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function convertPdfToImages(file: File): Promise<File[]> {
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

  for (let i = 1; i <= numPages; i++) {
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
            ? file.name.replace(/\.pdf$/i, `_page_${i}.png`)
            : file.name.replace(/\.pdf$/i, '.png');
          const imgFile = new File([blob], fileName, {
            type: 'image/png',
            lastModified: Date.now(),
          });
          resolve(imgFile);
        } else {
          reject(new Error('Could not convert canvas to blob'));
        }
      }, 'image/png');
    });
    
    imageFiles.push(imageFile);
  }
  
  return imageFiles;
}
