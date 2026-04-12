import React, { useState, useEffect } from 'react';
import { HistoryItem, getHistory, clearHistory, deleteHistoryItem } from '../utils/historyService';
import { X, Trash2, Clock, Image as ImageIcon } from 'lucide-react';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectHistoryItem: (item: HistoryItem) => void;
}

export function HistoryModal({ isOpen, onClose, onSelectHistoryItem }: HistoryModalProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setLoading(true);
    const data = await getHistory();
    setHistory(data);
    setLoading(false);
  };

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
    setShowConfirmClear(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteHistoryItem(id);
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Translation History</h2>
          </div>
          <div className="flex items-center space-x-1 sm:space-x-2">
            {history.length > 0 && (
              <button
                onClick={() => setShowConfirmClear(true)}
                className="text-sm text-red-600 hover:text-red-700 font-medium px-4 py-2 rounded-lg hover:bg-red-50 transition-colors min-h-[44px] flex items-center justify-center"
              >
                Clear All
              </button>
            )}
            <button
              onClick={onClose}
              className="p-3 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
              <ImageIcon className="w-12 h-12 mb-3 text-gray-300" />
              <p>No translation history yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectHistoryItem(item)}
                  className="group relative bg-gray-50 rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:border-indigo-400 hover:shadow-md transition-all"
                >
                  <div className="aspect-[3/4] w-full bg-gray-200 relative">
                    <img
                      src={item.imageUrl}
                      alt="Translated page"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {item.sourceLang} → {item.targetLang}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="absolute top-2 right-2 p-2 bg-white/90 text-red-500 rounded-full opacity-100 sm:opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 transition-all shadow-sm min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    <Trash2 className="w-5 h-5 sm:w-4 sm:h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showConfirmClear && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Clear History</h3>
            <p className="text-gray-600">Are you sure you want to clear all translation history? This action cannot be undone.</p>
            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
