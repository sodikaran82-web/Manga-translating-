import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Camera, Loader2, FileText, Settings2 } from 'lucide-react';
import { convertPdfToImages, getPdfPageCount } from '../utils/pdfToImage';

interface ImageUploaderProps {
  onImagesSelected: (files: File[]) => void;
}

export function ImageUploader({ onImagesSelected }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [pdfQueue, setPdfQueue] = useState<{file: File, numPages: number}[]>([]);
  const [currentPdf, setCurrentPdf] = useState<{file: File, numPages: number} | null>(null);
  const [pdfPageInput, setPdfPageInput] = useState('');
  const [pdfFormat, setPdfFormat] = useState<'image/png' | 'image/jpeg'>('image/jpeg');
  const [accumulatedFiles, setAccumulatedFiles] = useState<File[]>([]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setIsConverting(true);
    const nonPdfs: File[] = [];
    const pdfs: {file: File, numPages: number}[] = [];

    try {
      for (const file of files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          try {
            const numPages = await getPdfPageCount(file);
            pdfs.push({file, numPages});
          } catch (pdfErr: any) {
            console.error('PDF parsing failed:', pdfErr);
            setErrorMsg(`Failed to parse PDF: ${pdfErr.message || pdfErr}`);
          }
        } else {
          nonPdfs.push(file);
        }
      }

      if (pdfs.length > 0) {
        setAccumulatedFiles(nonPdfs);
        setPdfQueue(pdfs);
        setCurrentPdf(pdfs[0]);
        setPdfPageInput('');
        setIsConverting(false);
      } else {
        onImagesSelected(nonPdfs);
        setIsConverting(false);
      }
    } catch (error) {
      console.error('Error processing files:', error);
      setErrorMsg('Failed to process some files. Please try again.');
      setIsConverting(false);
    } finally {
      // Reset the inputs so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handlePdfOptionsConfirm = async () => {
    if (!currentPdf) return;
    
    setIsConverting(true);
    
    // Parse page input
    let pagesToConvert: number[] | undefined = undefined;
    if (pdfPageInput.trim()) {
      pagesToConvert = [];
      const parts = pdfPageInput.split(',');
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(s => parseInt(s.trim()));
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            for (let i = start; i <= end; i++) {
              pagesToConvert.push(i);
            }
          }
        } else {
          const page = parseInt(part.trim());
          if (!isNaN(page)) {
            pagesToConvert.push(page);
          }
        }
      }
      // Remove duplicates and sort
      pagesToConvert = Array.from(new Set(pagesToConvert)).sort((a, b) => a - b);
      
      if (pagesToConvert.length === 0) {
        setErrorMsg('Invalid page selection. Please enter valid page numbers (e.g., 1-5, 8).');
        setIsConverting(false);
        return;
      }
    }
    
    try {
      const imageFiles = await convertPdfToImages(currentPdf.file, {
        pages: pagesToConvert,
        format: pdfFormat
      });
      
      const newAccumulated = [...accumulatedFiles, ...imageFiles];
      
      const nextQueue = pdfQueue.slice(1);
      if (nextQueue.length > 0) {
        setAccumulatedFiles(newAccumulated);
        setPdfQueue(nextQueue);
        setCurrentPdf(nextQueue[0]);
        setPdfPageInput('');
        setIsConverting(false);
      } else {
        onImagesSelected(newAccumulated);
        setAccumulatedFiles([]);
        setPdfQueue([]);
        setCurrentPdf(null);
        setIsConverting(false);
      }
    } catch (pdfErr: any) {
      console.error('PDF conversion failed:', pdfErr);
      setErrorMsg(`Failed to convert PDF: ${pdfErr.message || pdfErr}`);
      setIsConverting(false);
    }
  };
  
  const handlePdfOptionsSkip = () => {
    const nextQueue = pdfQueue.slice(1);
    if (nextQueue.length > 0) {
      setPdfQueue(nextQueue);
      setCurrentPdf(nextQueue[0]);
      setPdfPageInput('');
    } else {
      if (accumulatedFiles.length > 0) {
        onImagesSelected(accumulatedFiles);
      }
      setAccumulatedFiles([]);
      setPdfQueue([]);
      setCurrentPdf(null);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors relative overflow-hidden">
      <AnimatePresence>
        {isConverting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center z-10 rounded-2xl"
          >
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
            <p className="text-sm font-medium text-gray-600">Processing PDF...</p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col items-center justify-center pt-5 pb-6 space-y-4">
        <div className="flex space-x-4">
          <motion.button
            whileHover={{ scale: 1.05, borderColor: '#6366f1' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center w-24 h-24 bg-white rounded-xl shadow-sm border border-gray-200 hover:text-indigo-600 transition-all"
          >
            <Upload className="w-8 h-8 mb-2 text-gray-500" />
            <span className="text-xs font-medium text-gray-600">Gallery</span>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05, borderColor: '#6366f1' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center w-24 h-24 bg-white rounded-xl shadow-sm border border-gray-200 hover:text-indigo-600 transition-all"
          >
            <Camera className="w-8 h-8 mb-2 text-gray-500" />
            <span className="text-xs font-medium text-gray-600">Camera</span>
          </motion.button>
        </div>
        <p className="text-sm text-gray-500">Select manga pages or PDFs to translate</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,application/pdf,.pdf"
        multiple
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />

      <AnimatePresence>
        {currentPdf && !isConverting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col space-y-5"
            >
              <div className="flex items-center space-x-3 text-indigo-600">
                <FileText className="w-6 h-6" />
                <h3 className="text-lg font-semibold text-gray-900">PDF Import Options</h3>
              </div>
              
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">File: <span className="font-normal text-gray-500">{currentPdf.file.name}</span></p>
                  <p className="text-sm font-medium text-gray-700">Total Pages: <span className="font-normal text-gray-500">{currentPdf.numPages}</span></p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="pages" className="block text-sm font-medium text-gray-700">
                    Pages to Convert
                  </label>
                  <input
                    type="text"
                    id="pages"
                    value={pdfPageInput}
                    onChange={(e) => setPdfPageInput(e.target.value)}
                    placeholder="e.g., 1-5, 8, 11-13 (Leave blank for all)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  <p className="text-xs text-gray-500">Leave blank to convert all pages.</p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="format" className="block text-sm font-medium text-gray-700">
                    Output Format
                  </label>
                  <select
                    id="format"
                    value={pdfFormat}
                    onChange={(e) => setPdfFormat(e.target.value as 'image/png' | 'image/jpeg')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  >
                    <option value="image/jpeg">JPEG (Smaller file size, faster)</option>
                    <option value="image/png">PNG (Higher quality, larger file size)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-gray-100">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handlePdfOptionsSkip}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  Skip File
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handlePdfOptionsConfirm}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
                >
                  <Settings2 className="w-4 h-4" />
                  <span>Convert</span>
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {errorMsg && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col space-y-4"
            >
              <h3 className="text-lg font-semibold text-gray-900">Error</h3>
              <p className="text-gray-600">{errorMsg}</p>
              <div className="flex justify-end pt-2">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setErrorMsg(null)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
                >
                  Close
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
