import React, { useState, useRef, useEffect } from 'react';
import { TranslationBlock } from '../utils/geminiService';
import { X } from 'lucide-react';

interface TranslationOverlayProps {
  imageUrl: string;
  blocks: TranslationBlock[];
  onDeleteBlock?: (index: number) => void;
  onEditBlock?: (index: number, newText: string) => void;
}

function AutoText({ text, originalText, isSelected }: { text: string, originalText: string, isSelected: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [fontSize, setFontSize] = useState(14);

  useEffect(() => {
    if (isSelected) {
      setFontSize(16); // Fixed size when selected
      if (textRef.current) textRef.current.style.fontSize = '16px';
      return;
    }
    
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    let min = 6;
    
    // Estimate original font size based on container area and original text length
    const paddingX = 12; // 6px padding on all sides
    const paddingY = 12;
    const availableHeight = container.clientHeight - paddingY;
    const availableWidth = container.clientWidth - paddingX;
    
    const textArea = Math.max(0, availableWidth) * Math.max(0, availableHeight);
    const originalCharCount = Math.max(1, originalText.replace(/\s/g, '').length);
    
    // For CJK characters, area ≈ charCount * (fontSize * 1.2 * fontSize)
    let estimatedOriginalFontSize = Math.sqrt(textArea / (1.2 * originalCharCount));
    
    // Constrain it to reasonable bounds and add a small buffer (1.2x) for estimation errors
    estimatedOriginalFontSize = Math.max(12, Math.min(estimatedOriginalFontSize * 1.2, container.clientHeight / 1.5));
    
    let max = Math.floor(estimatedOriginalFontSize);
    let best = min;

    // Binary search for best font size
    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      textEl.style.fontSize = `${mid}px`;
      
      if (textEl.scrollHeight <= availableHeight && textEl.scrollWidth <= availableWidth) {
        best = mid;
        min = mid + 1;
      } else {
        max = mid - 1;
      }
    }
    
    setFontSize(best);
    textEl.style.fontSize = `${best}px`;
  }, [text, originalText, isSelected]);

  return (
    <div ref={containerRef} className={`w-full h-full flex flex-col items-center justify-center ${isSelected ? 'overflow-y-auto max-h-[250px] scrollbar-thin p-2' : 'overflow-hidden p-1.5'}`}>
      <p 
        ref={textRef} 
        className={`font-comic text-black text-center font-bold ${isSelected ? 'leading-snug' : 'leading-[1.1]'}`} 
        style={{ 
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          hyphens: 'auto',
          fontSize: `${fontSize}px`,
          width: '100%',
          margin: 0
        }}
      >
        {text}
      </p>
    </div>
  );
}

export function TranslationOverlay({ imageUrl, blocks, onDeleteBlock, onEditBlock }: TranslationOverlayProps) {
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // Re-run scaling when window resizes
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectBlock = (index: number, currentText: string) => {
    if (selectedBlock === index) {
      setSelectedBlock(null);
    } else {
      setSelectedBlock(index);
      setEditingText(currentText);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingText(e.target.value);
  };

  const handleSaveEdit = (index: number) => {
    if (onEditBlock && editingText.trim() !== blocks[index].translatedText) {
      onEditBlock(index, editingText.trim());
    }
    setSelectedBlock(null);
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto overflow-hidden rounded-xl shadow-lg border border-gray-200 bg-gray-50">
      <img src={imageUrl} alt="Manga page" className="w-full h-auto block" />
      
      {blocks.map((block, index) => {
        const expand = 2; // Expand bounding box by 0.2% to cover artifacts
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
            key={`${index}-${windowWidth}`} // Force re-render on resize for AutoText
            className={`absolute transition-all duration-200 ease-in-out flex flex-col items-center justify-center ${
              isSelected 
                ? 'bg-white z-50 shadow-2xl rounded p-3 sm:p-4 border-2 border-indigo-600' 
                : 'bg-white z-10 rounded hover:ring-2 hover:ring-indigo-400 cursor-pointer'
            }`}
            style={{ 
              top, 
              left,
              width: isSelected ? 'max-content' : width, 
              height: isSelected ? 'auto' : height,
              minWidth: isSelected ? width : undefined,
              minHeight: isSelected ? height : undefined,
              maxWidth: isSelected ? '280px' : undefined,
              boxShadow: isSelected ? undefined : 'none',
            }}
            onClick={(e) => {
              if (!isSelected) {
                handleSelectBlock(index, block.translatedText);
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
              <AutoText text={block.translatedText} originalText={block.originalText} isSelected={isSelected} />
            )}
          </div>
        );
      })}
    </div>
  );
}
