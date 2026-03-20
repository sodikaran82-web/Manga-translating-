import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TranslationBlock } from '../utils/geminiService';
import { X, Sliders, Check } from 'lucide-react';

interface TranslationOverlayProps {
  imageUrl: string;
  blocks: TranslationBlock[];
  onDeleteBlock?: (index: number) => void;
  onEditBlock?: (index: number, newText: string, newFontSize?: number, newFontWeight?: 'normal' | 'bold', newColor?: string) => void;
  fontFamily?: string;
  isMultiSelectMode?: boolean;
  selectedBlockIndices?: number[];
  onToggleBlockSelection?: (index: number) => void;
}

function AutoText({ text, originalText, isSelected, manualFontSize, fontFamily, fontWeight, color }: { text: string, originalText: string, isSelected: boolean, manualFontSize?: number, fontFamily?: string, fontWeight?: 'normal' | 'bold', color?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [fontSize, setFontSize] = useState(manualFontSize || 14);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isSelected) {
      setFontSize(manualFontSize || 16);
      return;
    }

    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl || dimensions.width === 0 || dimensions.height === 0) return;

    // Speech bubbles are often oval/elliptical. The bounding box is a rectangle.
    // To prevent text from overflowing the curved edges of the bubble, we constrain
    // the text to a smaller inner rectangle (e.g., 90% of the bounding box).
    const availableHeight = dimensions.height * 0.90;
    const availableWidth = dimensions.width * 0.90;
    
    if (availableHeight <= 0 || availableWidth <= 0) return;

    let min = 10;
    // If manualFontSize is set, use it as the maximum allowed size.
    // Otherwise, allow it to scale up to 80px to fill the bubble.
    let max = manualFontSize || 80;
    let best = min;

    // Temporarily remove constraints for accurate measurement
    const originalMaxWidth = textEl.style.maxWidth;
    const originalMaxHeight = textEl.style.maxHeight;
    const originalFontSize = textEl.style.fontSize;
    const originalWordBreak = textEl.style.wordBreak;
    const originalOverflowWrap = textEl.style.overflowWrap;
    
    textEl.style.maxWidth = `${availableWidth}px`;
    textEl.style.maxHeight = 'none';
    // Disable word breaking during measurement so that long words force the font size to scale down
    // instead of breaking in the middle of the word, which improves readability.
    textEl.style.wordBreak = 'normal';
    textEl.style.overflowWrap = 'normal';

    // Binary search for best font size
    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      textEl.style.fontSize = `${mid}px`;
      
      // For measurement, we want to see if it fits within the width with wrapping
      // We also account for line-height by checking scrollHeight
      const isHeightOk = textEl.scrollHeight <= availableHeight + 2; // +2 for subpixel slack
      const isWidthOk = textEl.scrollWidth <= availableWidth + 2;

      if (isHeightOk && isWidthOk) {
        best = mid;
        min = mid + 1;
      } else {
        max = mid - 1;
      }
    }
    
    // Restore constraints
    textEl.style.maxWidth = originalMaxWidth;
    textEl.style.maxHeight = originalMaxHeight;
    textEl.style.fontSize = originalFontSize;
    textEl.style.wordBreak = originalWordBreak;
    textEl.style.overflowWrap = originalOverflowWrap;
    
    setFontSize(best);
  }, [text, originalText, isSelected, manualFontSize, dimensions.width, dimensions.height]);

  return (
    <div 
      ref={containerRef} 
      className={`w-full h-full flex items-center justify-center ${isSelected ? 'overflow-y-auto max-h-[250px] scrollbar-thin p-2' : 'overflow-hidden'}`}
    >
      <p 
        ref={textRef} 
        className={`text-center m-0 p-0 ${fontWeight === 'normal' ? 'font-normal' : 'font-bold'}`} 
        style={{ 
          color: color || 'black',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          textWrap: 'balance',
          lineHeight: '1.1',
          letterSpacing: '-0.02em',
          fontSize: `${fontSize}px`,
          fontFamily: fontFamily || '"Comic Neue", Kalam, sans-serif',
          maxWidth: isSelected ? '100%' : '90%',
          maxHeight: isSelected ? '100%' : '90%',
          textShadow: isSelected ? 'none' : '0px 0px 2px rgba(255,255,255,0.8)'
        }}
      >
        {text}
      </p>
    </div>
  );
}

export function TranslationOverlay({ imageUrl, blocks, onDeleteBlock, onEditBlock, fontFamily, isMultiSelectMode, selectedBlockIndices = [], onToggleBlockSelection }: TranslationOverlayProps) {
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingFontSize, setEditingFontSize] = useState<number | undefined>(undefined);
  const [editingFontWeight, setEditingFontWeight] = useState<'normal' | 'bold'>('bold');
  const [editingColor, setEditingColor] = useState<string>('#000000');

  // Re-run scaling when window resizes
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectBlock = (index: number, block: TranslationBlock) => {
    if (isMultiSelectMode && onToggleBlockSelection) {
      onToggleBlockSelection(index);
      return;
    }
    if (selectedBlock === index) {
      setSelectedBlock(null);
    } else {
      setSelectedBlock(index);
      setEditingText(block.translatedText);
      setEditingFontSize(block.fontSize);
      setEditingFontWeight(block.fontWeight || 'bold');
      setEditingColor(block.color || '#000000');
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingText(e.target.value);
  };

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setEditingFontSize(val === 0 || isNaN(val) ? undefined : val);
  };

  const handleSaveEdit = (index: number) => {
    if (onEditBlock) {
      onEditBlock(index, editingText.trim(), editingFontSize, editingFontWeight, editingColor);
    }
    setSelectedBlock(null);
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto overflow-hidden rounded-xl shadow-lg border border-gray-200 bg-gray-50">
      <img src={imageUrl} alt="Manga page" className="w-full h-auto block" />
      
      {blocks.map((block, index) => {
        const expand = 0; // Don't expand to prevent white box from sticking out of speech bubbles
        const ymin = Math.max(0, block.box_2d[0] - expand);
        const xmin = Math.max(0, block.box_2d[1] - expand);
        const ymax = Math.min(1000, block.box_2d[2] + expand);
        const xmax = Math.min(1000, block.box_2d[3] + expand);
        
        const top = `${ymin / 10}%`;
        const height = `${(ymax - ymin) / 10}%`;
        const width = `${(xmax - xmin) / 10}%`;
        const left = `${xmin / 10}%`;
        
        const isSelected = selectedBlock === index;
        const isMultiSelected = selectedBlockIndices.includes(index);

        return (
          <motion.div
            key={`${index}-${windowWidth}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: isSelected ? 1 : 1.02 }}
            className={`absolute transition-all duration-200 ease-in-out flex flex-col items-center justify-center group ${
              isSelected 
                ? 'bg-white z-50 shadow-2xl rounded-2xl p-3 sm:p-4 border-2 border-indigo-600' 
                : isMultiSelected
                  ? 'bg-indigo-50/95 z-20 rounded-2xl ring-2 ring-indigo-500 shadow-md cursor-pointer'
                  : 'bg-white/95 z-10 rounded-2xl hover:ring-2 hover:ring-indigo-400 cursor-pointer shadow-sm'
            }`}
            style={{ 
              top, 
              left,
              width: isSelected ? 'max-content' : width, 
              height: isSelected ? 'auto' : height,
              minWidth: isSelected ? width : undefined,
              minHeight: isSelected ? height : undefined,
              maxWidth: isSelected ? '320px' : undefined,
            }}
            onClick={(e) => {
              if (!isSelected) {
                handleSelectBlock(index, block);
              }
            }}
          >
            {isMultiSelected && !isSelected && (
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-2 -right-2 bg-indigo-600 text-white rounded-full p-0.5 shadow-md z-20"
              >
                <Check className="w-3 h-3" />
              </motion.div>
            )}
            {isSelected && onDeleteBlock && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteBlock(index);
                  setSelectedBlock(null);
                }}
                className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 transition-colors z-10"
                aria-label="Delete text block"
              >
                <X className="w-4 h-4" />
              </motion.button>
            )}
            
            {isSelected ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col w-full min-w-[200px] sm:min-w-[250px] max-w-[85vw]" 
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  value={editingText}
                  onChange={handleTextChange}
                  className="w-full p-2 border border-gray-300 rounded text-sm mb-2 resize-y min-h-[80px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
                
                <div className="flex flex-col space-y-1 mb-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-gray-500">Font Size (pt/px)</label>
                    <span className="text-[10px] font-mono bg-gray-100 px-1 rounded">
                      {editingFontSize || 'Auto'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input 
                      type="range" 
                      min="0" 
                      max="40" 
                      step="0.5"
                      value={editingFontSize || 0}
                      onChange={handleFontSizeChange}
                      className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <input 
                      type="number" 
                      min="0" 
                      max="100" 
                      step="0.5"
                      value={editingFontSize || 0}
                      onChange={handleFontSizeChange}
                      className="w-16 p-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <p className="text-[9px] text-gray-400 italic">Set to 0 for auto-scaling</p>
                </div>

                <div className="flex space-x-4 mb-3">
                  <div className="flex flex-col space-y-1 flex-1">
                    <label className="text-[10px] font-bold uppercase text-gray-500">Font Weight</label>
                    <div className="flex rounded-md shadow-sm">
                      <button
                        type="button"
                        onClick={() => setEditingFontWeight('normal')}
                        className={`flex-1 px-2 py-1 text-xs font-medium border rounded-l-md ${editingFontWeight === 'normal' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingFontWeight('bold')}
                        className={`flex-1 px-2 py-1 text-xs font-bold border-t border-b border-r rounded-r-md ${editingFontWeight === 'bold' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      >
                        Bold
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="text-[10px] font-bold uppercase text-gray-500">Color</label>
                    <input 
                      type="color" 
                      value={editingColor}
                      onChange={(e) => setEditingColor(e.target.value)}
                      className="h-7 w-12 p-0 border-0 rounded cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedBlock(null)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleSaveEdit(index)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded"
                  >
                    Save
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <>
                <AutoText text={block.translatedText} originalText={block.originalText} isSelected={isSelected} manualFontSize={block.fontSize} fontFamily={fontFamily} fontWeight={block.fontWeight} color={block.color} />
                {block.fontSize && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -left-1 bg-indigo-600 text-white rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-20" 
                    title={`Manual Font Size: ${block.fontSize}px`}
                  >
                    <Sliders className="w-2.5 h-2.5" />
                  </motion.div>
                )}
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
