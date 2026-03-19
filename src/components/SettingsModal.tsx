import React, { useState, useEffect } from 'react';
import { X, Key, Save, Trash2, Cpu, Download, Bell, Database, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { getCustomApiKey, setCustomApiKey } from '../utils/geminiService';
import { getAllTranslationMemoryPairs, getTranslationMemory, deleteTranslationMemoryEntry, TranslationMemoryEntry } from '../utils/translationMemoryService';

export const AVAILABLE_MODELS = [
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite (Fastest)' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview (Fast)' },
  { id: 'gemini-flash-latest', name: 'Gemini Flash Latest (Stable)' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview (Best Quality)' }
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  autoDownload: boolean;
  onAutoDownloadChange: (autoDownload: boolean) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  temperature: number;
  onTemperatureChange: (temp: number) => void;
}

export function SettingsModal({ isOpen, onClose, selectedModel, onModelChange, autoDownload, onAutoDownloadChange, notificationsEnabled, onNotificationsEnabledChange, temperature, onTemperatureChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'memory'>('general');
  const [apiKey, setApiKey] = useState('');
  const [localModel, setLocalModel] = useState(selectedModel);
  const [localAutoDownload, setLocalAutoDownload] = useState(autoDownload);
  const [localNotificationsEnabled, setLocalNotificationsEnabled] = useState(notificationsEnabled);
  const [localTemperature, setLocalTemperature] = useState(temperature);
  const [saved, setSaved] = useState(false);

  // Memory state
  const [memoryPairs, setMemoryPairs] = useState<string[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>('');
  const [memoryEntries, setMemoryEntries] = useState<TranslationMemoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getCustomApiKey() || '');
      setLocalModel(selectedModel);
      setLocalAutoDownload(autoDownload);
      setLocalNotificationsEnabled(notificationsEnabled);
      setLocalTemperature(temperature);
      setSaved(false);
      if (activeTab === 'memory') {
        loadMemoryPairs();
      }
    }
  }, [isOpen, selectedModel, autoDownload, notificationsEnabled, temperature, activeTab]);

  const loadMemoryPairs = async () => {
    const pairs = await getAllTranslationMemoryPairs();
    setMemoryPairs(pairs);
    if (pairs.length > 0 && !selectedPair) {
      setSelectedPair(pairs[0]);
    }
  };

  useEffect(() => {
    if (selectedPair && activeTab === 'memory') {
      loadMemoryEntries();
    }
  }, [selectedPair, activeTab]);

  const loadMemoryEntries = async () => {
    if (!selectedPair) return;
    setIsLoadingMemory(true);
    try {
      const [sourceLang, targetLang] = selectedPair.split('_');
      const memory = await getTranslationMemory(sourceLang, targetLang);
      setMemoryEntries(Object.values(memory).sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      console.error("Failed to load memory entries", e);
    } finally {
      setIsLoadingMemory(false);
    }
  };

  const handleDeleteEntry = async (originalText: string) => {
    if (!selectedPair) return;
    const [sourceLang, targetLang] = selectedPair.split('_');
    await deleteTranslationMemoryEntry(sourceLang, targetLang, originalText);
    setMemoryEntries(prev => prev.filter(entry => entry.originalText !== originalText));
  };

  if (!isOpen) return null;

  const handleSave = () => {
    setCustomApiKey(apiKey.trim() || null);
    onModelChange(localModel);
    onAutoDownloadChange(localAutoDownload);
    onNotificationsEnabledChange(localNotificationsEnabled);
    onTemperatureChange(localTemperature);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    setApiKey('');
    setCustomApiKey(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const filteredEntries = memoryEntries.filter(entry => 
    entry.originalText.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.translatedText.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
          <div className="flex items-center space-x-2">
            <Key className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'general' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'memory' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Translation Memory
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {activeTab === 'general' ? (
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label htmlFor="modelSelect" className="block text-sm font-medium text-gray-700 mb-1 flex items-center space-x-2">
                    <Cpu className="w-4 h-4 text-indigo-500" />
                    <span>AI Model</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Choose the Gemini model for translation. Pro is more accurate, Flash is faster.
                  </p>
                  <select
                    id="modelSelect"
                    value={localModel}
                    onChange={(e) => setLocalModel(e.target.value)}
                    className="w-full px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-white min-h-[44px]"
                  >
                    {AVAILABLE_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label htmlFor="temperatureSlider" className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Cpu className="w-4 h-4 text-indigo-500" />
                      <span>Temperature: {localTemperature.toFixed(1)}</span>
                    </div>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Control the creativity and randomness of the generated translations. Lower values result in more predictable output, while higher values encourage more diverse translations.
                  </p>
                  <input
                    id="temperatureSlider"
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={localTemperature}
                    onChange={(e) => setLocalTemperature(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 min-h-[24px]"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0.0</span>
                    <span>2.0</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label className="flex items-start space-x-3 cursor-pointer p-2 -ml-2 rounded-lg hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={localAutoDownload}
                      onChange={(e) => setLocalAutoDownload(e.target.checked)}
                      className="w-5 h-5 mt-0.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 min-w-[20px] min-h-[20px]"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-700 flex items-center space-x-2">
                        <Download className="w-4 h-4 text-indigo-500" />
                        <span>Auto-Download Batch</span>
                      </span>
                      <span className="text-xs text-gray-500 mt-1">
                        Automatically download the PDF when batch translation completes.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label className="flex items-start space-x-3 cursor-pointer p-2 -ml-2 rounded-lg hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={localNotificationsEnabled}
                      onChange={(e) => setLocalNotificationsEnabled(e.target.checked)}
                      className="w-5 h-5 mt-0.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 min-w-[20px] min-h-[20px]"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-700 flex items-center space-x-2">
                        <Bell className="w-4 h-4 text-indigo-500" />
                        <span>Enable Notifications</span>
                      </span>
                      <span className="text-xs text-gray-500 mt-1">
                        Show toast messages for translation status and errors.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1 flex items-center space-x-2">
                    <Key className="w-4 h-4 text-indigo-500" />
                    <span>Custom Gemini API Key</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Use your own API key to bypass rate limits. Your key is stored locally in your browser and never sent to our servers.
                  </p>
                  <input
                    type="password"
                    id="apiKey"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors min-h-[44px]"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Language Pair</label>
                  <select
                    value={selectedPair}
                    onChange={(e) => setSelectedPair(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  >
                    {memoryPairs.length === 0 && <option value="">No memory found</option>}
                    {memoryPairs.map(pair => {
                      const [source, target] = pair.split('_');
                      return (
                        <option key={pair} value={pair}>
                          {source} → {target}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">Search</label>
                    {memoryEntries.length > 0 && (
                      <button
                        onClick={async () => {
                          if (confirmClear) {
                            const [sourceLang, targetLang] = selectedPair.split('_');
                            const { clearTranslationMemory } = await import('../utils/translationMemoryService');
                            await clearTranslationMemory(sourceLang, targetLang);
                            setMemoryEntries([]);
                            setConfirmClear(false);
                          } else {
                            setConfirmClear(true);
                            setTimeout(() => setConfirmClear(false), 3000);
                          }
                        }}
                        className={`text-xs font-medium transition-colors ${confirmClear ? 'text-red-700 font-bold' : 'text-red-600 hover:text-red-700'}`}
                      >
                        {confirmClear ? 'Click again to confirm' : 'Clear All'}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search translations..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg bg-gray-50 min-h-[300px] flex flex-col">
                {isLoadingMemory ? (
                  <div className="flex-1 flex items-center justify-center p-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
                    <Database className="w-12 h-12 text-gray-300 mb-3" />
                    <p>No translation memory entries found.</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-2">
                    {filteredEntries.map((entry, idx) => (
                      <div key={`${entry.timestamp}-${idx}`} className="bg-white p-3 rounded border border-gray-200 shadow-sm flex flex-col sm:flex-row gap-3 group">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500 mb-1 font-medium">Original</div>
                          <div className="text-sm text-gray-900 break-words">{entry.originalText}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500 mb-1 font-medium">Translation</div>
                          <div className="text-sm text-gray-900 break-words">{entry.translatedText}</div>
                        </div>
                        <div className="flex items-start justify-end sm:w-10 flex-shrink-0">
                          <button
                            onClick={() => handleDeleteEntry(entry.originalText)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            title="Delete entry"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {activeTab === 'general' && (
          <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
            <button
              onClick={handleClear}
              className="flex items-center justify-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium min-h-[44px]"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Key</span>
            </button>
            <div className="flex items-center space-x-3">
              {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
              <button
                onClick={handleSave}
                className="flex items-center justify-center space-x-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors shadow-sm min-h-[44px]"
              >
                <Save className="w-4 h-4" />
                <span>Save</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
