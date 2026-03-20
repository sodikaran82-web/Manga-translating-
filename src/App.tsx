/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { ImageUploader } from './components/ImageUploader';
import { TranslationOverlay } from './components/TranslationOverlay';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';
import { translateMangaPage, translateImage, translateBatch, TranslationBlock, TokenUsage, generateImageHash } from './utils/geminiService';
import { saveToHistory, HistoryItem } from './utils/historyService';
import { getTranslationMemory, saveToTranslationMemory, saveMultipleToTranslationMemory, clearTranslationMemory } from './utils/translationMemoryService';
import { translationQueue } from './utils/requestQueue';
import { safeGetItem, safeSetItem, loadTextCache, saveTextCache } from './utils/storage';
import { resizeImage, fileToBase64 } from './utils/imageUtils';
import { Loader2, RefreshCw, Languages, AlertCircle, ArrowRight, Download, ChevronLeft, ChevronRight, Trash2, Clock, Archive, Play, Database, Settings, Square, Info, CheckSquare, Layers, Edit3, Check } from 'lucide-react';
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
  
  // Multi-select state
  const [selectedBlocks, setSelectedBlocks] = useState<{pageIndex: number, blockIndex: number}[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [isMultiEditModalOpen, setIsMultiEditModalOpen] = useState(false);
  const [showConfirmMultiDelete, setShowConfirmMultiDelete] = useState(false);
  const [multiEditApplyText, setMultiEditApplyText] = useState(false);
  const [multiEditText, setMultiEditText] = useState('');
  const [multiEditApplyFontSize, setMultiEditApplyFontSize] = useState(false);
  const [multiEditFontSize, setMultiEditFontSize] = useState(0);

  const [sourceLang, setSourceLang] = useState(() => {
    return safeGetItem('manga_source_lang') || 'Japanese';
  });
  const [targetLang, setTargetLang] = useState(() => {
    return safeGetItem('manga_target_lang') || 'Hindi';
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    return safeGetItem('manga_selected_model') || 'gemini-3.1-flash-lite-preview';
  });
  const [temperature, setTemperature] = useState(() => {
    return parseFloat(safeGetItem('manga_temperature') || '0.4');
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
  const [defaultFontSize, setDefaultFontSize] = useState<number>(() => {
    const saved = safeGetItem('manga_default_font_size');
    return saved ? parseFloat(saved) : 7;
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
    safeSetItem('manga_temperature', String(temperature));
    safeSetItem('manga_auto_download', String(autoDownload));
    safeSetItem('manga_batch_mode', batchMode);
    safeSetItem('manga_batch_size', String(batchSize));
    safeSetItem('manga_font_family', fontFamily);
    safeSetItem('manga_default_font_size', String(defaultFontSize));
    safeSetItem('manga_notifications_enabled', String(notificationsEnabled));
  }, [sourceLang, targetLang, customPrompt, selectedModel, temperature, autoDownload, batchMode, batchSize, fontFamily, defaultFontSize, notificationsEnabled]);

  const notify = {
    success: (msg: string, options?: any) => notificationsEnabled && toast.success(msg, options),
    error: (msg: string, options?: any) => notificationsEnabled && toast.error(msg, options),
    info: (msg: string, options?: any) => notificationsEnabled && toast.info(msg, options),
    loading: (msg: string, options?: any) => notificationsEnabled && toast.loading(msg, options),
    dismiss: (id?: string | number) => toast.dismiss(id),
  };

  // Re-translate all if languages, prompt, or temperature change
  useEffect(() => {
    if (items.length > 0) {
      setItems(prev => prev.map(item => ({ ...item, status: 'pending', blocks: undefined, error: undefined })));
    }
  }, [sourceLang, targetLang, customPrompt, temperature]);

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

      const imageHash = await generateImageHash([
        base64Data,
        mimeType,
        sourceLang,
        targetLang,
        selectedModel,
        customPrompt,
        temperature.toString()
      ]);
      const memory = await getTranslationMemory(sourceLang, targetLang);

      // Adjust queue delay dynamically based on mode
      translationQueue.setDelay(batchMode === 'parallel' ? 500 : 800);

      // Add the request to the global queue to enforce rate limits
      const result = await translationQueue.add(() => 
        translateImage(imageHash, base64Data, mimeType, sourceLang, targetLang, customPrompt, memory as any, selectedModel, false, temperature)
      );
      
      const textCache = loadTextCache();
      let cacheUpdated = false;

      result.blocks = result.blocks.map((block: TranslationBlock) => {
        const original = block.originalText?.trim();
        
        // Apply default font size if set
        if (defaultFontSize > 0) {
          block.fontSize = defaultFontSize;
        }

        // 1. Skip if there's no text to work with
        if (!original) return block;

        // 2. Check if translation exists in cache
        if (textCache[original]) {
          return {
            ...block,
            translatedText: textCache[original],
            cached: true
          };
        }

        // 3. If NOT in cache, but the block already has a translation (e.g., from an API call)
        // Save it to the cache for future use
        if (block.translatedText) {
          textCache[original] = block.translatedText;
          cacheUpdated = true;
        }

        return block;
      });

      // 4. Only save to localStorage if something actually changed
      if (cacheUpdated) {
        saveTextCache(textCache);
      }
      
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
      // Set delay based on batch mode
      translationQueue.setDelay(batchMode === 'parallel' ? 500 : 800);

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

  const handleEditBlock = async (indexToEdit: number, newText: string, newFontSize?: number, newFontWeight?: 'normal' | 'bold', newColor?: string) => {
    setItems(prev => {
      const next = [...prev];
      const currentItem = next[currentIndex];
      if (currentItem && currentItem.blocks) {
        const newBlocks = [...currentItem.blocks];
        const block = newBlocks[indexToEdit];
        if (block) {
          block.translatedText = newText;
          block.fontSize = newFontSize;
          block.fontWeight = newFontWeight;
          block.color = newColor;
          // Save the edited translation to memory
          saveToTranslationMemory(sourceLang, targetLang, block.originalText, newText).catch(console.error);
          
          // Also save to textCache
          const textCache = loadTextCache();
          if (block.originalText) {
            textCache[block.originalText.trim()] = newText;
            saveTextCache(textCache);
          }
        }
        next[currentIndex] = {
          ...currentItem,
          blocks: newBlocks
        };
      }
      return next;
    });
  };

  const handleToggleBlockSelection = (pageIndex: number, blockIndex: number) => {
    setSelectedBlocks(prev => {
      const exists = prev.findIndex(b => b.pageIndex === pageIndex && b.blockIndex === blockIndex);
      if (exists >= 0) {
        return prev.filter((_, i) => i !== exists);
      } else {
        return [...prev, { pageIndex, blockIndex }];
      }
    });
  };

  const handleMultiDelete = () => {
    setItems(prevItems => {
      const newItems = [...prevItems];
      // Group blocks to delete by pageIndex, sort descending to avoid index shifting
      const blocksToDeleteByPage = selectedBlocks.reduce((acc, curr) => {
        if (!acc[curr.pageIndex]) acc[curr.pageIndex] = [];
        acc[curr.pageIndex].push(curr.blockIndex);
        return acc;
      }, {} as Record<number, number[]>);

      for (const [pageIdxStr, blockIndices] of Object.entries(blocksToDeleteByPage)) {
        const pageIdx = parseInt(pageIdxStr);
        if (newItems[pageIdx] && newItems[pageIdx].blocks) {
          const sortedIndices = [...(blockIndices as number[])].sort((a, b) => b - a);
          const newBlocks = [...newItems[pageIdx].blocks!];
          for (const idx of sortedIndices) {
            newBlocks.splice(idx, 1);
          }
          newItems[pageIdx] = { ...newItems[pageIdx], blocks: newBlocks };
        }
      }
      return newItems;
    });
    setSelectedBlocks([]);
    setIsMultiSelectMode(false);
    notify.success(`Deleted ${selectedBlocks.length} blocks`);
  };

  const handleApplyMultiEdit = () => {
    if (!multiEditApplyText && !multiEditApplyFontSize) {
      setIsMultiEditModalOpen(false);
      return;
    }

    setItems(prevItems => {
      const newItems = [...prevItems];
      const textCache = loadTextCache();
      let cacheUpdated = false;

      for (const { pageIndex, blockIndex } of selectedBlocks) {
        if (newItems[pageIndex] && newItems[pageIndex].blocks && newItems[pageIndex].blocks![blockIndex]) {
          const block = newItems[pageIndex].blocks![blockIndex];
          const updatedBlock = { ...block };
          if (multiEditApplyText) {
            updatedBlock.translatedText = multiEditText;
            // Save to translation memory
            saveToTranslationMemory(sourceLang, targetLang, block.originalText, multiEditText).catch(console.error);
            
            // Also save to textCache
            if (block.originalText) {
              textCache[block.originalText.trim()] = multiEditText;
              cacheUpdated = true;
            }
          }
          if (multiEditApplyFontSize) {
            updatedBlock.fontSize = multiEditFontSize === 0 ? undefined : multiEditFontSize;
          }
          
          const newBlocks = [...newItems[pageIndex].blocks!];
          newBlocks[blockIndex] = updatedBlock;
          newItems[pageIndex] = { ...newItems[pageIndex], blocks: newBlocks };
        }
      }
      
      if (cacheUpdated) {
        saveTextCache(textCache);
      }
      
      return newItems;
    });
    setIsMultiEditModalOpen(false);
    setSelectedBlocks([]);
    setIsMultiSelectMode(false);
    notify.success(`Updated ${selectedBlocks.length} blocks`);
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

    await document.fonts.ready;

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
      if (!block.translatedText || block.translatedText.trim() === '') return;

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
      const radius = 2; // Match rounded-sm
      
      let lines: string[] = [];
      // Use 5% padding on each side to constrain text to 90% of the bounding box,
      // matching the HTML overlay and keeping text inside oval speech bubbles.
      const paddingX = w * 0.05;
      const paddingY = h * 0.05;
      
      const comicFontFamily = fontFamily || '"Comic Neue", Kalam, sans-serif';
      
      // Calculate scale factor from screen to canvas
      const renderedImageWidth = Math.min(window.innerWidth, 672);
      const scaleFactor = canvas.width / renderedImageWidth;
      
      const minCanvasFontSize = Math.max(4, Math.floor(4 * scaleFactor));
      const maxCanvasFontSize = Math.floor((block.fontSize || 80) * scaleFactor);
      
      let fontSize = minCanvasFontSize;
      let lineHeight = 0;
      let finalW = w;
      let finalH = h;

      // Helper function for balanced text wrapping (mimics text-wrap: balance)
      const wrapTextBalanced = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
        const words = text.trim().split(/\s+/);
        if (words.length === 0 || (words.length === 1 && words[0] === '')) return [];
        if (words.length === 1) return words;

        let greedyLines: string[] = [];
        let line = '';
        for (let i = 0; i < words.length; i++) {
          const testLine = line + (line ? ' ' : '') + words[i];
          if (ctx.measureText(testLine).width > maxWidth && i > 0) {
            greedyLines.push(line);
            line = words[i];
          } else {
            line = testLine;
          }
        }
        if (line) greedyLines.push(line);

        const numLines = greedyLines.length;
        if (numLines <= 1) return greedyLines;

        let low = 0;
        let high = maxWidth;
        let bestLines = greedyLines;

        let minWordWidth = 0;
        for (const word of words) {
          minWordWidth = Math.max(minWordWidth, ctx.measureText(word).width);
        }
        low = minWordWidth;

        while (low <= high) {
          const mid = (low + high) / 2;
          let currentLines: string[] = [];
          let currentLine = '';
          let valid = true;
          
          for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
            if (ctx.measureText(testLine).width > mid) {
              if (!currentLine) {
                valid = false;
                break;
              }
              currentLines.push(currentLine);
              currentLine = words[i];
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) currentLines.push(currentLine);

          if (valid && currentLines.length <= numLines) {
            bestLines = currentLines;
            high = mid - 0.5;
          } else {
            low = mid + 0.5;
          }
        }
        return bestLines;
      };
      
      // Binary search for the best font size
      let low = minCanvasFontSize;
      let high = maxCanvasFontSize;
      let bestFontSize = minCanvasFontSize;
      let bestLines: string[] = [];
      
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (mid < low) break;
        
        ctx.font = `bold ${mid}px ${comicFontFamily}`;
        const currentLineHeight = mid * 1.1;
        
        const targetWidth = w - paddingX * 2;
        const currentLines = wrapTextBalanced(ctx, block.translatedText, targetWidth);
        
        const totalHeight = currentLines.length * currentLineHeight;
        let maxLineWidth = 0;
        currentLines.forEach(l => {
            maxLineWidth = Math.max(maxLineWidth, ctx.measureText(l).width);
        });

        if (totalHeight <= h - paddingY * 2 && maxLineWidth <= w - paddingX * 2) {
          bestFontSize = mid;
          bestLines = currentLines;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      
      fontSize = bestFontSize;
      lines = bestLines;
      lineHeight = fontSize * 1.1;
      ctx.font = `bold ${fontSize}px ${comicFontFamily}`;
      
      // If even minCanvasFontSize doesn't fit, we need to expand the box
      if (lines.length === 0) {
         fontSize = minCanvasFontSize;
         ctx.font = `bold ${fontSize}px ${comicFontFamily}`;
         lineHeight = fontSize * 1.1;
         lines = wrapTextBalanced(ctx, block.translatedText, w - paddingX * 2);
         
         const totalHeight = lines.length * lineHeight;
         let maxLineWidth = 0;
         lines.forEach(l => {
             maxLineWidth = Math.max(maxLineWidth, ctx.measureText(l).width);
         });
         // Expand finalW and finalH slightly to ensure text is readable
         finalW = Math.max(w, maxLineWidth + paddingX * 2);
         finalH = Math.max(h, totalHeight + paddingY * 2);
      }

      // Center the expanded box around the original center
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const drawX = centerX - finalW / 2;
      const drawY = centerY - finalH / 2;

      ctx.save();
      
      // Draw a white background to cover original text
      ctx.beginPath();
      
      // Draw rounded rect
      const bgX = drawX;
      const bgY = drawY;
      const bgW = finalW;
      const bgH = finalH;
      ctx.moveTo(bgX + radius, bgY);
      ctx.lineTo(bgX + bgW - radius, bgY);
      ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + radius);
      ctx.lineTo(bgX + bgW, bgY + bgH - radius);
      ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - radius, bgY + bgH);
      ctx.lineTo(bgX + radius, bgY + bgH);
      ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - radius);
      ctx.lineTo(bgX, bgY + radius);
      ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
      ctx.closePath();
      
      // Match bg-white/95 and shadow-sm from TranslationOverlay
      ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fill();
      
      // Reset shadow for text
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.fillStyle = '#000000'; // Match text-black
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const startY = drawY + finalH / 2 - ((lines.length - 1) * lineHeight) / 2;
      
      lines.forEach((lineText, i) => {
        // Match textShadow: '0px 0px 2px rgba(255,255,255,0.8)'
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
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
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-12"
    >
      <Toaster position="top-right" richColors />
      <motion.header 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white border-b border-gray-200 sticky top-0 z-50"
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div className="bg-indigo-100 p-1.5 sm:p-2 rounded-lg">
              <Languages className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-gray-900 hidden xs:block sm:block">Manga Translator</h1>
          </div>
          <div className="flex items-center space-x-0.5 sm:space-x-2 overflow-x-auto no-scrollbar">
            {items.some(item => item.status === 'done') && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleDownloadAll}
                disabled={isDownloadingAll}
                className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
                aria-label="Download All"
                title="Download All Translated Pages (PDF)"
              >
                {isDownloadingAll ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Archive className="w-5 h-5" />
                )}
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsHistoryOpen(true)}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
              aria-label="History"
              title="View Translation History"
            >
              <Clock className="w-5 h-5" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowConfirmClearMemory(true)}
              className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
              aria-label="Clear Translation Memory"
              title="Clear Translation Memory for current language pair"
            >
              <Database className="w-5 h-5" />
            </motion.button>
            {items.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleReset}
                className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
                aria-label="Reset"
                title="Clear Current Session"
              >
                <RefreshCw className="w-5 h-5" />
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
              aria-label="Settings"
              title="Settings & API Key"
            >
              <Settings className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </motion.header>

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
        temperature={temperature}
        onTemperatureChange={(val) => {
          setTemperature(val);
        }}
      />

      <AnimatePresence>
        {showConfirmClearMemory && (
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex flex-col gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-200"
        >
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">From</label>
              <select 
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px] transition-all hover:border-indigo-300"
              >
                <option value="Auto-detect">Auto-detect</option>
                <option value="Japanese">Japanese</option>
                <option value="Korean">Korean</option>
                <option value="Chinese (Simplified)">Chinese (Simplified)</option>
                <option value="Chinese (Traditional)">Chinese (Traditional)</option>
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Italian">Italian</option>
                <option value="Portuguese">Portuguese</option>
                <option value="Russian">Russian</option>
                <option value="Arabic">Arabic</option>
                <option value="Hindi">Hindi</option>
              </select>
            </div>
            
            <ArrowRight className="w-5 h-5 text-gray-400 hidden sm:block mt-5" />
            
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">To</label>
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px] transition-all hover:border-indigo-300"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Hinglish">Hinglish</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Italian">Italian</option>
                <option value="Portuguese">Portuguese</option>
                <option value="Russian">Russian</option>
                <option value="Japanese">Japanese</option>
                <option value="Korean">Korean</option>
                <option value="Chinese (Simplified)">Chinese (Simplified)</option>
                <option value="Chinese (Traditional)">Chinese (Traditional)</option>
                <option value="Arabic">Arabic</option>
                <option value="Bengali">Bengali</option>
                <option value="Tamil">Tamil</option>
                <option value="Telugu">Telugu</option>
                <option value="Marathi">Marathi</option>
                <option value="Indonesian">Indonesian</option>
                <option value="Vietnamese">Vietnamese</option>
                <option value="Thai">Thai</option>
              </select>
            </div>
            
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Font Style</label>
              <select 
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px] transition-all hover:border-indigo-300"
              >
                <option value='"Comic Neue", Kalam, sans-serif'>Comic (Default)</option>
                <option value='"Anime Ace", "Anime Ace 2.0 BB", "Comic Sans MS", sans-serif'>Anime Ace</option>
                <option value='"Noto Sans", sans-serif'>Noto Sans</option>
                <option value='"WildWords", "CC Wild Words", "Comic Sans MS", sans-serif'>WildWords</option>
                <option value='"Bad Comic", cursive, sans-serif'>BadComic</option>
              </select>
            </div>
            
            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider" title="Set to 0 for auto-scaling">Default Size (pt)</label>
              <input 
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={defaultFontSize > 0 ? defaultFontSize : ''}
                onChange={(e) => setDefaultFontSize(parseFloat(e.target.value) || 0)}
                className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[44px] transition-all hover:border-indigo-300"
                placeholder="Auto (0)"
              />
            </div>
          </div>
          
          <div className="flex flex-col w-full">
            <label className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Custom Instructions (Optional)</label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="E.g., Keep honorifics like -san, translate sound effects, use informal tone..."
              className="bg-gray-50 border border-gray-200 text-gray-900 text-base sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 sm:p-2.5 min-h-[88px] resize-y transition-all hover:border-indigo-300"
            />
          </div>
        </motion.div>

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
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                  className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronLeft className="w-6 h-6 text-gray-700" />
                </motion.button>
                
                <div className="flex flex-col items-center sm:hidden px-4">
                  <span className="text-sm font-medium text-gray-900">
                    Page {currentIndex + 1} of {items.length}
                  </span>
                  <span className="text-xs text-gray-500">
                    {items.filter(i => i.status === 'done').length} translated
                  </span>
                </div>

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setCurrentIndex(prev => Math.min(items.length - 1, prev + 1))}
                  disabled={currentIndex === items.length - 1}
                  className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronRight className="w-6 h-6 text-gray-700" />
                </motion.button>
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
                  <div className="flex flex-wrap justify-center items-center gap-2 w-full sm:w-auto">
                    <select
                      value={batchMode}
                      onChange={(e) => setBatchMode(e.target.value as 'sequential' | 'parallel')}
                      className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-2 pl-3 pr-8 min-h-[44px] flex-1 sm:flex-none"
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
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleStopBatch}
                        className="flex items-center justify-center space-x-1 px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-full text-sm font-medium transition-colors min-h-[44px] flex-1 sm:flex-none sm:w-auto"
                        title="Stop batch translation"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>Stop</span>
                      </motion.button>
                    ) : (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleTranslateAll}
                        className="flex items-center justify-center space-x-1 px-4 py-2 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-full text-sm font-medium transition-colors min-h-[44px] flex-1 sm:flex-none sm:w-auto"
                        title="Translate all pending pages"
                      >
                        <Play className="w-4 h-4" />
                        <span>Translate All</span>
                      </motion.button>
                    )}
                  </div>
                )}
              </div>
            </div>


            {/* Current Item Display */}
            {currentItem && (
              <div className="w-full space-y-6 flex flex-col items-center">
                <div className="w-full flex justify-end">
                  <motion.button
                    whileHover={{ scale: 1.05, color: '#ef4444' }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleRemoveImage(currentIndex)}
                    className="flex items-center space-x-1 text-sm sm:text-base text-red-500 hover:text-red-700 transition-colors p-2 min-h-[44px]"
                  >
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>Remove Page</span>
                  </motion.button>
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
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleRetry(currentIndex)}
                        className="flex items-center justify-center space-x-2 w-full sm:w-auto px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium shadow-lg shadow-indigo-200 transition-all"
                      >
                        <RefreshCw className="w-5 h-5" />
                        <span>Retry Translation</span>
                      </motion.button>
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
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => translateItem(currentIndex)}
                          className="mt-4 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium transition-colors min-h-[44px] text-base shadow-md"
                        >
                          Translate This Page
                        </motion.button>
                      </>
                    )}
                    <div className="relative rounded-xl overflow-hidden shadow-md border border-gray-200 mt-4 opacity-50 w-64">
                      <img src={currentItem.imageUrl} alt="Selected manga page" className="w-full h-auto block" />
                    </div>
                  </div>
                )}

                {currentItem.status === 'done' && currentItem.blocks && (
                  <div className="w-full space-y-6">
                    <div className="flex justify-end">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          setIsMultiSelectMode(!isMultiSelectMode);
                          if (isMultiSelectMode) setSelectedBlocks([]);
                        }}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-full font-medium transition-colors text-sm shadow-sm ${
                          isMultiSelectMode 
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' 
                            : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <CheckSquare className="w-4 h-4" />
                        <span>{isMultiSelectMode ? 'Done Selecting' : 'Select Multiple'}</span>
                      </motion.button>
                    </div>
                    <TranslationOverlay 
                      imageUrl={currentItem.imageUrl} 
                      blocks={currentItem.blocks} 
                      onDeleteBlock={handleDeleteBlock} 
                      onEditBlock={handleEditBlock} 
                      fontFamily={fontFamily} 
                      isMultiSelectMode={isMultiSelectMode}
                      selectedBlockIndices={selectedBlocks.filter(b => b.pageIndex === currentIndex).map(b => b.blockIndex)}
                      onToggleBlockSelection={(blockIndex) => handleToggleBlockSelection(currentIndex, blockIndex)}
                    />
                    
                    {currentItem.usage && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center justify-center text-sm text-gray-500 space-x-6 bg-white py-3 px-6 rounded-full shadow-sm border border-gray-100 w-max mx-auto"
                      >
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
                      </motion.div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleDownload}
                        className="flex items-center justify-center space-x-2 w-full sm:w-auto px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium shadow-lg shadow-indigo-200 transition-all active:scale-95"
                      >
                        <Download className="w-5 h-5" />
                        <span>Download PDF</span>
                      </motion.button>
                      
                      {items.filter(item => item.status === 'done').length > 1 && (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
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
                        </motion.button>
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

      {/* Multi-select Floating Action Bar */}
      <AnimatePresence>
        {selectedBlocks.length > 0 && (
          <motion.div 
            initial={{ y: 100, x: '-50%', opacity: 0 }}
            animate={{ y: 0, x: '-50%', opacity: 1 }}
            exit={{ y: 100, x: '-50%', opacity: 0 }}
            className="fixed bottom-6 left-1/2 bg-white shadow-2xl rounded-full px-4 sm:px-6 py-3 flex items-center space-x-2 sm:space-x-4 z-50 border border-gray-200"
          >
            <div className="flex items-center space-x-2 bg-indigo-50 px-3 py-1.5 rounded-full">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span className="font-medium text-indigo-700 text-sm">{selectedBlocks.length} selected</span>
            </div>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
            <button 
              onClick={() => setIsMultiEditModalOpen(true)} 
              className="flex items-center space-x-1 text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium"
            >
              <Edit3 className="w-4 h-4" />
              <span className="hidden sm:inline">Edit</span>
            </button>
            <button 
              onClick={() => setShowConfirmMultiDelete(true)} 
              className="flex items-center space-x-1 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Delete</span>
            </button>
            <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
            <button 
              onClick={() => setSelectedBlocks([])} 
              className="text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-Edit Modal */}
      <AnimatePresence>
        {isMultiEditModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col space-y-4"
            >
              <h3 className="text-lg font-semibold text-gray-900">Edit {selectedBlocks.length} Blocks</h3>
              <div className="space-y-4">
                <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <input 
                    type="checkbox" 
                    id="applyText"
                    checked={multiEditApplyText} 
                    onChange={e => setMultiEditApplyText(e.target.checked)} 
                    className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" 
                  />
                  <div className="flex-1">
                    <label htmlFor="applyText" className="block text-sm font-medium text-gray-700 mb-1 cursor-pointer">Apply New Text</label>
                    <textarea
                      disabled={!multiEditApplyText}
                      value={multiEditText}
                      onChange={(e) => setMultiEditText(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 min-h-[100px] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-sm"
                      placeholder="Enter text to apply to all selected blocks..."
                    />
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <input 
                    type="checkbox" 
                    id="applyFontSize"
                    checked={multiEditApplyFontSize} 
                    onChange={e => setMultiEditApplyFontSize(e.target.checked)} 
                    className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" 
                  />
                  <div className="flex-1">
                    <label htmlFor="applyFontSize" className="block text-sm font-medium text-gray-700 mb-2 cursor-pointer">Apply Font Size</label>
                    <div className="flex items-center space-x-4">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="fontSizeMode"
                          disabled={!multiEditApplyFontSize}
                          checked={multiEditFontSize === 0}
                          onChange={() => setMultiEditFontSize(0)}
                          className="text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                        />
                        <span className={`text-sm ${!multiEditApplyFontSize ? 'text-gray-400' : 'text-gray-700'}`}>Auto-size</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="fontSizeMode"
                          disabled={!multiEditApplyFontSize}
                          checked={multiEditFontSize > 0}
                          onChange={() => setMultiEditFontSize(10)}
                          className="text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                        />
                        <span className={`text-sm ${!multiEditApplyFontSize ? 'text-gray-400' : 'text-gray-700'}`}>Custom size:</span>
                      </label>
                      <input
                        disabled={!multiEditApplyFontSize || multiEditFontSize === 0}
                        type="number"
                        min="1"
                        max="100"
                        step="0.5"
                        value={multiEditFontSize > 0 ? multiEditFontSize : ''}
                        onChange={(e) => setMultiEditFontSize(parseFloat(e.target.value) || 0)}
                        className="w-20 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-sm"
                        placeholder="px/pt"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setIsMultiEditModalOpen(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyMultiEdit}
                  disabled={!multiEditApplyText && !multiEditApplyFontSize}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apply to All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-Delete Confirm Modal */}
      <AnimatePresence>
        {showConfirmMultiDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col space-y-4"
            >
              <h3 className="text-lg font-semibold text-gray-900">Delete Blocks</h3>
              <p className="text-gray-600">Are you sure you want to delete {selectedBlocks.length} selected blocks? This action cannot be undone.</p>
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  onClick={() => setShowConfirmMultiDelete(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowConfirmMultiDelete(false);
                    handleMultiDelete();
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
