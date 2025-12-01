import React, { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  Trash2, Plus,
  Check, X, Layout, Eraser,
  Lock, Unlock, Settings, Save, Database, AlertTriangle, Eye,
  ScanBarcode, ArrowRight, ShieldAlert, RefreshCw, Car
} from 'lucide-react';

const App = () => {
  // --- Refs ---
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const classifier = useRef(null);
  const mobilenetModel = useRef(null);
  const requestRef = useRef(null);
  const predictRef = useRef(null);
  const barcodeInputRef = useRef(null);

  const regionsRef = useRef([]);

  // --- Estados ---
  const [, setIsModelLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [, setBackend] = useState('detecting...');

  // Câmeras
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // 'setup' | 'operator'
  const [viewMode, setViewMode] = useState('setup');
  const [isPredicting, setIsPredicting] = useState(false);

  // Fluxo do Operador
  const [currentBarcode, setCurrentBarcode] = useState('');

  // Configurações
  const [threshold, setThreshold] = useState(0.95);
  const [backgroundSamples, setBackgroundSamples] = useState(0);

  // Dados
  const [regions, setRegions] = useState([
    { id: '1', name: 'Objeto 1', box: { x: 50, y: 50, w: 150, h: 150 }, samples: 0, status: null, confidence: 0 }
  ]);
  const [activeRegionId, setActiveRegionId] = useState('1');

  const [history, setHistory] = useState([]);
  const [, setAuditLogs] = useState([]);

  // Interação
  const [interactionMode, setInteractionMode] = useState('none');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [actionMessageType, setActionMessageType] = useState('success');

  // --- Car Model Logic ---
  const [selectedModel, setSelectedModel] = useState(null); // 'Polo Track' | 'Tera'
  const modelsData = useRef({
    'Polo Track': {
      regions: [{ id: '1', name: 'Objeto 1 (Polo)', box: { x: 50, y: 50, w: 150, h: 150 }, samples: 0, status: null, confidence: 0 }],
      dataset: null,
      backgroundSamples: 0
    },
    'Tera': {
      regions: [{ id: '1', name: 'Objeto 1 (Tera)', box: { x: 50, y: 50, w: 150, h: 150 }, samples: 0, status: null, confidence: 0 }],
      dataset: null,
      backgroundSamples: 0
    }
  });
  const isSwitchingRef = useRef(false);

  const getClassLabel = (regionId) => (selectedModel ? `${selectedModel}::${regionId}` : String(regionId));
  const getBackgroundLabel = () => (selectedModel ? `${selectedModel}::background` : 'background');

  const serializeDataset = (dataset) => {
    if (!dataset) return null;
    const result = {};
    Object.keys(dataset).forEach((classId) => {
      const tensor = dataset[classId];
      const data = Array.from(tensor.dataSync());
      result[classId] = { data, shape: tensor.shape };
    });
    return result;
  };

  const deserializeDataset = (obj) => {
    if (!obj) return null;
    const result = {};
    Object.keys(obj).forEach((classId) => {
      const { data, shape } = obj[classId];
      result[classId] = tf.tensor(data, shape);
    });
    return result;
  };

  const saveModelToLocal = (modelName) => {
    if (!modelName) return;
    let dataset = null;
    if (classifier.current && classifier.current.getNumClasses() > 0) {
      dataset = classifier.current.getClassifierDataset();
    }
    const payload = {
      regions,
      backgroundSamples,
      dataset: serializeDataset(dataset)
    };
    try { localStorage.setItem(`modelData:${modelName}`, JSON.stringify(payload)); } catch (_) {}
  };

  const loadModelFromLocal = (modelName) => {
    try {
      const raw = localStorage.getItem(`modelData:${modelName}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };

  useEffect(() => { regionsRef.current = regions; }, [regions]);

  useEffect(() => {
    if (viewMode === 'operator' && !currentBarcode && barcodeInputRef.current) {
      setTimeout(() => barcodeInputRef.current?.focus(), 100);
    }
  }, [viewMode, currentBarcode]);

  useEffect(() => {
    if (selectedModel) {
      startWebcam(selectedDeviceId || null);
    }
  }, [selectedModel]);

  useEffect(() => {
    if (selectedModel && !isSwitchingRef.current) saveModelToLocal(selectedModel);
  }, [regions, backgroundSamples]);

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

  const getDevices = async () => {
    try {
      // Nota: Assumimos que startWebcam já obteve permissão.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      setVideoDevices(cameras);
    } catch (e) {
      console.warn("Aviso ao listar dispositivos (pode ser ignorado se a câmera funcionar):", e);
    }
  };

  /**
   * Tenta iniciar a webcam com constraints progressivamente mais simples.
   * Prioriza o sucesso sobre a resolução, especialmente na primeira execução (deviceId = null).
   */
  const startWebcam = async (deviceId = null) => {
    try {
      setLoadingError(null);

      // Parar stream anterior se existir
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Seu navegador não suporta acesso à câmera.");
      }

      let stream = null;

      // Constraints iniciais: Tentativa de alta resolução ou ID específico.
      // Removemos o 'facingMode' para evitar conflitos em webcams de desktop.
      let initialConstraints = {
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      };

      if (deviceId) {
        initialConstraints.video.deviceId = { exact: deviceId };
      } else {
        // Se for a primeira execução (deviceId nulo), começamos com o mais simples (video: true)
        // para máxima compatibilidade.
        initialConstraints.video = true;
      }

      // Tentativa 1: Inicial (video: true ou ID específico + HD)
      try {
        stream = await navigator.mediaDevices.getUserMedia(initialConstraints);
      } catch (err1) {
        console.warn("Tentativa inicial (minimal/ID) falhou. Tentando fallback para HD genérico:", err1);

        // Tentativa 2: Fallback para HD genérico (se a inicial era 'video: true' e falhou)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        } catch (err2) {
          console.warn("Fallback HD genérico falhou. Tentando ABSOLUTO MÍNIMO (video: {}):", err2);

          // Tentativa 3: Fallback ABSOLUTO MÍNIMO (o mais permissivo)
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {} });
          } catch (err3) {
            console.error("Fallback ABSOLUTO MÍNIMO também falhou:", err3);
            throw err3; // Lança o erro real se nada funcionar
          }
        }
      }

      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          setIsCameraReady(true);
          videoRef.current.play().catch(e => console.error("Erro ao dar play:", e));

          // Captura o ID do dispositivo ativo para que ele seja a opção selecionada no dropdown
          if (!deviceId) {
            const track = stream.getVideoTracks()[0];
            const settings = track.getSettings();
            if (settings.deviceId) setSelectedDeviceId(settings.deviceId);
          }
          requestRef.current = requestAnimationFrame(loop);
        };
      }
    } catch (err) {
      console.error("ERRO FATAL NA CÂMERA:", err);
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setLoadingError("Nenhuma câmera encontrada. Verifique a conexão e as permissões.");
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setLoadingError("Permissão de câmera negada. Habilite nas configurações do navegador.");
      } else {
        setLoadingError(`Erro na câmera: ${err.message || "Desconhecido"}`);
      }
      setIsCameraReady(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        // 1. Carregar IA
        window.tf = tf;
        await tf.setBackend('webgl').catch(() => console.log("WebGL não disponível, usando CPU"));
        await tf.ready();
        setBackend(tf.getBackend());

        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet');
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/knn-classifier');

        await new Promise(r => setTimeout(r, 500));

        if (window.knnClassifier && window.mobilenet) {
          classifier.current = window.knnClassifier.create();
          console.log("Carregando MobileNet V2...");
          mobilenetModel.current = await window.mobilenet.load({ version: 2, alpha: 1.0 });
          setIsModelLoading(false);
        } else {
          throw new Error('Err: Bibliotecas de IA falharam.');
        }

        // 2. Iniciar Câmera (Isso pede permissão)
        await startWebcam();

        // 3. Listar dispositivos (Só depois de ter permissão)
        await getDevices();

      } catch (error) {
        console.error(error);
        setLoadingError("Erro ao inicializar sistema. " + error.message);
        setIsModelLoading(false);
      }
    };

    init();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (predictRef.current) cancelAnimationFrame(predictRef.current);
    };
  }, []);

  const handleCameraChange = (e) => {
    const newDeviceId = e.target.value;
    setSelectedDeviceId(newDeviceId);
    startWebcam(newDeviceId);
  };

  const handleRetryCamera = () => {
    setLoadingError(null);
    startWebcam();
  };

  // --- Lógica de Regiões ---
  const addRegion = () => {
    const newId = Date.now().toString();
    const newRegion = {
      id: newId,
      name: `Objeto ${regions.length + 1}`,
      box: { x: 50, y: 50, w: 150, h: 150 },
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

  const clearRegionSamples = (regionId) => {
    if (!classifier.current) return;
    try {
      classifier.current.clearClass(getClassLabel(regionId));
    } catch (_) {}
    setRegions(prev => prev.map(r => r.id === regionId ? { ...r, samples: 0, status: null, confidence: 0 } : r));
    if (selectedModel) saveModelToLocal(selectedModel);
  };

  // --- IA Core ---
  const getCropTensor = (box) => {
    if (!videoRef.current || !mobilenetModel.current || !isCameraReady) return null;
    const video = videoRef.current;
    if (video.readyState !== 4) return null;

    return tf.tidy(() => {
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

      if (width <= 0 || height <= 0) return null;

      try {
        const crop = img.slice([startY, startX, 0], [height, width, 3]);
        return mobilenetModel.current.infer(crop, true);
      } catch (e) {
        return null;
      }
    });
  };

  const addObjectExample = async (e) => {
    if (e) e.stopPropagation();
    if (isPredicting || !classifier.current) return;

    const activeRegion = regions.find(r => r.id === activeRegionId);
    if (!activeRegion) return;

    if (activeRegion.samples >= 200) {
      alert("Limite de 200 amostras atingido.");
      return;
    }

    const activation = getCropTensor(activeRegion.box);
    if (activation) {
      classifier.current.addExample(activation, getClassLabel(activeRegion.id));
      activation.dispose();

      setRegions(prevRegions =>
        prevRegions.map(r => r.id === activeRegionId ? { ...r, samples: r.samples + 1 } : r)
      );
      if (selectedModel) saveModelToLocal(selectedModel);
    }
  };

  const addBackgroundExample = async () => {
    if (isPredicting || !classifier.current) return;
    let successCount = 0;
    for (const region of regions) {
      const activation = getCropTensor(region.box);
      if (activation) {
        classifier.current.addExample(activation, getBackgroundLabel());
        activation.dispose();
        successCount++;
      }
    }
    if (successCount > 0) {
      setBackgroundSamples(prev => prev + 1);
      if (selectedModel) saveModelToLocal(selectedModel);
    }
  };

  const predictAllRegions = async () => {
    if (!classifier.current || classifier.current.getNumClasses() === 0) return;

    const updatedRegions = await Promise.all(regions.map(async (region) => {
      if (region.samples === 0 && backgroundSamples === 0) return { ...region, status: null, confidence: 0 };

      const activation = getCropTensor(region.box);
      if (!activation) return region;

      let resultStatus = 'bad';
      let conf = 0;
      const label = getClassLabel(region.id);

      try {
        const result = await classifier.current.predictClass(activation);

        if (result.label === label) {
          conf = result.confidences[result.label] || 0;
          if (conf >= threshold) {
            resultStatus = 'ok';
          }
        } else {
          conf = result.confidences[label] || 0;
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

  const predictionLoop = async () => {
    if (isPredicting && currentBarcode) {
      await predictAllRegions();
      predictRef.current = requestAnimationFrame(predictionLoop);
    }
  };

  useEffect(() => {
    if (isPredicting && currentBarcode) {
      predictRef.current = requestAnimationFrame(predictionLoop);
    } else {
      if (predictRef.current) cancelAnimationFrame(predictRef.current);
      setRegions(prev => prev.map(r => ({ ...r, status: null, confidence: 0 })));
    }
    return () => { if (predictRef.current) cancelAnimationFrame(predictRef.current); };
  }, [isPredicting, currentBarcode, threshold]);

  const saveToHistory = () => {
    const allOk = regions.every(r => r.status === 'ok');

    let snapshot = null;
    if (canvasRef.current) {
      snapshot = canvasRef.current.toDataURL('image/jpeg', 0.8);
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

  // --- Interação Mouse e Touch ---
  const getClientCoordinates = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  };

  const handleInputStart = (e) => {
    if (viewMode === 'operator') return;

    if (e.type === 'touchstart') {
      // e.preventDefault(); // Opcional
    }

    const coords = getClientCoordinates(e);
    const rect = canvasRef.current.getBoundingClientRect();
    const inputX = coords.clientX - rect.left;
    const inputY = coords.clientY - rect.top;
    const HANDLE_SIZE = 30;

    const reversedRegions = [...regions].reverse();
    for (const region of reversedRegions) {
      const { x, y, w, h } = region.box;
      const isActive = region.id === activeRegionId;

      if (isActive) {
        if (inputX > x + w - HANDLE_SIZE && inputX < x + w + HANDLE_SIZE &&
          inputY > y + h - HANDLE_SIZE && inputY < y + h + HANDLE_SIZE) {
          setInteractionMode('resizing');
          setDragStart({ x: inputX, y: inputY });
          return;
        }
      }
      if (inputX > x && inputX < x + w && inputY > y && inputY < y + h) {
        setActiveRegionId(region.id);
        setInteractionMode('dragging');
        setDragStart({ x: inputX - x, y: inputY - y });
        return;
      }
    }
  };

  const handleInputMove = (e) => {
    if (interactionMode === 'none' || viewMode === 'operator') return;
    if (e.cancelable) e.preventDefault();

    const coords = getClientCoordinates(e);
    const rect = canvasRef.current.getBoundingClientRect();
    const inputX = coords.clientX - rect.left;
    const inputY = coords.clientY - rect.top;

    const activeIndex = regions.findIndex(r => r.id === activeRegionId);
    if (activeIndex === -1) return;

    const currentRegion = regions[activeIndex];
    let newBox = { ...currentRegion.box };

    if (interactionMode === 'dragging') {
      newBox.x = Math.max(0, Math.min(canvasRef.current.width - newBox.w, inputX - dragStart.x));
      newBox.y = Math.max(0, Math.min(canvasRef.current.height - newBox.h, inputY - dragStart.y));
    } else if (interactionMode === 'resizing') {
      const newWidth = Math.max(40, inputX - newBox.x);
      const newHeight = Math.max(40, inputY - newBox.y);
      newBox.w = Math.min(newWidth, canvasRef.current.width - newBox.x);
      newBox.h = Math.min(newHeight, canvasRef.current.height - newBox.y);
    }
    setRegions(prev => {
      const updated = [...prev];
      updated[activeIndex] = { ...currentRegion, box: newBox };
      return updated;
    });
  };

  const handleInputEnd = () => setInteractionMode('none');

  // --- Loop Visual ---
  const loop = () => {
    if (!canvasRef.current || !videoRef.current) {
      requestRef.current = requestAnimationFrame(loop);
      return;
    }
    const ctx = canvasRef.current.getContext('2d');

    if (canvasRef.current.width !== videoRef.current.clientWidth ||
      canvasRef.current.height !== videoRef.current.clientHeight) {
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
        ctx.font = 'bold 14px sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        ctx.fillRect(x, y - 24, textWidth + 16, 24);
        ctx.fillStyle = (viewMode === 'operator' && region.status) ? '#fff' : '#000';
        ctx.fillText(labelText, x + 4, y - 7);
      }

      if (viewMode === 'setup' && isActive) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(x + w, y + h, 8, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
    requestRef.current = requestAnimationFrame(loop);
  };

  const activeRegion = regions.find(r => r.id === activeRegionId);
  const isUnbalanced = activeRegion && (activeRegion.samples > backgroundSamples * 2 || backgroundSamples > activeRegion.samples * 2) && backgroundSamples > 0;
  const hasPhotos = (classifier.current && classifier.current.getNumClasses() > 0) || regions.some(r => r.samples > 0) || backgroundSamples > 0 || history.length > 0;

  const handleDeleteAllPhotos = async () => {
    if (isPredicting) {
      setActionMessage('Pare a validação antes de apagar');
      setActionMessageType('error');
      return;
    }
    if (!hasPhotos || isDeleting) return;
    const ok = window.confirm('Confirma apagar todas as fotos? Essa ação é permanente.');
    if (!ok) return;
    setIsDeleting(true);
    setActionMessage(null);
    try {
      try {
        localStorage.setItem('__write_test', '1');
        localStorage.removeItem('__write_test');
      } catch (e) {
        setActionMessage('Sem permissão para escrever no armazenamento local');
        setActionMessageType('error');
        setIsDeleting(false);
        return;
      }

      Object.keys(modelsData.current).forEach(name => {
        try { localStorage.removeItem(`modelData:${name}`); } catch (_) {}
      });

      if (classifier.current) classifier.current.clearAllClasses();
      setRegions(prev => prev.map(r => ({ ...r, samples: 0, status: null, confidence: 0 })));
      setBackgroundSamples(0);
      setHistory([]);

      setActionMessage('Fotos deletadas com sucesso');
      setActionMessageType('success');

      const totalSamples = regions.reduce((acc, r) => acc + r.samples, 0) + backgroundSamples;
      setAuditLogs(prev => [{ id: Date.now(), type: 'DELETE_ALL_PHOTOS', model: selectedModel, timestamp: new Date().toISOString(), totalSamples }, ...prev]);
    } catch (err) {
      setActionMessage('Erro ao deletar fotos');
      setActionMessageType('error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleModelSelect = (modelName) => {
    isSwitchingRef.current = true;
    if (selectedModel) saveModelToLocal(selectedModel);
    setSelectedModel(modelName);
    const stored = loadModelFromLocal(modelName);
    if (classifier.current) {
      classifier.current.clearAllClasses();
      if (stored && stored.dataset) {
        const ds = deserializeDataset(stored.dataset);
        if (ds) classifier.current.setClassifierDataset(ds);
      } else {
        const nextData = modelsData.current[modelName];
        if (nextData && nextData.dataset) {
          classifier.current.setClassifierDataset(nextData.dataset);
        }
      }
    }
    const sourceRegions = (stored && stored.regions) ? stored.regions : modelsData.current[modelName].regions;
    const newRegions = (sourceRegions || []).map(r => ({
      id: r.id,
      name: r.name,
      box: { ...r.box },
      samples: r.samples || 0,
      status: null,
      confidence: 0
    }));
    setRegions(newRegions);
    if (newRegions.length > 0) setActiveRegionId(newRegions[0].id);
    setBackgroundSamples((stored && stored.backgroundSamples != null) ? stored.backgroundSamples : (modelsData.current[modelName].backgroundSamples || 0));
    setViewMode('setup');
    setIsPredicting(false);
    setCurrentBarcode('');
    setTimeout(() => { isSwitchingRef.current = false; }, 0);
  };

  if (!selectedModel) {
    return (
      <div className="min-h-screen bg-slate-950 text-white font-sans flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl p-8 text-center">
          <div className="bg-blue-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <Car size={32} className="text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Selecione o Modelo</h1>
          <p className="text-slate-400 mb-8">Escolha o veículo para carregar as configurações de inspeção.</p>

          <div className="space-y-3">
            <button
              onClick={() => handleModelSelect('Polo Track')}
              className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/50 p-4 rounded-xl flex items-center justify-between group transition-all"
            >
              <span className="font-bold text-lg group-hover:text-blue-400 transition-colors">Polo Track</span>
              <ArrowRight size={20} className="text-slate-600 group-hover:text-blue-500" />
            </button>

            <button
              onClick={() => handleModelSelect('Tera')}
              className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/50 p-4 rounded-xl flex items-center justify-between group transition-all"
            >
              <span className="font-bold text-lg group-hover:text-blue-400 transition-colors">Tera</span>
              <ArrowRight size={20} className="text-slate-600 group-hover:text-blue-500" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col h-screen overflow-hidden">

      {/* Top Bar Responsiva */}
      <header className="h-14 flex-shrink-0 border-b border-slate-800 flex items-center justify-between px-2 md:px-4 bg-slate-900 z-50">
        <div className="flex items-center gap-2">
          <Layout className="text-blue-500 w-5 h-5 md:w-6 md:h-6" />
          <div>
            <h1 className="font-bold tracking-tight text-sm md:text-lg leading-tight">SmartInspector <span className="text-slate-600 font-normal text-xs ml-1 hidden sm:inline">PRO v3.1</span></h1>
            {selectedModel && <p className="text-[10px] text-slate-400 font-mono leading-none">Modelo: <span className="text-blue-400 font-bold">{selectedModel}</span></p>}
          </div>
        </div>

        <div className="flex gap-2">
          {selectedModel && (
            <button
              onClick={() => {
                if (selectedModel) saveModelToLocal(selectedModel);
                if (classifier.current) classifier.current.clearAllClasses();
                setSelectedModel(null);
                setViewMode('setup');
                setIsPredicting(false);
                setCurrentBarcode('');
              }}
              className="px-2 py-1.5 md:px-3 md:py-1.5 rounded text-xs font-bold flex items-center gap-2 transition-colors bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
            >
              <Car size={14} />
              <span className="hidden sm:inline">TROCAR</span>
            </button>
          )}
          <button
            onClick={() => {
              const newMode = viewMode === 'setup' ? 'operator' : 'setup';
              setViewMode(newMode);
              setIsPredicting(newMode === 'operator');
              setCurrentBarcode('');
            }}
            className={`px-2 py-1.5 md:px-3 md:py-1.5 rounded text-xs font-bold flex items-center gap-2 transition-colors
                  ${viewMode === 'setup' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}
               `}
          >
            {viewMode === 'setup' ? <Unlock size={14} /> : <Lock size={14} />}
            {viewMode === 'setup' ? 'CONFIG' : 'OPERADOR'}
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden relative">

        {/* Câmera Area */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden p-2 md:p-4 order-1 md:order-1">
          <div className="relative w-full h-full max-w-5xl aspect-video rounded-lg overflow-hidden border border-slate-800 shadow-2xl bg-zinc-900 flex items-center justify-center">

            {/* Mensagem de Erro de Câmera */}
            {loadingError && (
              <div className="absolute z-50 text-center px-4">
                <div className="bg-red-500/10 text-red-500 p-4 rounded-xl border border-red-500/20 backdrop-blur-sm">
                  <ShieldAlert size={48} className="mx-auto mb-2" />
                  <p className="font-bold mb-2">{loadingError}</p>
                  <button onClick={handleRetryCamera} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 mx-auto text-sm">
                    <RefreshCw size={14} /> Tentar Novamente
                  </button>
                </div>
              </div>
            )}

            <video ref={videoRef} className="absolute w-full h-full object-contain opacity-70" muted playsInline />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 w-full h-full z-20 object-contain touch-none ${viewMode === 'setup' && !loadingError ? 'cursor-move' : ''}`}
              style={{ touchAction: 'none' }}
              onMouseDown={handleInputStart}
              onMouseMove={handleInputMove}
              onMouseUp={handleInputEnd}
              onMouseLeave={handleInputEnd}
              onTouchStart={handleInputStart}
              onTouchMove={handleInputMove}
              onTouchEnd={handleInputEnd}
            />

            {/* --- TELA DE SCAN --- */}
            {viewMode === 'operator' && !currentBarcode && !loadingError && (
              <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-slate-800 p-6 md:p-8 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-md text-center">
                  <div className="bg-blue-500/20 p-4 rounded-full inline-block mb-4">
                    <ScanBarcode size={40} className="text-blue-400" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Iniciar Inspeção</h2>
                  <p className="text-slate-400 mb-6 text-sm">Escaneie o código de barras ou digite o ID.</p>

                  <form onSubmit={handleBarcodeSubmit}>
                    <input
                      ref={barcodeInputRef}
                      name="barcode"
                      autoComplete="off"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-lg text-center text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 outline-none mb-4 font-mono tracking-wider"
                      placeholder="Código..."
                    />
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2">
                      INICIAR <ArrowRight size={18} />
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Status Global */}
            {viewMode === 'operator' && currentBarcode && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-max max-w-[90%]">
                {regions.every(r => r.status === 'ok') ? (
                  <div className="bg-green-500 text-white px-4 py-2 md:px-6 md:py-2 rounded-full font-bold shadow-lg flex items-center justify-center gap-2 animate-pulse text-sm md:text-base">
                    <Check size={20} /> APROVADO
                  </div>
                ) : (
                  <div className="bg-red-600 text-white px-4 py-2 md:px-6 md:py-2 rounded-full font-bold shadow-lg flex items-center justify-center gap-2 animate-bounce text-sm md:text-base">
                    <X size={20} /> FALHA
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Responsiva */}
        <div className="w-full md:w-80 h-[45vh] md:h-full bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col z-40 order-2 md:order-2 shadow-[0_-5px_15px_rgba(0,0,0,0.5)] md:shadow-none">

          {/* MODO SETUP */}
          {viewMode === 'setup' && (
            <div className="flex flex-col h-full">
              <div className="p-3 md:p-4 border-b border-slate-800 flex-shrink-0">
                <h2 className="font-bold text-slate-200 flex items-center gap-2 mb-2 md:mb-4 text-sm md:text-base">
                  <Settings size={16} className="md:w-5 md:h-5" /> Configuração
                </h2>

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-slate-800 p-2 rounded-lg">
                    <select
                      className="w-full bg-slate-700 text-white text-[10px] md:text-xs rounded p-1 border border-slate-600 outline-none truncate"
                      value={selectedDeviceId}
                      onChange={handleCameraChange}
                    >
                      {videoDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Cam ${device.deviceId.slice(0, 4)}`}
                        </option>
                      ))}
                      {videoDevices.length === 0 && <option>Padrão</option>}
                    </select>
                  </div>

                  <div className="bg-slate-800 p-2 rounded-lg flex flex-col justify-center">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-slate-400">Rigor</span>
                      <span className="text-blue-400 font-bold">{(threshold * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range" min="0.80" max="0.99" step="0.01"
                      value={threshold}
                      onChange={(e) => setThreshold(parseFloat(e.target.value))}
                      className="w-full accent-blue-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <button onClick={addRegion} className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs font-bold rounded border border-slate-700 flex justify-center items-center gap-1">
                  <Plus size={14} /> NOVO OBJETO
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
                {regions.map(r => (
                  <div
                    key={r.id}
                    onClick={() => setActiveRegionId(r.id)}
                    className={`p-2 md:p-3 rounded border text-sm relative group ${r.id === activeRegionId ? 'bg-blue-900/20 border-blue-500/50' : 'bg-slate-800 border-slate-700'}`}
                  >
                    <div className="flex justify-between mb-2 items-center">
                      <input
                        className="bg-transparent font-bold text-white outline-none w-24 md:w-32 text-xs md:text-sm"
                        value={r.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRegions(prev => prev.map(reg => reg.id === r.id ? { ...reg, name: val } : reg));
                        }}
                      />
                      <button onClick={(e) => { e.stopPropagation(); removeRegion(r.id) }} className="text-slate-500 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                    </div>

                    {r.id === activeRegionId && (
                      <div className="space-y-2">
                        <button
                          onClick={addObjectExample}
                          className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded flex justify-between items-center px-3"
                        >
                          <span className="text-xs font-bold">Gravar OK (Toque)</span>
                          <span className="text-xs bg-blue-800 px-1.5 rounded">{r.samples}</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); clearRegionSamples(r.id); }}
                          className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded flex justify-between items-center px-3"
                        >
                          <span className="text-xs font-bold flex items-center gap-2"><Eraser size={14} /> Apagar fotos</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {isUnbalanced && (
                  <div className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded flex items-start gap-2 mt-2">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <p>Capture mais Negativos.</p>
                  </div>
                )}
              </div>

              <div className="p-3 md:p-4 border-t border-slate-800 bg-slate-900 flex-shrink-0">
                <button
                  onClick={addBackgroundExample}
                  className="w-full py-3 bg-red-900/20 hover:bg-red-900/30 border border-red-800/50 text-red-400 rounded flex justify-between items-center px-4 active:scale-95 transition-transform"
                >
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <ShieldAlert size={16} /> GRAVAR ERRO
                  </div>
                  <span className="text-xs font-mono">{backgroundSamples}</span>
                </button>

                <button
                  onClick={handleDeleteAllPhotos}
                  disabled={!hasPhotos || isPredicting || isDeleting}
                  className={`mt-2 w-full py-3 ${(!hasPhotos || isPredicting || isDeleting) ? 'bg-slate-700 text-slate-500 border border-slate-700 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white border border-red-500'} rounded flex justify-between items-center px-4 active:scale-95 transition-transform`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <Trash2 size={16} /> DELETAR TODAS AS FOTOS
                  </div>
                  {isDeleting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <span className="text-xs font-mono">{hasPhotos ? 'pronto' : 'vazio'}</span>
                  )}
                </button>

                {actionMessage && (
                  <div className={`mt-2 text-[11px] px-2 py-1 rounded border ${actionMessageType === 'success' ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
                    {actionMessage}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MODO OPERADOR */}
          {viewMode === 'operator' && (
            <div className="flex flex-col h-full">
              <div className="p-3 md:p-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
                <div className="flex justify-between items-start">
                  <h2 className="font-bold text-white mb-1 flex items-center gap-2 text-sm md:text-base"><Eye size={16} /> Inspeção</h2>
                  {currentBarcode && <span className="font-mono text-xs font-bold text-blue-400 bg-slate-900 px-2 py-1 rounded border border-slate-700">{currentBarcode}</span>}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 md:p-4 opacity-90">
                {currentBarcode ? (
                  <div className="space-y-2 md:space-y-3">
                    {regions.map(r => (
                      <div key={r.id} className="bg-slate-800 p-2 md:p-3 rounded border border-slate-700">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs md:text-sm font-medium text-slate-200">{r.name}</span>
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
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50">
                    <ScanBarcode size={48} className="mb-2" />
                    <p className="text-xs text-center">Aguardando início...</p>
                  </div>
                )}
              </div>

              <div className="p-3 md:p-4 border-t border-slate-800 bg-slate-900 space-y-2 flex-shrink-0">
                <button
                  onClick={saveToHistory}
                  disabled={!currentBarcode}
                  className="w-full py-3 md:py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold shadow-lg flex justify-center items-center gap-2 active:scale-95 transition-transform text-sm md:text-base"
                >
                  <Save size={18} /> SALVAR
                </button>

                <div className="pt-2 border-t border-slate-800 hidden md:block">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                    <Database size={10} /> Histórico Recente
                  </h4>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {history.slice(0, 3).map(h => (
                      <div key={h.id} className="text-xs flex items-center justify-between text-slate-400 bg-slate-800/50 p-1.5 rounded">
                        <div className="flex items-center gap-2">
                          {h.image && <img src={h.image} alt="snap" className="w-5 h-5 rounded object-cover border border-slate-600" />}
                          <span className="font-mono truncate w-20">{h.code}</span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${h.status === 'APROVADO' ? 'text-green-500' : 'text-red-500'}`}>
                          {h.status === 'APROVADO' ? 'OK' : 'NOK'}
                        </span>
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
