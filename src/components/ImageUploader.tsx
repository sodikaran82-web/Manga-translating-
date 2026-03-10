import React, { useRef, useState } from 'react';
import { Upload, Camera, Loader2 } from 'lucide-react';
import { convertPdfToImages } from '../utils/pdfToImage';

interface ImageUploaderProps {
  onImagesSelected: (files: File[]) => void;
}

export function ImageUploader({ onImagesSelected }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsConverting(true);
    const processedFiles: File[] = [];

    try {
      for (const file of files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          try {
            const imageFiles = await convertPdfToImages(file);
            processedFiles.push(...imageFiles);
          } catch (pdfErr: any) {
            console.error('PDF conversion failed:', pdfErr);
            setErrorMsg(`Failed to convert PDF: ${pdfErr.message || pdfErr}`);
          }
        } else {
          processedFiles.push(file);
        }
      }
      onImagesSelected(processedFiles);
    } catch (error) {
      console.error('Error processing files:', error);
      setErrorMsg('Failed to process some files. Please try again.');
    } finally {
      setIsConverting(false);
      // Reset the inputs so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors relative">
      {isConverting && (
        <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center z-10 rounded-2xl">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
          <p className="text-sm font-medium text-gray-600">Converting PDF...</p>
        </div>
      )}
      <div className="flex flex-col items-center justify-center pt-5 pb-6 space-y-4">
        <div className="flex space-x-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center w-24 h-24 bg-white rounded-xl shadow-sm border border-gray-200 hover:border-indigo-500 hover:text-indigo-600 transition-all"
          >
            <Upload className="w-8 h-8 mb-2 text-gray-500" />
            <span className="text-xs font-medium text-gray-600">Gallery</span>
          </button>
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center w-24 h-24 bg-white rounded-xl shadow-sm border border-gray-200 hover:border-indigo-500 hover:text-indigo-600 transition-all"
          >
            <Camera className="w-8 h-8 mb-2 text-gray-500" />
            <span className="text-xs font-medium text-gray-600">Camera</span>
          </button>
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

      {errorMsg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Error</h3>
            <p className="text-gray-600">{errorMsg}</p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setErrorMsg(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
