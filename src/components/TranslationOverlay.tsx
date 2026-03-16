import React, { useState, useRef, useEffect } from 'react';
import { TranslationBlock } from '../utils/geminiService';
import { X, Sliders } from 'lucide-react';

interface TranslationOverlayProps {
  imageUrl: string;
  blocks: TranslationBlock[];
  onDeleteBlock?: (index: number) => void;
  onEditBlock?: (index: number, newText: string, newFontSize?: number) => void;
  fontFamily?: string;
}

function AutoText({ text, originalText, isSelected, manualFontSize, fontFamily }: { text: string, originalText: string, isSelected: boolean, manualFontSize?: number, fontFamily?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [fontSize, setFontSize] = useState(manualFontSize || 14);

  useEffect(() => {
    if (isSelected) {
      setFontSize(manualFontSize || 16);
      return;
    }

    if (manualFontSize) {
      setFontSize(manualFontSize);
      return;
    }
    
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    // Reset for measurement
    textEl.style.fontSize = '12px';
    
    const padding = 6; // Slightly more padding for better look
    const availableHeight = container.clientHeight - padding;
    const availableWidth = container.clientWidth - padding;
    
    if (availableHeight <= 0 || availableWidth <= 0) return;

    let min = 8;
    let max = 80; // Increased max for large bubbles
    let best = min;

    // Binary search for best font size
    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      textEl.style.fontSize = `${mid}px`;
      
      // For measurement, we want to see if it fits within the width with wrapping
      // We also account for line-height by checking scrollHeight
      const isHeightOk = textEl.scrollHeight <= availableHeight;
      const isWidthOk = textEl.scrollWidth <= availableWidth;

      if (isHeightOk && isWidthOk) {
        best = mid;
        min = mid + 1;
      } else {
        max = mid - 1;
      }
    }
    
    setFontSize(best);
  }, [text, originalText, isSelected, manualFontSize, containerRef.current?.clientWidth, containerRef.current?.clientHeight]);

  return (
    <div 
      ref={containerRef} 
      className={`w-full h-full flex items-center justify-center ${isSelected ? 'overflow-y-auto max-h-[250px] scrollbar-thin p-2' : 'overflow-hidden p-0.5'}`}
    >
      <p 
        ref={textRef} 
        className="text-black text-center font-bold leading-[1.15] m-0 p-0" 
        style={{ 
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          fontSize: `${fontSize}px`,
          fontFamily: fontFamily || '"Comic Neue", Kalam, sans-serif',
          width: '100%'
        }}
      >
        {text}
      </p>
    </div>
  );
}

export function TranslationOverlay({ imageUrl, blocks, onDeleteBlock, onEditBlock, fontFamily }: TranslationOverlayProps) {
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingFontSize, setEditingFontSize] = useState<number | undefined>(undefined);

  // Re-run scaling when window resizes
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectBlock = (index: number, block: TranslationBlock) => {
    if (selectedBlock === index) {
      setSelectedBlock(null);
    } else {
      setSelectedBlock(index);
      setEditingText(block.translatedText);
      setEditingFontSize(block.fontSize);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingText(e.target.value);
  };

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setEditingFontSize(val === 0 ? undefined : val);
  };

  const handleSaveEdit = (index: number) => {
    if (onEditBlock) {
      onEditBlock(index, editingText.trim(), editingFontSize);
    }
    setSelectedBlock(null);
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto overflow-hidden rounded-xl shadow-lg border border-gray-200 bg-gray-50">
      <img src={imageUrl} alt="Manga page" className="w-full h-auto block" />
      
      {blocks.map((block, index) => {
        const expand = 5; // Expand bounding box by 0.5% to cover artifacts and improve centering
        const ymin = Math.max(0, block.box_2d[0] - expand);
        const xmin = Math.max(0, block.box_2d[1] - expand);
        const ymax = Math.min(1000, block.box_2d[2] + expand);
        const xmax = Math.min(1000, block.box_2d[3] + expand);
        
        const top = `${ymin / 10}%`;
        const height = `${(ymax - ymin) / 10}%`;
        const width = `${(xmax - xmin) / 10}%`;
        const left = `${xmin / 10}%`;
        
        const isSelected = selectedBlock === index;

        return (
          <div
            key={`${index}-${windowWidth}`}
            className={`absolute transition-all duration-200 ease-in-out flex flex-col items-center justify-center group ${
              isSelected 
                ? 'bg-white z-50 shadow-2xl rounded-md p-3 sm:p-4 border-2 border-indigo-600' 
                : 'bg-white/95 z-10 rounded-sm hover:ring-2 hover:ring-indigo-400 cursor-pointer shadow-sm'
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
            {isSelected && onDeleteBlock && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteBlock(index);
                  setSelectedBlock(null);
                }}
                className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 transition-colors z-10"
                aria-label="Delete text block"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            
            {isSelected ? (
              <div className="flex flex-col w-full min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={editingText}
                  onChange={handleTextChange}
                  className="w-full p-2 border border-gray-300 rounded text-sm mb-2 resize-y min-h-[80px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
                
                <div className="flex flex-col space-y-1 mb-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-gray-500">Font Size</label>
                    <span className="text-[10px] font-mono bg-gray-100 px-1 rounded">
                      {editingFontSize || 'Auto'}
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="40" 
                    step="1"
                    value={editingFontSize || 0}
                    onChange={handleFontSizeChange}
                    className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <p className="text-[9px] text-gray-400 italic">Set to 0 for auto-scaling</p>
                </div>

                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setSelectedBlock(null)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSaveEdit(index)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <AutoText text={block.translatedText} originalText={block.originalText} isSelected={isSelected} manualFontSize={block.fontSize} fontFamily={fontFamily} />
                {block.fontSize && (
                  <div className="absolute -top-1 -left-1 bg-indigo-600 text-white rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-20" title={`Manual Font Size: ${block.fontSize}px`}>
                    <Sliders className="w-2.5 h-2.5" />
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
