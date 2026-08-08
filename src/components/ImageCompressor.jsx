import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Download,
  RefreshCw,
  Sparkles,
  Sliders,
  AlertCircle,
  FileImage
} from 'lucide-react';

const FORMAT_OPTIONS = ['WEBP', 'JPEG', 'PNG'];
const MAX_WIDTH_OPTIONS = [
  { label: 'Original', value: 'original' },
  { label: '1920px', value: '1920' },
  { label: '1280px', value: '1280' },
  { label: '800px', value: '800' },
];

const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const getImageDimensionsFromUrl = (url) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
};

/**
 * Dual Engine Client-Side Compression
 * Primary: browser-image-compression library. Fallback: HTML5 Canvas 2D engine.
 */
const compressImageClientSide = async (file, format, quality, maxWidth) => {
  const mimeMap = {
    WEBP: 'image/webp',
    JPEG: 'image/jpeg',
    PNG: 'image/png',
  };
  const targetMime = mimeMap[format] || 'image/webp';
  const qualityDecimal = quality / 100;

  const tempOriginalUrl = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = tempOriginalUrl;
  });

  let targetWidth = img.naturalWidth;
  let targetHeight = img.naturalHeight;

  if (maxWidth !== 'original' && !isNaN(Number(maxWidth))) {
    const maxW = Number(maxWidth);
    if (targetWidth > maxW) {
      const ratio = maxW / targetWidth;
      targetWidth = maxW;
      targetHeight = Math.round(img.naturalHeight * ratio);
    }
  }

  // Engine 1: browser-image-compression NPM library
  try {
    const imageCompressionModule = (await import('browser-image-compression')).default;
    const targetMB = Math.max(0.001, (file.size / (1024 * 1024)) * qualityDecimal);
    
    const options = {
      maxSizeMB: targetMB,
      maxWidthOrHeight: maxWidth === 'original' ? undefined : Number(maxWidth),
      useWebWorker: true,
      fileType: targetMime,
      initialQuality: qualityDecimal,
    };

    const compressedBlob = await imageCompressionModule(file, options);
    if (compressedBlob && compressedBlob.size > 0) {
      URL.revokeObjectURL(tempOriginalUrl);
      return compressedBlob;
    }
  } catch (err) {
    console.warn('Worker engine notice, using Canvas fallback:', err);
  }

  // Engine 2: HTML5 Canvas 2D Export
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    URL.revokeObjectURL(tempOriginalUrl);
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  URL.revokeObjectURL(tempOriginalUrl);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas blob generation failed'));
        }
      },
      targetMime,
      qualityDecimal
    );
  });
};

export default function ImageCompressor() {
  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [originalDims, setOriginalDims] = useState({ width: 0, height: 0 });

  const [compressedBlob, setCompressedBlob] = useState(null);
  const [compressedUrl, setCompressedUrl] = useState(null);
  const [compressedDims, setCompressedDims] = useState({ width: 0, height: 0 });

  const [format, setFormat] = useState('WEBP');
  const [quality, setQuality] = useState(80);
  const [maxWidth, setMaxWidth] = useState('original');

  const [isCompressing, setIsCompressing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);
  const compressionSeq = useRef(0);
  
  const currentOriginalUrlRef = useRef(null);
  const currentCompressedUrlRef = useRef(null);

  const updateCompressedUrl = (newUrl) => {
    if (currentCompressedUrlRef.current && currentCompressedUrlRef.current !== newUrl) {
      URL.revokeObjectURL(currentCompressedUrlRef.current);
    }
    currentCompressedUrlRef.current = newUrl;
    setCompressedUrl(newUrl);
  };

  const updateOriginalUrl = (newUrl) => {
    if (currentOriginalUrlRef.current && currentOriginalUrlRef.current !== newUrl) {
      URL.revokeObjectURL(currentOriginalUrlRef.current);
    }
    currentOriginalUrlRef.current = newUrl;
    setOriginalUrl(newUrl);
  };

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setError('Please select a valid image file (JPEG, PNG, or WEBP).');
      return;
    }
    setError(null);

    const newOriginalUrl = URL.createObjectURL(selectedFile);
    updateOriginalUrl(newOriginalUrl);
    
    const dims = await getImageDimensionsFromUrl(newOriginalUrl);
    setFile(selectedFile);
    setOriginalDims(dims);
    setCompressedBlob(null);
    setCompressedDims({ width: 0, height: 0 });
    
    if (currentCompressedUrlRef.current) {
      URL.revokeObjectURL(currentCompressedUrlRef.current);
      currentCompressedUrlRef.current = null;
      setCompressedUrl(null);
    }
  };

  const executeCompression = useCallback(async (inputFile, targetFormat, targetQuality, targetMaxWidth) => {
    if (!inputFile) return;

    const seq = ++compressionSeq.current;
    setIsCompressing(true);
    setError(null);

    try {
      const resultBlob = await compressImageClientSide(inputFile, targetFormat, targetQuality, targetMaxWidth);

      if (seq !== compressionSeq.current) return;

      const newUrl = URL.createObjectURL(resultBlob);
      const dims = await getImageDimensionsFromUrl(newUrl);

      if (seq !== compressionSeq.current) {
        URL.revokeObjectURL(newUrl);
        return;
      }

      setCompressedBlob(resultBlob);
      setCompressedDims(dims);
      updateCompressedUrl(newUrl);
    } catch (err) {
      console.error('Compression failure:', err);
      setError('Error compressing image. Please adjust settings.');
    } finally {
      if (seq === compressionSeq.current) {
        setIsCompressing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (file) {
      const handler = setTimeout(() => {
        executeCompression(file, format, quality, maxWidth);
      }, 150);
      return () => clearTimeout(handler);
    }
  }, [file, format, quality, maxWidth, executeCompression]);

  useEffect(() => {
    const handlePaste = (e) => {
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        const pastedFile = e.clipboardData.files[0];
        if (pastedFile.type.startsWith('image/')) {
          handleFileSelect(pastedFile);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDownload = () => {
    if (!compressedBlob || !compressedUrl) return;
    const link = document.createElement('a');
    const ext = format.toLowerCase();
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    link.href = compressedUrl;
    link.download = `${baseName}-compressed.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    if (currentOriginalUrlRef.current) {
      URL.revokeObjectURL(currentOriginalUrlRef.current);
      currentOriginalUrlRef.current = null;
    }
    if (currentCompressedUrlRef.current) {
      URL.revokeObjectURL(currentCompressedUrlRef.current);
      currentCompressedUrlRef.current = null;
    }
    setFile(null);
    setOriginalUrl(null);
    setCompressedBlob(null);
    setCompressedUrl(null);
    setError(null);
  };

  const originalSize = file ? file.size : 0;
  const compressedSize = compressedBlob ? compressedBlob.size : 0;
  const bytesSaved = Math.max(0, originalSize - compressedSize);
  const percentageSaved = originalSize > 0 && compressedSize > 0
    ? (((originalSize - compressedSize) / originalSize) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 sm:space-y-8">
      {/* 1. Dropzone */}
      {!file ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload image file to compress"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl sm:rounded-3xl p-6 sm:p-10 md:p-16 text-center cursor-pointer transition-all duration-300 ${
            isDragging
              ? 'border-blue-500 bg-blue-50/70 scale-[1.01] shadow-lg'
              : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50/80 shadow-sm hover:shadow-md'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg, image/webp"
            aria-label="File upload selector"
            className="hidden"
            onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
          />
          
          <div className="flex flex-col items-center justify-center space-y-3 sm:space-y-4">
            <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
              <Upload className="w-7 h-7 sm:w-10 sm:h-10" />
            </div>
            
            <div className="space-y-1 px-2">
              <h3 className="text-lg sm:text-xl font-bold text-slate-800">
                Drop your image here, or <span className="text-blue-600 underline underline-offset-4">browse</span>
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                Supports WEBP, JPEG, and PNG formats. Images are compressed locally inside your browser.
              </p>
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-medium text-slate-400">
              <span className="px-2.5 py-1 bg-slate-100 rounded-full border border-slate-200">Zero Server Uploads</span>
              <span className="px-2.5 py-1 bg-slate-100 rounded-full border border-slate-200">Paste Ctrl+V Supported</span>
              <span className="px-2.5 py-1 bg-slate-100 rounded-full border border-slate-200">100% Private</span>
            </div>
          </div>
        </div>
      ) : (
        /* 2. Main Workspace */
        <div className="space-y-6 sm:space-y-8 animate-fadeIn">
          
          {/* Header Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center space-x-3 truncate">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <FileImage className="w-5 h-5" />
              </div>
              <div className="truncate">
                <h2 className="font-semibold text-sm sm:text-base text-slate-800 truncate">{file.name}</h2>
                <p className="text-[11px] sm:text-xs text-slate-500">Original: {formatBytes(originalSize)}</p>
              </div>
            </div>

            <button
              onClick={handleReset}
              aria-label="Choose another image to compress"
              className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Choose Another Image</span>
            </button>
          </div>

          {/* 3. Control Panel */}
          <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl border border-slate-200/80 shadow-sm space-y-5 sm:space-y-6">
            <div className="flex items-center space-x-2 border-b border-slate-100 pb-3.5 sm:pb-4">
              <Sliders className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              <h3 className="font-bold text-slate-800 text-base sm:text-lg">Compression Settings</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
              
              {/* Option A: Target Format */}
              <div className="space-y-1.5 sm:space-y-2">
                <label id="format-label" className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">
                  Target Format
                </label>
                <div role="group" aria-labelledby="format-label" className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  {FORMAT_OPTIONS.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      aria-label={`Select ${f} target image format`}
                      aria-pressed={format === f}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                        format === f
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Option B: Quality Level Slider */}
              <div className="space-y-1.5 sm:space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor="quality-slider" className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">
                    Quality Level
                  </label>
                  <span className="text-xs font-bold px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md">
                    {quality}%
                  </span>
                </div>
                <div className="pt-1.5 sm:pt-2">
                  <input
                    id="quality-slider"
                    type="range"
                    min="5"
                    max="100"
                    step="1"
                    value={quality}
                    aria-label="Compression quality level percentage"
                    aria-valuenow={quality}
                    aria-valuemin={5}
                    aria-valuemax={100}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                    <span>Max Savings</span>
                    <span>Best Quality</span>
                  </div>
                </div>
              </div>

              {/* Option C: Max Resolution Width */}
              <div className="space-y-1.5 sm:space-y-2">
                <label id="resolution-label" className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">
                  Max Resolution Width
                </label>
                <div role="group" aria-labelledby="resolution-label" className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  {MAX_WIDTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMaxWidth(opt.value)}
                      aria-label={`Set resolution width to ${opt.label}`}
                      aria-pressed={maxWidth === opt.value}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                        maxWidth === opt.value
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div role="alert" className="flex items-center space-x-3 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 4. Results Grid */}
          <div aria-live="polite" className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            
            {/* Card 1: Original Size */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-1">
              <span className="text-[11px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider">Original Size</span>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-800">
                {formatBytes(originalSize)}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-mono">
                {originalDims.width} × {originalDims.height} px
              </p>
            </div>

            {/* Card 2: Compressed Size */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-1 relative overflow-hidden">
              <span className="text-[11px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider">Compressed Size</span>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-800 flex items-center space-x-2">
                {isCompressing ? (
                  <span className="text-slate-400 text-base sm:text-lg animate-pulse">Calculating...</span>
                ) : (
                  <span>{formatBytes(compressedSize)}</span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-mono">
                {compressedDims.width ? `${compressedDims.width} × ${compressedDims.height} px` : '--'}
              </p>
            </div>

            {/* Card 3: Space Saved */}
            <div className="bg-emerald-50/80 p-4 sm:p-5 rounded-2xl border border-emerald-200/80 shadow-sm space-y-1">
              <span className="text-[11px] sm:text-xs font-semibold text-emerald-600 uppercase tracking-wider">Space Saved</span>
              <div className="text-xl sm:text-2xl font-black text-emerald-600">
                {isCompressing ? (
                  <span className="text-emerald-400 text-base sm:text-lg animate-pulse">Compressing...</span>
                ) : (
                  <span>{Number(percentageSaved) > 0 ? `-${percentageSaved}%` : '0%'}</span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-emerald-700 font-medium">
                {isCompressing ? 'Optimizing pixels' : `Saved ${formatBytes(bytesSaved)}`}
              </p>
            </div>

          </div>

          {/* 5. Visual Quality Preview */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-3.5 sm:space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm sm:text-base flex items-center space-x-2">
                <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                <span>Visual Quality Comparison</span>
              </h3>
              {isCompressing && (
                <div className="flex items-center space-x-1.5 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              
              {/* Original Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Original Image</span>
                  <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px]">{file.type.split('/')[1]?.toUpperCase()}</span>
                </div>
                <div className="relative aspect-video rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center min-h-[160px] max-h-[300px]">
                  {originalUrl && (
                    <img
                      src={originalUrl}
                      alt="Original image full preview before compression"
                      className="max-h-full max-w-full object-contain"
                    />
                  )}
                </div>
              </div>

              {/* Compressed Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Compressed Output</span>
                  <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-bold text-[11px]">{format}</span>
                </div>
                <div className="relative aspect-video rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center min-h-[160px] max-h-[300px]">
                  {isCompressing && (
                    <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex items-center justify-center">
                      <div className="flex flex-col items-center space-y-2 text-blue-600">
                        <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 animate-spin" />
                        <span className="text-xs font-semibold">Applying algorithms...</span>
                      </div>
                    </div>
                  )}
                  {compressedUrl ? (
                    <img
                      src={compressedUrl}
                      alt="Compressed output image preview"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-slate-400 text-xs">Waiting for processing...</span>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* 6. Download Button */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleDownload}
              disabled={isCompressing || !compressedBlob}
              aria-label="Download compressed image to your device"
              className={`w-full sm:w-auto min-w-0 sm:min-w-[280px] py-3.5 sm:py-4 px-6 sm:px-8 rounded-2xl font-bold text-base sm:text-lg flex items-center justify-center space-x-2.5 transition-all duration-200 ${
                isCompressing || !compressedBlob
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0'
              }`}
            >
              <Download className="w-5 h-5 sm:w-6 sm:h-6" />
              <span>Download Compressed Image</span>
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
