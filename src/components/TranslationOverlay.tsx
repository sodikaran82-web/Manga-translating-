import React, { useState, useRef, useEffect } from 'react';
import { TranslationBlock } from '../utils/geminiService';
import { X } from 'lucide-react';

interface TranslationOverlayProps {
  imageUrl: string;
  blocks: TranslationBlock[];
  onDeleteBlock?: (index: number) => void;
}

function AutoText({ text, isSelected }: { text: string, isSelected: boolean }) {
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
    // Cap maximum font size dynamically based on container height to prevent oversized text
    // while still allowing larger text in very large bubbles to prevent excessive whitespace.
    let max = Math.min(36, Math.max(20, Math.floor(container.clientHeight / 3)));
    let best = 12;

    // Binary search for best font size
    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      textEl.style.fontSize = `${mid}px`;
      
      // Allow a tiny bit of overflow tolerance to prevent aggressive shrinking
      if (textEl.scrollHeight <= container.clientHeight + 2 && textEl.scrollWidth <= container.clientWidth + 2) {
        best = mid;
        min = mid + 1;
      } else {
        max = mid - 1;
      }
    }
    
    setFontSize(best);
    textEl.style.fontSize = `${best}px`;
  }, [text, isSelected]);

  return (
    <div ref={containerRef} className={`w-full h-full flex flex-col ${isSelected ? 'overflow-y-auto max-h-[250px] scrollbar-thin p-2' : 'overflow-hidden p-1.5'}`}>
      <p 
        ref={textRef} 
        className={`font-comic text-black text-center font-bold my-auto ${isSelected ? 'leading-snug' : 'leading-[1.1]'}`} 
        style={{ 
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          hyphens: 'auto',
          fontSize: `${fontSize}px`,
          width: '100%'
        }}
      >
        {text}
      </p>
    </div>
  );
}

export function TranslationOverlay({ imageUrl, blocks, onDeleteBlock }: TranslationOverlayProps) {
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);

  // Re-run scaling when window resizes
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full max-w-2xl mx-auto overflow-hidden rounded-xl shadow-lg border border-gray-200 bg-gray-50">
      <img src={imageUrl} alt="Manga page" className="w-full h-auto block" />
      
      {blocks.map((block, index) => {
        const expand = 15; // Expand bounding box by 1.5% to cover artifacts
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
            className={`absolute transition-all duration-200 ease-in-out cursor-pointer flex flex-col items-center justify-center ${
              isSelected 
                ? 'bg-white z-50 shadow-2xl rounded-2xl p-3 sm:p-4 border-2 border-indigo-600' 
                : 'bg-white z-10 rounded-2xl hover:ring-2 hover:ring-indigo-400'
            }`}
            style={{ 
              top, 
              left,
              width: isSelected ? 'max-content' : width, 
              height: isSelected ? 'auto' : height,
              minWidth: isSelected ? width : undefined,
              minHeight: isSelected ? height : undefined,
              maxWidth: isSelected ? '280px' : undefined,
              boxShadow: isSelected ? undefined : '0 0 12px 8px white',
            }}
            onClick={() => setSelectedBlock(isSelected ? null : index)}
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
            <AutoText text={block.translatedText} isSelected={isSelected} />
          </div>
        );
      })}
    </div>
  );
}
