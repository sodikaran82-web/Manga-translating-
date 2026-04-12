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
import { AdSense } from './components/AdSense';
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
    return (safeGetItem('manga_batch_mode') as 'sequential' | 'parallel') || 'parallel';
  });
  const [batchSize, setBatchSize] = useState<number | string>(() => {
    return parseInt(safeGetItem('manga_batch_size') || '5');
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

      // Adjust queue delay and concurrency dynamically based on mode
      const actualBatchSize = Math.max(1, Number(batchSize) || 1);
      translationQueue.setDelay(batchMode === 'parallel' ? 500 : 800);
      translationQueue.setConcurrency(batchMode === 'parallel' ? actualBatchSize : 1);

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
      // Set delay and concurrency based on batch mode
      const actualBatchSize = Math.max(1, Number(batchSize) || 1);
      translationQueue.setDelay(batchMode === 'parallel' ? 500 : 800);
      translationQueue.setConcurrency(batchMode === 'parallel' ? actualBatchSize : 1);

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

      const expand = block.bubbleShape === 'rectangular' || block.bubbleShape === 'none' ? 10 : 25;
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
      // Use 5% padding on each side for rectangular, 15% for oval to keep text inside
      const paddingFactorX = block.bubbleShape === 'rectangular' || block.bubbleShape === 'none' ? 0.05 : 0.15;
      const paddingFactorY = block.bubbleShape === 'rectangular' || block.bubbleShape === 'none' ? 0.05 : 0.15;
      const paddingX = w * paddingFactorX;
      const paddingY = h * paddingFactorY;
      
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
      const wrapTextBalanced = (ctx: CanvasRenderingContext2D, tex
