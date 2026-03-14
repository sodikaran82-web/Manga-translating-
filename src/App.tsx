/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { ImageUploader } from './components/ImageUploader';
import { TranslationOverlay } from './components/TranslationOverlay';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';
import { translateMangaPage, TranslationBlock, TokenUsage } from './utils/geminiService';
import { saveToHistory, HistoryItem } from './utils/historyService';
import { getTranslationMemory, saveToTranslationMemory, saveMultipleToTranslationMemory, clearTranslationMemory } from './utils/translationMemoryService';
import { safeGetItem, safeSetItem } from './utils/storage';
import { compressImage } from './utils/imageCompressor';
import { Loader2, RefreshCw, Languages, AlertCircle, ArrowRight, Download, ChevronLeft, ChevronRight, Trash2, Clock, Archive, Play, Database, Settings, Square, Info } from 'lucide-react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

interface TranslationItem {
  id: string;
  file?: File; // Make file optional for history items
  imageUrl: string;
  status: 'pending' | 'translating' | 'done' | 'error';
  blocks?: TranslationBlock[];
  error?: string;
  usage?: TokenUsage;
}

export default function App() {
  const [items, setItems] = useState<TranslationItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [batchMode, setBatchMode] = useState<'sequential' | 'parallel'>('sequential');
  const [batchSize, setBatchSize] = useState<number>(2);
  const [isBatchTranslating, setIsBatchTranslating] = useState(false);
  const stopBatchRef = useRef(false);
  const [showConfirmClearMemory, setShowConfirmClearMemory] = useState(false);
  
  const [sourceLang, setSourceLang] = useState(() => {
    return safeGetItem('manga_source_lang') || 'Japanese';
  });
  const [targetLang, setTargetLang] = useState(() => {
    return safeGetItem('manga_target_lang') || 'Hindi';
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    return safeGetItem('manga_selected_model') || 'gemini-3-flash-preview';
  });
  const [autoDownload, setAutoDownload] = useState(() => {
    return safeGetItem('manga_auto_download') === 'true';
  });
  const [customPrompt, setCustomPrompt] = useState(() => {
    return safeGetItem('manga_custom_prompt') || '';
  });

  // Save languages and prompt to localStorage when they change
  useEffect(() => {
    safeSetItem('manga_source_lang', sourceLang);
    safeSetItem('manga_target_lang', targetLang);
    safeSetItem('manga_custom_prompt', customPrompt);
  }, [sourceLang, targetLang, customPrompt]);

  // Re-translate all if languages or prompt change
  useEffect(() => {
    if (items.length > 0) {
      setItems(prev => prev.map(item => ({ ...item, status: 'pending', blocks: undefined, error: undefined })));
    }
  }, [sourceLang, targetLang, customPrompt]);

  const handleImagesSelected = (selectedFiles: File[]) => {
    const newItems: TranslationItem[] = selectedFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      imageUrl: URL.createObjectURL(file),
      status: 'pending'
    }));
    
    setItems(prev => [...prev, ...newItems]);
    if (items.length === 0) {
      setCurrentIndex(0);
    }
  };

  const translateItem = async (index: number, currentItem?: TranslationItem): Promise<void> => {
    const item = currentItem || items[index];
    if (!item) return;

    setItems(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], status: 'translating', error: undefined };
      }
      return next;
    });

    try {
      let base64String = '';
      if (item.file) {
        base64String = await compressImage(item.file);
      } else if (item.imageUrl.startsWith('data:image')) {
        base64String = item.imageUrl;
      } else {
        throw new Error("No image data available.");
      }

      const matches = base64String.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        const base64Data = matches[2];
        
        const memory = await getTranslationMemory(sourceLang, targetLang);
        // Limit to 50 most recent entries to save tokens and avoid quota limits
        const recentMemoryEntries = Object.values(memory)
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 50);
          
        const memoryDict = Object.fromEntries(
          recentMemoryEntries.map(entry => [entry.originalText, entry.translatedText])
        );

        const result = await translateMangaPage(base64Data, mimeType, sourceLang, targetLang, customPrompt, memoryDict, selectedModel);
        
        // Save new translations to memory
        await saveMultipleToTranslationMemory(sourceLang, targetLang, result.blocks);

        setItems(prev => {
          const next = [...prev];
          if (next[index]) {
            next[index] = { ...next[index], status: 'done', blocks: result.blocks, usage: result.usage };
          }
          return next;
        });
        
        // Save to history
        saveToHistory({
          id: item.id,
          timestamp: Date.now(),
          imageUrl: base64String,
          sourceLang,
          targetLang,
          blocks: result.blocks,
          usage: result.usage
        });
      } else {
        throw new Error("Failed to read image data.");
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "An error occurred during translation.";
      setItems(prev => {
        const next = [...prev];
        if (next[index]) {
          next[index] = { ...next[index], status: 'error', error: errorMessage };
        }
        return next;
      });
    }
  };

  const handleTranslateAll = async () => {
    const pendingItems = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending' || item.status === 'error');
      
    if (pendingItems.length === 0) return;

    setIsBatchTranslating(true);
    stopBatchRef.current = false;

    if (batchMode === 'sequential') {
      for (const { item, index } of pendingItems) {
        if (stopBatchRef.current) break;
        await translateItem(index, item);
        // Add a delay between requests to help avoid rate limits (15 RPM limit on free tier)
        if (!stopBatchRef.current) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    } else {
      // Parallel mode with concurrency limit
      for (let i = 0; i < pendingItems.length; i += batchSize) {
        if (stopBatchRef.current) break;
        const chunk = pendingItems.slice(i, i + batchSize);
        await Promise.all(chunk.map(async ({ item, index }) => {
          if (stopBatchRef.current) return;
          await translateItem(index, item);
        }));
        // Add a delay between chunks to help avoid rate limits (15 RPM limit on free tier)
        if (!stopBatchRef.current && i + batchSize < pendingItems.length) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    }

    setIsBatchTranslating(false);
    
    // Auto-download if enabled and not stopped manually
    if (!stopBatchRef.current && autoDownload) {
      handleDownloadAll();
    }
  };

  const handleStopBatch = () => {
    stopBatchRef.current = true;
    setIsBatchTranslating(false);
  };

  const handleReset = () => {
    setItems([]);
    setCurrentIndex(0);
  };

  const handleRetry = (index: number) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], status: 'pending', error: undefined };
      return next;
    });
  };

  const handleDeleteBlock = (indexToDelete: number) => {
    setItems(prev => {
      const next = [...prev];
      const currentItem = next[currentIndex];
      if (currentItem && currentItem.blocks) {
        next[currentIndex] = {
          ...currentItem,
          blocks: currentItem.blocks.filter((_, idx) => idx !== indexToDelete)
        };
      }
      return next;
    });
  };

  const handleEditBlock = async (indexToEdit: number, newText: string) => {
    setItems(prev => {
      const next = [...prev];
      const currentItem = next[currentIndex];
      if (currentItem && currentItem.blocks) {
        const newBlocks = [...currentItem.blocks];
        const block = newBlocks[indexToEdit];
        if (block) {
          block.translatedText = newText;
          // Save the edited translation to memory
          saveToTranslationMemory(sourceLang, targetLang, block.originalText, newText).catch(console.error);
        }
        next[currentIndex] = {
          ...currentItem,
          blocks: newBlocks
        };
      }
      return next;
    });
  };

  const handleRemoveImage = (index: number) => {
    setItems(prev => {
      const next = prev.filter((_, idx) => idx !== index);
      return next;
    });
    setCurrentIndex(prev => {
      if (prev >= items.length - 1 && prev > 0) {
        return prev - 1;
      }
      if (prev === index && prev === items.length - 1 && prev > 0) {
        return prev - 1;
      }
      return prev;
    });
  };

  const generateTranslatedCanvas = async (item: TranslationItem): Promise<HTMLCanvasElement | null> => {
    if (!item || !item.imageUrl || !item.blocks) return null;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = item.imageUrl;
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0);

    item.blocks.forEach((block) => {
      const expand = 2;
      const ymin = Math.max(0, block.box_2d[0] - expand);
      const xmin = Math.max(0, block.box_2d[1] - expand);
      const ymax = Math.min(1000, block.box_2d[2] + expand);
      const xmax = Math.min(1000, block.box_2d[3] + expand);

      const x = (xmin / 1000) * canvas.width;
      const y = (ymin / 1000) * canvas.height;
      const w = ((xmax - xmin) / 1000) * canvas.width;
      const h = ((ymax - ymin) / 1000) * canvas.height;

      // Draw rounded rectangle
      const radius = 4;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      
      ctx.fillStyle = 'white';
      ctx.fill();

      ctx.fillStyle = 'black';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      let lines: string[] = [];
      const paddingX = Math.min(12, w * 0.1);
      const paddingY = Math.min(12, h * 0.1);
      
      const textArea = Math.max(0, w - paddingX * 2) * Math.max(0, h - paddingY * 2);
      const originalCharCount = Math.max(1, block.originalText.replace(/\s/g, '').length);
      let estimatedOriginalFontSize = Math.sqrt(textArea / (1.2 * originalCharCount));
      estimatedOriginalFontSize = Math.max(12, Math.min(estimatedOriginalFontSize * 1.2, h / 1.5));
      
      let fontSize = Math.floor(estimatedOriginalFontSize);
      const minFontSize = 8;
      let lineHeight = 0;
      
      while (fontSize >= minFontSize) {
        ctx.font = `bold ${fontSize}px "Comic Neue", Kalam, sans-serif`;
        lineHeight = fontSize * 1.1;
        
        const words = block.translatedText.trim().split(/\s+/);
        let line = '';
        lines = [];
        
        for (let n = 0; n < words.length; n++) {
          const testLine = line + (line ? ' ' : '') + words[n];
          const metrics = ctx.measureText(testLine);
          
          if (metrics.width > w - paddingX * 2 && n > 0) {
            lines.push(line);
            line = words[n];
          } else {
            line = testLine;
          }
        }
        if (line) lines.push(line);
        
        const totalHeight = lines.length * lineHeight;
        
        let maxLineWidth = 0;
        lines.forEach(l => {
            maxLineWidth = Math.max(maxLineWidth, ctx.measureText(l).width);
        });

        if ((totalHeight <= h - paddingY * 2 && maxLineWidth <= w - paddingX * 2) || fontSize === minFontSize) {
          break;
        }
        
        fontSize -= 1;
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.clip();

      const startY = y + h / 2 - ((lines.length - 1) * lineHeight) / 2;
      
      lines.forEach((lineText, i) => {
        ctx.fillText(lineText.trim(), x + w / 2, startY + i * lineHeight);
      });
      
      ctx.restore();
    });

    return canvas;
  };

  const handleDownload = async () => {
    const currentItem = items[currentIndex];
    const canvas = await generateTranslatedCanvas(currentItem);
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    
    // Create PDF
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height]
    });
    
    pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
    pdf.save(`translated_manga_${currentIndex + 1}.pdf`);
  };

  const handleDownloadAll = async () => {
    const doneItems = items.filter(item => item.status === 'done' && item.blocks);
    if (doneItems.length === 0) return;

    setIsDownloadingAll(true);
    try {
      // Create a single PDF with all pages
      let pdf: jsPDF | null = null;

      for (let i = 0; i < doneItems.length; i++) {
        const item = doneItems[i];
        const canvas = await generateTranslatedCanvas(item);
        if (!canvas) continue;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        
        if (!pdf) {
          pdf = new jsPDF({
            orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height]
          });
          pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
        } else {
          pdf.addPage([canvas.width, canvas.height], canvas.width > canvas.height ? 'landscape' : 'portrait');
          pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
        }
      }

      if (pdf) {
        pdf.save('translated_manga_pages.pdf');
      }
    } catch (error) {
      console.error("Failed to download all:", error);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleSelectHistoryItem = (historyItem: HistoryItem) => {
    const newItem: TranslationItem = {
      id: historyItem.id,
      imageUrl: historyItem.imageUrl,
      status: 'done',
      blocks: historyItem.blocks,
      usage: historyItem.usage,
    };
    
    setItems(prev => [...prev, newItem]);
    setCurrentIndex(items.length); // Will be the last item
    setSourceLang(historyItem.sourceLang);
    setTargetLang(historyItem.targetLang);
    setIsHistoryOpen(false);
  };

  const handleClearMemory = async () => {
    await clearTranslationMemory(sourceLang, targetLang);
    setShowConfirmClearMemory(false);
  };

  const currentItem = items[currentIndex];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-12">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Languages className="w-6 h-6 text-indigo-600" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Manga Translator</h1>
          </div>
          <div className="flex items-center space-x-1 sm:space-x-2">
            {items.some(item => item.status === 'done') && (
              <button
                onClick={handleDownloadAll}
                disabled={isDownloadingAll}
                className="p-2 sm:p-3 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Download All"
                title="Download All Translated Pages (PDF)"
              >
                {isDownloadingAll ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Archive className="w-5 h-5" />
                )}
              </button>
            )}
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="p-2 sm:p-3 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="History"
              title="View Translation History"
            >
              <Clock className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowConfirmClearMemory(true)}
              className="p-2 sm:p-3 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Clear Translation Memory"
              title="Clear Translation Memory for current language pair"
            >
              <Database className="w-5 h-5" />
            </button>
            {items.length > 0 && (
              <button
                onClick={handleReset}
                className="p-2 sm:p-3 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Reset"
                title="Clear Current Session"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 sm:p-3 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Settings"
              title="Settings & API Key"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <HistoryModal 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        onSelectHistoryItem={handleSelectHistoryItem} 
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        selectedModel={selectedModel}
        onModelChange={(model) => {
          setSelectedModel(model);
          safeSetItem('manga_selected_model', model);
        }}
        autoDownload={autoDownload}
        onAutoDownloadChange={(val) => {
          setAutoDownload(val);
          safeSetItem('manga_auto_download', String(val));
        }}
      />

      {showConfirmClearMemory && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Clear Translation Memory</h3>
            <p className="text-gray-600">Are you sure you want to clear the translation memory for {sourceLang} to {targetLang}? This action cannot be undone.</p>
            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowConfirmClearMemory(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleClearMemory}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
              >
                Clear Memory
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="mb-8 flex flex-col gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-200">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">From</label>
              <select 
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px]"
              >
                <option value="Japanese">Japanese</option>
                <option value="English">English</option>
                <option value="Auto-detect">Auto-detect</option>
              </select>
            </div>
            
            <ArrowRight className="w-5 h-5 text-gray-400 hidden sm:block mt-5" />
            
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">To</label>
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px]"
              >
                <option value="Hindi">Hindi</option>
                <option value="Hinglish">Hinglish</option>
                <option value="English">English</option>
              </select>
            </div>
          </div>
          
          <div className="flex flex-col w-full">
            <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Custom Instructions (Optional)</label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="E.g., Keep honorifics like -san, translate sound effects, use informal tone..."
              className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[88px] resize-y"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Translate Manga Instantly</h2>
              <p className="text-gray-500">Upload images or PDFs, or take a photo to get started.</p>
            </div>
            <ImageUploader onImagesSelected={handleImagesSelected} />
          </div>
        ) : (
          <div className="space-y-6 flex flex-col items-center">
            {/* Pagination / Navigation */}
            <div className="w-full flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-gray-200">
              <button
                onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <ChevronLeft className="w-6 h-6 text-gray-700" />
              </button>
              
              <div className="flex flex-col items-center">
                <span className="text-sm font-medium text-gray-900">
                  Page {currentIndex + 1} of {items.length}
                </span>
                <span className="text-xs text-gray-500">
                  {items.filter(i => i.status === 'done').length} translated
                </span>
              </div>

              <div className="flex items-center space-x-2">
                {items.some(item => item.status === 'pending' || item.status === 'error') && (
                  <div className="flex items-center space-x-2 mr-2">
                    <select
                      value={batchMode}
                      onChange={(e) => setBatchMode(e.target.value as 'sequential' | 'parallel')}
                      className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-2 pl-3 pr-8"
                      title="Batch Mode"
                      disabled={isBatchTranslating}
                    >
                      <option value="sequential">Sequential</option>
                      <option value="parallel">Parallel</option>
                    </select>
                    {batchMode === 'parallel' && (
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={batchSize}
                        onChange={(e) => setBatchSize(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        className="w-16 text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-2 px-2"
                        title="Batch Size (1-10)"
                        disabled={isBatchTranslating}
                      />
                    )}
                    {isBatchTranslating ? (
                      <button
                        onClick={handleStopBatch}
                        className="flex items-center space-x-1 px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-full text-sm font-medium transition-colors min-h-[44px]"
                        title="Stop batch translation"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span className="hidden sm:inline">Stop</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleTranslateAll}
                        className="flex items-center space-x-1 px-4 py-2 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-full text-sm font-medium transition-colors min-h-[44px]"
                        title="Translate all pending pages"
                      >
                        <Play className="w-4 h-4" />
                        <span className="hidden sm:inline">Translate All</span>
                      </button>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setCurrentIndex(prev => Math.min(items.length - 1, prev + 1))}
                  disabled={currentIndex === items.length - 1}
                  className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronRight className="w-6 h-6 text-gray-700" />
                </button>
              </div>
            </div>

            {/* Current Item Display */}
            {currentItem && (
              <div className="w-full space-y-6 flex flex-col items-center">
                <div className="w-full flex justify-end">
                  <button
                    onClick={() => handleRemoveImage(currentIndex)}
                    className="flex items-center space-x-1 text-sm sm:text-base text-red-500 hover:text-red-700 transition-colors p-2 min-h-[44px]"
                  >
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>Remove Page</span>
                  </button>
                </div>

                {currentItem.error && (
                  <div className="w-full p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-700">{currentItem.error}</p>
                  </div>
                )}

                {currentItem.status === 'error' && (
                  <div className="w-full max-w-2xl mx-auto">
                    <div className="relative rounded-xl overflow-hidden shadow-md border border-gray-200">
                      <img src={currentItem.imageUrl} alt="Selected manga page" className="w-full h-auto block opacity-50" />
                    </div>
                    <div className="mt-6 flex justify-center">
                      <button
                        onClick={() => handleRetry(currentIndex)}
                        className="flex items-center justify-center space-x-2 w-full sm:w-auto px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium shadow-lg shadow-indigo-200 transition-all active:scale-95"
                      >
                        <RefreshCw className="w-5 h-5" />
                        <span>Retry Translation</span>
                      </button>
                    </div>
                  </div>
                )}

                {(currentItem.status === 'pending' || currentItem.status === 'translating') && (
                  <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center py-20 space-y-4">
                    {currentItem.status === 'translating' ? (
                      <>
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                        <p className="text-gray-500 font-medium animate-pulse">
                          Analyzing and translating...
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                          <Clock className="w-5 h-5 text-gray-400" />
                        </div>
                        <p className="text-gray-500 font-medium">
                          Ready to translate. Click "Translate All" to begin.
                        </p>
                        <button
                          onClick={() => translateItem(currentIndex)}
                          className="mt-4 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium transition-colors min-h-[44px] text-base"
                        >
                          Translate This Page
                        </button>
                      </>
                    )}
                    <div className="relative rounded-xl overflow-hidden shadow-md border border-gray-200 mt-4 opacity-50 w-64">
                      <img src={currentItem.imageUrl} alt="Selected manga page" className="w-full h-auto block" />
                    </div>
                  </div>
                )}

                {currentItem.status === 'done' && currentItem.blocks && (
                  <div className="w-full space-y-6">
                    <TranslationOverlay imageUrl={currentItem.imageUrl} blocks={currentItem.blocks} onDeleteBlock={handleDeleteBlock} onEditBlock={handleEditBlock} />
                    
                    {currentItem.usage && (
                      <div className="flex items-center justify-center text-sm text-gray-500 space-x-6 bg-white py-3 px-6 rounded-full shadow-sm border border-gray-100 w-max mx-auto">
                        <div className="flex items-center space-x-2" title="Tokens used">
                          <Database className="w-4 h-4 text-indigo-400" />
                          <span className="font-medium">{currentItem.usage.totalTokens.toLocaleString()} tokens</span>
                        </div>
                        {currentItem.usage.estimatedCost !== undefined && (
                          <div className="flex items-center space-x-2" title="Estimated cost">
                            <Info className="w-4 h-4 text-emerald-400" />
                            <span className="font-medium">~${currentItem.usage.estimatedCost.toFixed(4)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                      <button
                        onClick={handleDownload}
                        className="flex items-center justify-center space-x-2 w-full sm:w-auto px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium shadow-lg shadow-indigo-200 transition-all active:scale-95"
                      >
                        <Download className="w-5 h-5" />
                        <span>Download PDF</span>
                      </button>
                      
                      {items.filter(item => item.status === 'done').length > 1 && (
                        <button
                          onClick={handleDownloadAll}
                          disabled={isDownloadingAll}
                          className="flex items-center justify-center space-x-2 w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-medium shadow-lg shadow-emerald-200 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                          {isDownloadingAll ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Archive className="w-5 h-5" />
                          )}
                          <span>Download All (PDF)</span>
                        </button>
                      )}
                    </div>
                    
                    {currentItem.blocks.length > 0 ? (
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                          <h3 className="font-medium text-gray-900">Extracted Text</h3>
                        </div>
                        <ul className="divide-y divide-gray-100">
                          {currentItem.blocks.map((block, idx) => (
                            <li key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Original</p>
                                <p className="text-sm text-gray-700">{block.originalText}</p>
                              </div>
                              <div className="mt-3 space-y-1">
                                <p className="text-xs font-medium text-indigo-500 uppercase tracking-wider">Translation</p>
                                <p className="text-base text-gray-900 font-medium">{block.translatedText}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="text-center py-10 bg-white rounded-2xl border border-gray-200">
                        <p className="text-gray-500">No text bubbles found on this page.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Add more files button */}
            <div className="w-full pt-6 border-t border-gray-200">
              <ImageUploader onImagesSelected={handleImagesSelected} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
