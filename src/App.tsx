/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { ImageUploader } from './components/ImageUploader';
import { TranslationOverlay } from './components/TranslationOverlay';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';
import { translateMangaPage, translateImage, translateBatch, TranslationBlock, TokenUsage } from './utils/geminiService';
import { saveToHistory, HistoryItem } from './utils/historyService';
import { getTranslationMemory, saveToTranslationMemory, saveMultipleToTranslationMemory, clearTranslationMemory } from './utils/translationMemoryService';
import { translationQueue } from './utils/requestQueue';
import { safeGetItem, safeSetItem } from './utils/storage';
import { resizeImage, fileToBase64 } from './utils/imageUtils';
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
  const [batchMode, setBatchMode] = useState<'sequential' | 'parallel'>(() => {
    return (safeGetItem('manga_batch_mode') as 'sequential' | 'parallel') || 'sequential';
  });
  const [batchSize, setBatchSize] = useState<number>(() => {
    return parseInt(safeGetItem('manga_batch_size') || '2');
  });
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
  const [fontFamily, setFontFamily] = useState(() => {
    return safeGetItem('manga_font_family') || '"Comic Neue", Kalam, sans-serif';
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return safeGetItem('manga_notifications_enabled') !== 'false';
  });

  // Save settings to localStorage when they change
  useEffect(() => {
    safeSetItem('manga_source_lang', sourceLang);
    safeSetItem('manga_target_lang', targetLang);
    safeSetItem('manga_custom_prompt', customPrompt);
    safeSetItem('manga_selected_model', selectedModel);
    safeSetItem('manga_auto_download', String(autoDownload));
    safeSetItem('manga_batch_mode', batchMode);
    safeSetItem('manga_batch_size', String(batchSize));
    safeSetItem('manga_font_family', fontFamily);
    safeSetItem('manga_notifications_enabled', String(notificationsEnabled));
  }, [sourceLang, targetLang, customPrompt, selectedModel, autoDownload, batchMode, batchSize, fontFamily, notificationsEnabled]);

  const notify = {
    success: (msg: string, options?: any) => notificationsEnabled && toast.success(msg, options),
    error: (msg: string, options?: any) => notificationsEnabled && toast.error(msg, options),
    info: (msg: string, options?: any) => notificationsEnabled && toast.info(msg, options),
    loading: (msg: string, options?: any) => notificationsEnabled && toast.loading(msg, options),
    dismiss: (id?: string | number) => toast.dismiss(id),
  };

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
    notify.success(`${selectedFiles.length} images added to queue`);
  };

  const translateItem = async (index: number, currentItem?: TranslationItem): Promise<void> => {
    const item = currentItem || items[index];
    if (!item) return;

    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'translating', error: undefined } : i));

    try {
      notify.loading(`Translating page ${index + 1}...`, { id: item.id });
      let base64Data = '';
      let mimeType = 'image/jpeg';

      if (item.file) {
        const resizedBlob = await resizeImage(item.file);
        if (!resizedBlob) throw new Error("Failed to resize image.");
        base64Data = await fileToBase64(resizedBlob);
      } else if (item.imageUrl.startsWith('data:image')) {
        const matches = item.imageUrl.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          mimeType = matches[1];
          base64Data = matches[2];
        } else {
          throw new Error("Invalid image data.");
        }
      } else {
        throw new Error("No image data available.");
      }

      const imageHash = `${item.id}_${sourceLang}_${targetLang}_${selectedModel}_${customPrompt}`;
      const memory = await getTranslationMemory(sourceLang, targetLang);

      // Add the request to the global queue to enforce rate limits
      const result = await translationQueue.add(() => 
        translateImage(imageHash, base64Data, mimeType, sourceLang, targetLang, customPrompt, memory as any, selectedModel, true)
      );
      
      // Save new translations to memory
      await saveMultipleToTranslationMemory(sourceLang, targetLang, result.blocks);

      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done', blocks: result.blocks, usage: result.usage } : i));
      notify.success(`Page ${index + 1} translated!`, { id: item.id });
      
      // Save to history
      saveToHistory({
        id: item.id,
        timestamp: Date.now(),
        imageUrl: `data:${mimeType};base64,${base64Data}`,
        sourceLang,
        targetLang,
        blocks: result.blocks,
        usage: result.usage
      });
    } catch (err) {
      console.error("[translateItem] Error:", err);
      const errorMessage = err instanceof Error ? err.message : "An error occurred during translation.";
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', error: errorMessage } : i));
      notify.error(`Failed to translate page ${index + 1}`, { 
        id: item.id,
        description: errorMessage 
      });
    } finally {
      // Ensure loading state is cleared if it somehow got stuck
      setItems(prev => prev.map(i => i.id === item.id && i.status === 'translating' ? { ...i, status: 'error', error: 'Translation interrupted.' } : i));
    }
  };

  const handleTranslateAll = async () => {
    const pendingItems = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending' || item.status === 'error');
      
    if (pendingItems.length === 0) return;

    setIsBatchTranslating(true);
    stopBatchRef.current = false;

    try {
      // Set delay based on batch mode (parallel can be faster if using paid API, but queue still protects it)
      translationQueue.setDelay(batchMode === 'parallel' ? 2000 : 6000);

      // Map all pending items to promises. The translationQueue will handle rate limiting and sequential execution automatically.
      const promises = pendingItems.map(async ({ item, index }) => {
        if (stopBatchRef.current) return;
        await translateItem(index, item);
      });

      await Promise.allSettled(promises);
      
      // Auto-download if enabled and not stopped manually
      if (!stopBatchRef.current && autoDownload) {
        handleDownloadAll();
      }
    } catch (error) {
      console.error("Batch translation error:", error);
    } finally {
      setIsBatchTranslating(false);
    }
  };

  const handleStopBatch = () => {
    stopBatchRef.current = true;
    translationQueue.clear(); // Clear any pending requests in the queue
    setIsBatchTranslating(false);
    notify.info("Batch translation stopped");
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

  const handleEditBlock = async (indexToEdit: number, newText: string, newFontSize?: number) => {
    setItems(prev => {
      const next = [...prev];
      const currentItem = next[currentIndex];
      if (currentItem && currentItem.blocks) {
        const newBlocks = [...currentItem.blocks];
        const block = newBlocks[indexToEdit];
        if (block) {
          block.translatedText = newText;
          block.fontSize = newFontSize;
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
      
      let lines: string[] = [];
      const paddingX = Math.min(6, w * 0.05);
      const paddingY = Math.min(6, h * 0.05);
      
      let fontSize = block.fontSize || Math.floor(Math.min(80, h * 0.8));
      const minFontSize = 8;
      let lineHeight = 0;
      let finalW = w;
      let finalH = h;
      
      // If manual font size is set, we don't binary search/scale down, we just use it
      if (block.fontSize) {
        ctx.font = `bold ${fontSize}px ${fontFamily}`;
        lineHeight = fontSize * 1.05;
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
        
        // Expand box if text is larger
        const totalHeight = lines.length * lineHeight;
        let maxLineWidth = 0;
        lines.forEach(l => {
            maxLineWidth = Math.max(maxLineWidth, ctx.measureText(l).width);
        });
        finalW = Math.max(w, maxLineWidth + paddingX * 2);
        finalH = Math.max(h, totalHeight + paddingY * 2);
      } else {
        while (fontSize >= minFontSize) {
          ctx.font = `bold ${fontSize}px ${fontFamily}`;
          lineHeight = fontSize * 1.05;
          
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
            // If we reached minFontSize, expand the box to fit the text
            if (fontSize === minFontSize) {
              finalW = Math.max(w, maxLineWidth + paddingX * 2);
              finalH = Math.max(h, totalHeight + paddingY * 2);
            }
            break;
          }
          
          fontSize -= 1;
        }
      }

      // Center the expanded box around the original center
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const drawX = centerX - finalW / 2;
      const drawY = centerY - finalH / 2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(drawX + radius, drawY);
      ctx.lineTo(drawX + finalW - radius, drawY);
      ctx.quadraticCurveTo(drawX + finalW, drawY, drawX + finalW, drawY + radius);
      ctx.lineTo(drawX + finalW, drawY + finalH - radius);
      ctx.quadraticCurveTo(drawX + finalW, drawY + finalH, drawX + finalW - radius, drawY + finalH);
      ctx.lineTo(drawX + radius, drawY + finalH);
      ctx.quadraticCurveTo(drawX, drawY + finalH, drawX, drawY + finalH - radius);
      ctx.lineTo(drawX, drawY + radius);
      ctx.quadraticCurveTo(drawX, drawY, drawX + radius, drawY);
      ctx.closePath();
      
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.clip();

      ctx.fillStyle = 'black';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const startY = drawY + finalH / 2 - ((lines.length - 1) * lineHeight) / 2;
      
      lines.forEach((lineText, i) => {
        ctx.fillText(lineText.trim(), drawX + finalW / 2, startY + i * lineHeight);
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
    notify.success("Translation memory cleared");
  };

  const currentItem = items[currentIndex];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-12">
      <Toaster position="top-right" richColors />
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
        }}
        autoDownload={autoDownload}
        onAutoDownloadChange={(val) => {
          setAutoDownload(val);
        }}
        notificationsEnabled={notificationsEnabled}
        onNotificationsEnabledChange={(val) => {
          setNotificationsEnabled(val);
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
            
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Font Style</label>
              <select 
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px]"
              >
                <option value='"Comic Neue", Kalam, sans-serif'>Comic (Default)</option>
                <option value='"Noto Sans", sans-serif'>Noto Sans</option>
                <option value='"WildWords", "CC Wild Words", "Comic Sans MS", sans-serif'>WildWords</option>
                <option value='"Bad Comic", cursive, sans-serif'>BadComic</option>
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
            <div className="w-full flex flex-wrap items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-gray-200 gap-3">
              <div className="flex items-center justify-between w-full sm:w-auto order-1 sm:order-none">
                <button
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                  className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronLeft className="w-6 h-6 text-gray-700" />
                </button>
                
                <div className="flex flex-col items-center sm:hidden px-4">
                  <span className="text-sm font-medium text-gray-900">
                    Page {currentIndex + 1} of {items.length}
                  </span>
                  <span className="text-xs text-gray-500">
                    {items.filter(i => i.status === 'done').length} translated
                  </span>
                </div>

                <button
                  onClick={() => setCurrentIndex(prev => Math.min(items.length - 1, prev + 1))}
                  disabled={currentIndex === items.length - 1}
                  className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronRight className="w-6 h-6 text-gray-700" />
                </button>
              </div>
              
              <div className="hidden sm:flex flex-col items-center order-2 sm:order-none">
                <span className="text-sm font-medium text-gray-900">
                  Page {currentIndex + 1} of {items.length}
                </span>
                <span className="text-xs text-gray-500">
                  {items.filter(i => i.status === 'done').length} translated
                </span>
              </div>

              <div className="flex items-center justify-center space-x-2 w-full sm:w-auto order-3 sm:order-none">
                {items.some(item => item.status === 'pending' || item.status === 'error') && (
                  <div className="flex flex-wrap justify-center items-center gap-2">
                    <select
                      value={batchMode}
                      onChange={(e) => setBatchMode(e.target.value as 'sequential' | 'parallel')}
                      className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-2 pl-3 pr-8 min-h-[44px]"
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
                        className="w-16 text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-2 px-2 min-h-[44px]"
                        title="Batch Size (1-10)"
                        disabled={isBatchTranslating}
                      />
                    )}
                    {isBatchTranslating ? (
                      <button
                        onClick={handleStopBatch}
                        className="flex items-center justify-center space-x-1 px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-full text-sm font-medium transition-colors min-h-[44px] w-full sm:w-auto"
                        title="Stop batch translation"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleTranslateAll}
                        className="flex items-center justify-center space-x-1 px-4 py-2 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-full text-sm font-medium transition-colors min-h-[44px] w-full sm:w-auto"
                        title="Translate all pending pages"
                      >
                        <Play className="w-4 h-4" />
                        <span>Translate All</span>
                      </button>
                    )}
                  </div>
                )}
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
                    <TranslationOverlay imageUrl={currentItem.imageUrl} blocks={currentItem.blocks} onDeleteBlock={handleDeleteBlock} onEditBlock={handleEditBlock} fontFamily={fontFamily} />
                    
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
