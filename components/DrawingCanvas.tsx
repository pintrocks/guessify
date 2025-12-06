import React, { useRef, useEffect, useState } from 'react';

interface DrawingCanvasProps {
  onSave: (dataUrl: string) => void;
  targetDescription: string;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ onSave, targetDescription }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set initial canvas size based on container
    const resizeCanvas = () => {
        if (containerRef.current) {
            canvas.width = containerRef.current.clientWidth;
            canvas.height = Math.min(window.innerHeight * 0.5, 400); // Max height
            
            // Fill white background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initial white background needed for export
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const getCoordinates = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in event) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = (event as React.MouseEvent).clientX;
      clientY = (event as React.MouseEvent).clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault(); // Prevent scrolling on touch
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.closePath();
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleDone = () => {
    if (canvasRef.current) {
      onSave(canvasRef.current.toDataURL('image/png'));
    }
  };

  const colors = ['#000000', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#8B4513'];

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto animate-fade-in">
        
      <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 mb-4 rounded w-full">
        <p className="font-bold text-sm uppercase text-yellow-600 mb-1">Your Task</p>
        <p className="text-xl font-bold">{targetDescription}</p>
      </div>

      <div ref={containerRef} className="w-full border-4 border-gray-800 rounded-lg shadow-xl overflow-hidden touch-none bg-white mb-4">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="cursor-crosshair w-full"
        />
      </div>

      <div className="flex flex-wrap gap-2 justify-center mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'scale-125 border-gray-800 shadow-md' : 'border-transparent hover:scale-110'}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <div className="w-px h-8 bg-gray-300 mx-2"></div>
        <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-500">SIZE</span>
            <input 
                type="range" 
                min="2" 
                max="20" 
                value={brushSize} 
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-24 accent-indigo-600"
            />
        </div>
        <div className="w-px h-8 bg-gray-300 mx-2"></div>
        <button onClick={handleClear} className="text-red-500 text-xs font-bold hover:bg-red-50 px-2 py-1 rounded">CLEAR</button>
      </div>

      <button 
        onClick={handleDone}
        className="w-full bg-green-500 text-white font-black text-xl py-4 rounded-2xl shadow-[0_6px_0_0_rgba(21,128,61,1)] hover:bg-green-400 active:shadow-none active:translate-y-[6px] transition-all"
      >
        SUBMIT MASTERPIECE
      </button>
    </div>
  );
};
