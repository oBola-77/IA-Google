import React, { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import { 
  BoxSelect, Trash2, Plus, 
  Check, X, Layout, Eraser,
  Lock, Unlock, Settings, Save, Database, AlertTriangle, Eye,
  ScanBarcode, ArrowRight, Camera
} from 'lucide-react';

const App = () => {
  // --- Refs ---
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const classifier = useRef(null);
  const mobilenetModel = useRef(null);
  const requestRef = useRef(null);
  const predictTimeoutRef = useRef(null);
  const barcodeInputRef = useRef(null);
  
  const regionsRef = useRef([]);
  
  // --- Estados ---
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  
  // Câmeras
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // 'setup' | 'operator'
  const [viewMode, setViewMode] = useState('setup'); 
  const [isPredicting, setIsPredicting] = useState(false);
  
  // Fluxo do Operador
  const [currentBarcode, setCurrentBarcode] = useState(''); 
  
  // Configurações
  const [threshold, setThreshold] = useState(0.85); 
  const [backgroundSamples, setBackgroundSamples] = useState(0);

  // Dados
  const [regions, setRegions] = useState([
    { id: '1', name: 'Objeto 1', box: { x: 50, y: 50, w: 100, h: 100 }, samples: 0, status: null, confidence: 0 }
  ]);
  const [activeRegionId, setActiveRegionId] = useState('1');
  
  const [history, setHistory] = useState([]);

  // Interação
  const [interactionMode, setInteractionMode] = useState('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => { regionsRef.current = regions; }, [regions]);

  useEffect(() => {
    if (viewMode === 'operator' && !currentBarcode && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [viewMode, currentBarcode]);

  // --- Inicialização ---
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  useEffect(() => {
    const loadModels = async () => {
      try {
        window.tf = tf;
        await tf.ready();
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/knn-classifier');
        await new Promise(r => setTimeout(r, 500));

        if (window.knnClassifier && window.mobilenet) {
          classifier.current = window.knnClassifier.create();
          mobilenetModel.current = await window.mobilenet.load();
          setIsModelLoading(false);
        } else {
          throw new Error('Err: Modelos não carregaram.');
        }
      } catch (error) {
        setLoadingError("Erro ao carregar IA.");
        setIsModelLoading(false);
      }
    };

    const getDevices = async () => {
      try {
        // Solicita permissão primeiro para conseguir listar os nomes dos dispositivos
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(cameras);
        if (cameras.length > 0) {
            // Não seta o ID aqui para deixar o startWebcam escolher o padrão inicialmente
        }
      } catch (e) {
        console.error("Erro ao listar dispositivos:", e);
      }
    };

    loadModels();
    getDevices();
    startWebcam(); // Inicia com a câmera padrão

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (predictTimeoutRef.current) clearTimeout(predictTimeoutRef.current);
      
      // Cleanup: Stop video tracks
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  const startWebcam = async (deviceId = null) => {
    try {
      // Cancel previous loop if running
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }

      // Parar stream anterior se existir
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const constraints = {
          audio: false,
          video: { 
            // Se tiver ID, usa exact, senão tenta environment ou user
            deviceId: deviceId ? { exact: deviceId } : undefined,
            facingMode: deviceId ? undefined : 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setIsCameraReady(true);
            videoRef.current.play();
            // Se não foi passado ID (inicialização), pega o ID da track atual para sincronizar o select
            if (!deviceId) {
                const track = stream.getVideoTracks()[0];
                const settings = track.getSettings();
                if (settings.deviceId) setSelectedDeviceId(settings.deviceId);
            }
            requestRef.current = requestAnimationFrame(loop);
          };
        }
      }
    } catch (err) {
      setLoadingError("Sem acesso à câmera.");
      console.error(err);
    }
  };

  const handleCameraChange = (e) => {
      const newDeviceId = e.target.value;
      setSelectedDeviceId(newDeviceId);
      startWebcam(newDeviceId);
  };

  // --- Lógica de Regiões ---
  const addRegion = () => {
    const newId = Date.now().toString();
    const newRegion = {
      id: newId,
      name: `Item ${regions.length + 1}`,
      box: { x: 50, y: 50, w: 100, h: 100 },
      samples: 0, status: null, confidence: 0
    };
    setRegions(prev => [...prev, newRegion]);
    setActiveRegionId(newId);
  };

  const removeRegion = (id) => {
    if (regions.length <= 1) return;

    let nextActiveId = activeRegionId;
    if (activeRegionId === id) {
        const remaining = regions.filter(r => r.id !== id);
        if (remaining.length > 0) {
            nextActiveId = remaining[0].id;
        }
    }

    setRegions(prev => prev.filter(r => r.id !== id));
    if (nextActiveId !== activeRegionId) {
        setActiveRegionId(nextActiveId);
    }
  };

  // --- IA Core ---
  const getCropTensor = (box) => {
    if (!videoRef.current || !mobilenetModel.current || !isCameraReady) return null;
    const video = videoRef.current;
    if (video.readyState !== 4) return null;

    const img = tf.browser.fromPixels(video);
    const scaleX = video.videoWidth / video.clientWidth;
    const scaleY = video.videoHeight / video.clientHeight;

    let startX = Math.floor(box.x * scaleX);
    let startY = Math.floor(box.y * scaleY);
    let width = Math.floor(box.w * scaleX);
    let height = Math.floor(box.h * scaleY);

    startX = Math.max(0, startX);
    startY = Math.max(0, startY);
    if (startX + width > video.videoWidth) width = video.videoWidth - startX;
    if (startY + height > video.videoHeight) height = video.videoHeight - startY;

    if (width <= 0 || height <= 0) {
      img.dispose();
      return null;
    }

    try {
      const crop = img.slice([startY, startX, 0], [height, width, 3]);
      const activation = mobilenetModel.current.infer(crop, true);
      img.dispose();
      crop.dispose();
      return activation;
    } catch (e) {
      img.dispose();
      return null;
    }
  };

  const addObjectExample = async (e) => {
    if (e) e.stopPropagation();
    
    if (isPredicting || !classifier.current) return;
    
    const activeRegion = regions.find(r => r.id === activeRegionId);
    if (!activeRegion) return;

    if (activeRegion.samples >= 20) {
        alert("Limite de 20 exemplos atingido para otimizar desempenho.");
        return;
    }

    const activation = getCropTensor(activeRegion.box);
    if (activation) {
      classifier.current.addExample(activation, activeRegion.id);
      activation.dispose();
      
      setRegions(prevRegions => 
        prevRegions.map(r => r.id === activeRegionId ? { ...r, samples: r.samples + 1 } : r)
      );
    }
  };

  const addBackgroundExample = async () => {
    if (isPredicting || !classifier.current) return;
    let successCount = 0;
    for (const region of regions) {
        const activation = getCropTensor(region.box);
        if (activation) {
            classifier.current.addExample(activation, 'background');
            activation.dispose();
            successCount++;
        }
    }
    if (successCount > 0) setBackgroundSamples(prev => prev + 1);
  };

  const predictAllRegions = async () => {
    if (!classifier.current || classifier.current.getNumClasses() === 0) return;

    // FIX: Use regionsRef.current to avoid stale closure in the loop
    const currentRegions = regionsRef.current;

    const updatedRegions = await Promise.all(currentRegions.map(async (region) => {
      if (region.samples === 0 && backgroundSamples === 0) return { ...region, status: null, confidence: 0 };

      const activation = getCropTensor(region.box);
      if (!activation) return region;

      let resultStatus = 'bad';
      let conf = 0;

      try {
        const result = await classifier.current.predictClass(activation);
        
        if (result.label === region.id) {
            conf = result.confidences[result.label] || 0;
            if (conf >= threshold) {
                resultStatus = 'ok';
            }
        } else {
            conf = result.confidences[region.id] || 0;
            resultStatus = 'bad';
        }
      
      } catch (e) {
        console.log(e);
      } finally {
        activation.dispose();
      }

      return { ...region, status: resultStatus, confidence: conf };
    }));

    setRegions(updatedRegions);
  };

  // --- Loop de Predição ---
  useEffect(() => {
    let isMounted = true;
    const loopPrediction = async () => {
      if (!isMounted) return;
      if (isPredicting && currentBarcode) {
        await predictAllRegions();
        predictTimeoutRef.current = setTimeout(loopPrediction, 333);
      }
    };
    
    if (isPredicting && currentBarcode) loopPrediction();
    else {
      if (predictTimeoutRef.current) clearTimeout(predictTimeoutRef.current);
      setRegions(prev => prev.map(r => ({ ...r, status: null, confidence: 0 })));
    }
    return () => { isMounted = false; };
  }, [isPredicting, currentBarcode, threshold]);

  const saveToHistory = () => {
    const allOk = regions.every(r => r.status === 'ok');
    
    let snapshot = null;
    if (canvasRef.current) {
        snapshot = canvasRef.current.toDataURL('image/jpeg', 0.5); 
    }

    const newEntry = {
      id: Date.now(),
      code: currentBarcode,
      timestamp: new Date().toLocaleString(), 
      status: allOk ? 'APROVADO' : 'REPROVADO',
      image: snapshot,
      details: regions.map(r => `${r.name}: ${r.status === 'ok' ? 'OK' : 'FALHA'}`).join(', ')
    };
    
    setHistory([newEntry, ...history]);
    setCurrentBarcode(''); 
  };

  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const code = formData.get('barcode');
    if (code) {
      setCurrentBarcode(code);
    }
  };

  // --- Interação Mouse ---
  const handleMouseDown = (e) => {
    if (viewMode === 'operator') return; 
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const HANDLE_SIZE = 20;

    const reversedRegions = [...regions].reverse();
    for (const region of reversedRegions) {
      const { x, y, w, h } = region.box;
      const isActive = region.id === activeRegionId;
      
      if (isActive) {
        if (mouseX > x + w - HANDLE_SIZE && mouseX < x + w + HANDLE_SIZE &&
            mouseY > y + h - HANDLE_SIZE && mouseY < y + h + HANDLE_SIZE) {
          setInteractionMode('resizing');
          setDragStart({ x: mouseX, y: mouseY });
          break;
        }
      }
      if (mouseX > x && mouseX < x + w && mouseY > y && mouseY < y + h) {
        setActiveRegionId(region.id);
        setInteractionMode('dragging');
        setDragStart({ x: mouseX - x, y: mouseY - y });
        break;
      }
    }
  };

  const handleMouseMove = (e) => {
    if (interactionMode === 'none' || viewMode === 'operator') return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const activeIndex = regions.findIndex(r => r.id === activeRegionId);
    if (activeIndex === -1) return;

    const currentRegion = regions[activeIndex];
    let newBox = { ...currentRegion.box };

    if (interactionMode === 'dragging') {
      newBox.x = Math.max(0, Math.min(canvasRef.current.width - newBox.w, mouseX - dragStart.x));
      newBox.y = Math.max(0, Math.min(canvasRef.current.height - newBox.h, mouseY - dragStart.y));
    } else if (interactionMode === 'resizing') {
      const newWidth = Math.max(20, mouseX - newBox.x);
      const newHeight = Math.max(20, mouseY - newBox.y);
      newBox.w = Math.min(newWidth, canvasRef.current.width - newBox.x);
      newBox.h = Math.min(newHeight, canvasRef.current.height - newBox.y);
    }
    setRegions(prev => {
        const updated = [...prev];
        updated[activeIndex] = { ...currentRegion, box: newBox };
        return updated;
    });
  };

  const handleMouseUp = () => setInteractionMode('none');

  // --- Loop Visual ---
  const loop = () => {
    if (!canvasRef.current || !videoRef.current) {
      requestRef.current = requestAnimationFrame(loop);
      return;
    }
    const ctx = canvasRef.current.getContext('2d');
    if (canvasRef.current.width !== videoRef.current.clientWidth) {
      canvasRef.current.width = videoRef.current.clientWidth;
      canvasRef.current.height = videoRef.current.clientHeight;
    }

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    const currentRegions = regionsRef.current;

    currentRegions.forEach(region => {
      const { x, y, w, h } = region.box;
      const isActive = region.id === activeRegionId;

      let strokeColor = '#64748b';
      let lineWidth = 2;

      if (viewMode === 'operator') {
        if (region.status === 'ok') strokeColor = '#22c55e';
        else if (region.status === 'bad') strokeColor = '#ef4444';
        else strokeColor = '#3b82f6';
        lineWidth = 3;
      } else {
        strokeColor = '#fbbf24'; 
        lineWidth = isActive ? 3 : 2; 
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      
      ctx.setLineDash(viewMode === 'setup' && !isActive ? [5, 5] : []);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      if (viewMode === 'setup' || (viewMode === 'operator' && currentBarcode)) {
          ctx.fillStyle = strokeColor;
          const labelText = viewMode === 'operator' && region.status ? (region.status === 'ok' ? 'OK' : 'FALHA') : region.name;
          const textWidth = ctx.measureText(labelText).width;
          ctx.fillRect(x, y - 22, textWidth + 16, 22);
          ctx.fillStyle = (viewMode === 'operator' && region.status) ? '#fff' : '#000';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(labelText, x + 4, y - 6);
      }

      if (viewMode === 'setup' && isActive) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(x + w, y + h, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
    requestRef.current = requestAnimationFrame(loop);
  };

  const activeRegion = regions.find(r => r.id === activeRegionId);
  const isUnbalanced = activeRegion && (activeRegion.samples > backgroundSamples * 2 || backgroundSamples > activeRegion.samples * 2) && backgroundSamples > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col h-screen overflow-hidden">
      
      {/* Top Bar */}
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900 z-50">
         <div className="flex items-center gap-2">
            <Layout className="text-blue-500" />
            <h1 className="font-bold tracking-tight">SmartInspector <span className="text-slate-600 font-normal text-xs ml-2">v2.7 Stable</span></h1>
         </div>

         <div className="flex gap-2">
            <button 
               onClick={() => {
                   const newMode = viewMode === 'setup' ? 'operator' : 'setup';
                   setViewMode(newMode);
                   setIsPredicting(newMode === 'operator');
                   setCurrentBarcode('');
               }}
               className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-2 transition-colors
                  ${viewMode === 'setup' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}
               `}
            >
               {viewMode === 'setup' ? <Unlock size={14}/> : <Lock size={14}/>}
               {viewMode === 'setup' ? 'CONFIGURAÇÃO' : 'OPERADOR'}
            </button>
         </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
         
         {/* Câmera Area */}
         <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden p-4">
            <div className="relative w-full h-full max-w-5xl aspect-video rounded-lg overflow-hidden border border-slate-800 shadow-2xl">
               <video ref={videoRef} className="absolute w-full h-full object-contain opacity-70" muted playsInline />
               <canvas 
                  ref={canvasRef}
                  className={`absolute inset-0 w-full h-full z-20 object-contain ${viewMode === 'setup' ? 'cursor-move' : ''}`}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
               />
               
               {/* --- TELA DE SCAN --- */}
               {viewMode === 'operator' && !currentBarcode && (
                   <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center">
                       <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-md text-center">
                           <div className="bg-blue-500/20 p-4 rounded-full inline-block mb-4">
                               <ScanBarcode size={48} className="text-blue-400" />
                           </div>
                           <h2 className="text-2xl font-bold text-white mb-2">Iniciar Inspeção</h2>
                           <p className="text-slate-400 mb-6">Escaneie o código de barras ou digite o ID.</p>
                           
                           <form onSubmit={handleBarcodeSubmit}>
                               <input 
                                   ref={barcodeInputRef}
                                   name="barcode"
                                   autoComplete="off"
                                   className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-xl text-center text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 outline-none mb-4 font-mono tracking-wider"
                                   placeholder="Aguardando..."
                               />
                               <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2">
                                   CONFIRMAR <ArrowRight size={18}/>
                               </button>
                           </form>
                       </div>
                   </div>
               )}

               {/* Status Global */}
               {viewMode === 'operator' && currentBarcode && (
                   <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
                      {regions.every(r => r.status === 'ok') ? (
                          <div className="bg-green-500 text-white px-6 py-2 rounded-full font-bold shadow-lg flex items-center gap-2 animate-pulse">
                              <Check size={20}/> APROVADO
                          </div>
                      ) : (
                          <div className="bg-red-600 text-white px-6 py-2 rounded-full font-bold shadow-lg flex items-center gap-2 animate-bounce">
                              <X size={20}/> FALHA DETECTADA
                          </div>
                      )}
                   </div>
               )}
            </div>
         </div>

         {/* Sidebar */}
         <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col z-40">
            
            {/* MODO SETUP */}
            {viewMode === 'setup' && (
                <div className="flex flex-col h-full">
                    <div className="p-4 border-b border-slate-800">
                       <h2 className="font-bold text-slate-200 flex items-center gap-2 mb-4">
                          <Settings size={18}/> Configuração
                       </h2>
                       
                       {/* Seletor de Câmera */}
                       <div className="bg-slate-800 p-3 rounded-lg mb-3">
                          <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                             <Camera size={12}/> Selecionar Câmera
                          </label>
                          <select 
                             className="w-full bg-slate-700 text-white text-xs rounded p-2 border border-slate-600 outline-none"
                             value={selectedDeviceId}
                             onChange={handleCameraChange}
                          >
                             {videoDevices.map(device => (
                                <option key={device.deviceId} value={device.deviceId}>
                                   {device.label || `Câmera ${device.deviceId.slice(0,5)}...`}
                                </option>
                             ))}
                             {videoDevices.length === 0 && <option>Nenhuma câmera detectada</option>}
                          </select>
                       </div>

                       <div className="bg-slate-800 p-3 rounded-lg mb-4">
                          <div className="flex justify-between text-xs mb-2">
                              <span className="text-slate-400">Sensibilidade</span>
                              <span className="text-blue-400 font-bold">{(threshold * 100).toFixed(0)}%</span>
                          </div>
                          <input 
                            type="range" min="0.5" max="0.99" step="0.01"
                            value={threshold}
                            onChange={(e) => setThreshold(parseFloat(e.target.value))}
                            className="w-full accent-blue-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                          />
                       </div>

                       <button onClick={addRegion} className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs font-bold rounded border border-slate-700 flex justify-center items-center gap-1">
                          <Plus size={14}/> NOVO OBJETO
                       </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                       {regions.map(r => (
                           <div 
                             key={r.id}
                             onClick={() => setActiveRegionId(r.id)}
                             className={`p-3 rounded border text-sm relative group ${r.id === activeRegionId ? 'bg-blue-900/20 border-blue-500/50' : 'bg-slate-800 border-slate-700'}`}
                           >
                              <div className="flex justify-between mb-2">
                                 <input 
                                   className="bg-transparent font-bold text-white outline-none w-32"
                                   value={r.name}
                                   onChange={(e) => {
                                       const val = e.target.value;
                                       setRegions(prev => prev.map(reg => reg.id === r.id ? {...reg, name: val} : reg));
                                   }}
                                 />
                                 <button onClick={(e) => {e.stopPropagation(); removeRegion(r.id)}} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500"><Trash2 size={14}/></button>
                              </div>
                              
                              {r.id === activeRegionId && (
                                  <button 
                                    onClick={addObjectExample}
                                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded flex justify-between items-center px-3"
                                  >
                                     <span className="text-xs font-bold">Gravar Objeto</span>
                                     <span className="text-xs bg-blue-800 px-1.5 rounded">{r.samples}</span>
                                  </button>
                              )}
                           </div>
                       ))}
                       {isUnbalanced && (
                           <div className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded flex items-start gap-2 mt-2">
                               <AlertTriangle size={14} className="mt-0.5 flex-shrink-0"/>
                               <p>Equilibre fotos do Objeto e do Fundo.</p>
                           </div>
                       )}
                    </div>

                    <div className="p-4 border-t border-slate-800 bg-slate-900">
                       <button 
                          onClick={addBackgroundExample}
                          className="w-full py-3 bg-orange-600/10 hover:bg-orange-600/20 border border-orange-600/30 text-orange-500 rounded flex justify-between items-center px-4 active:scale-95 transition-transform"
                       >
                          <div className="flex items-center gap-2 text-xs font-bold">
                             <Eraser size={16}/> GRAVAR FUNDO
                          </div>
                          <span className="text-xs font-mono">{backgroundSamples} amostras</span>
                       </button>
                    </div>
                </div>
            )}

            {/* MODO OPERADOR */}
            {viewMode === 'operator' && (
                <div className="flex flex-col h-full">
                    <div className="p-4 bg-slate-800 border-b border-slate-700">
                        <h2 className="font-bold text-white mb-1 flex items-center gap-2"><Eye size={16}/> Inspeção Ativa</h2>
                        {currentBarcode ? (
                            <div className="mt-2 bg-slate-900 p-2 rounded border border-slate-600 flex justify-between items-center">
                                <span className="text-xs text-slate-400">Peça:</span>
                                <span className="font-mono text-sm font-bold text-blue-400">{currentBarcode}</span>
                            </div>
                        ) : (
                             <p className="text-xs text-slate-400">Aguardando leitura...</p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 opacity-90">
                        {currentBarcode && (
                            <>
                                <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 tracking-wider">Tempo Real</h3>
                                <div className="space-y-3">
                                    {regions.map(r => (
                                        <div key={r.id} className="bg-slate-800 p-3 rounded border border-slate-700">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-medium text-slate-200">{r.name}</span>
                                                {r.status === 'ok' ? (
                                                    <span className="text-[10px] font-bold text-green-400 bg-green-400/10 px-2 py-0.5 rounded border border-green-400/20">OK</span>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">FALHA</span>
                                                )}
                                            </div>
                                            <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden relative">
                                                <div 
                                                    className={`h-full transition-all duration-300 ${r.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}
                                                    style={{ width: `${(r.confidence * 100).toFixed(0)}%` }}
                                                ></div>
                                                <div className="absolute top-0 bottom-0 w-0.5 bg-white opacity-50" style={{ left: `${threshold * 100}%` }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="p-4 border-t border-slate-800 bg-slate-900 space-y-3">
                        <button 
                           onClick={saveToHistory}
                           disabled={!currentBarcode}
                           className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold shadow-lg flex justify-center items-center gap-2 active:scale-95 transition-transform"
                        >
                           <Save size={20}/> SALVAR & PRÓXIMO
                        </button>

                        <div className="pt-2 border-t border-slate-800">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                                <Database size={10}/> Histórico da Sessão
                            </h4>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                {history.slice(0, 5).map(h => (
                                    <div key={h.id} className="text-xs flex items-center justify-between text-slate-400 bg-slate-800/50 p-1.5 rounded group hover:bg-slate-800 transition-colors">
                                        <div className="flex items-center gap-2">
                                            {h.image && <img src={h.image} alt="snap" className="w-6 h-6 rounded object-cover border border-slate-600"/>}
                                            <div className="flex flex-col">
                                                <span className="font-mono text-slate-300 font-bold">{h.code}</span>
                                                <span className="text-[10px] opacity-70">{h.timestamp}</span>
                                            </div>
                                        </div>
                                        <span className={h.status === 'APROVADO' ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>{h.status}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

         </div>
      </div>
    </div>
  );
};

export default App;
