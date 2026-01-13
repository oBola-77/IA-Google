import React, { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  BoxSelect, Trash2, Plus,
  Check, X, Layout, Eraser,
  Lock, Unlock, Settings, Save, Database, AlertTriangle, Eye,
  ScanBarcode, ArrowRight, Camera, Car
} from 'lucide-react';
import { supabase } from './supabaseClient';

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

  // Câmeras
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Modelo
  const [currentModel, setCurrentModel] = useState('Polo'); // 'Polo' | 'Tera'

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
    try { localStorage.setItem(`modelData:${modelName}`, JSON.stringify(payload)); } catch (_) { }
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

  // Carregar Regiões quando o Modelo Mudar
  useEffect(() => {
    const loadRegions = () => {
      const key = `smartinspector_regions_${currentModel}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          setRegions(JSON.parse(saved));
        } else {
          // Default regions for new models
          setRegions([
            { id: '1', name: 'Objeto 1', box: { x: 50, y: 50, w: 100, h: 100 }, samples: 0, status: null, confidence: 0 }
          ]);
        }
      } catch (e) {
        console.error("Erro ao carregar regioes:", e);
        setRegions([{ id: '1', name: 'Objeto 1', box: { x: 50, y: 50, w: 100, h: 100 }, samples: 0, status: null, confidence: 0 }]);
      }
    };
    loadRegions();
  }, [currentModel]);

  // Salvar Regiões quando mudarem e atualizar Ref
  useEffect(() => {
    regionsRef.current = regions; // Restore Ref sync for canvas loop
    if (regions.length > 0) {
      const key = `smartinspector_regions_${currentModel}`;
      localStorage.setItem(key, JSON.stringify(regions));
    }
  }, [regions, currentModel]);

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

  const startWebcam = async (deviceId = null) => {
    try {
      setLoadingError(null);

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
        console.log("Backend atual:", tf.getBackend());

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
    setRegions(prev => {
      const updated = [...prev, newRegion];
      if (selectedModel && modelsData.current[selectedModel]) {
        modelsData.current[selectedModel].regions = updated.map(r => ({ ...r, box: { ...r.box } }));
      }
      return updated;
    });
    setActiveRegionId(newId);
    if (selectedModel) saveModelToLocal(selectedModel);
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
    setRegions(prev => {
      const updated = prev.filter(r => r.id !== id);
      if (selectedModel && modelsData.current[selectedModel]) {
        modelsData.current[selectedModel].regions = updated.map(r => ({ ...r, box: { ...r.box } }));
      }
      return updated;
    });
    if (nextActiveId !== activeRegionId) {
      setActiveRegionId(nextActiveId);
    }
    if (selectedModel) saveModelToLocal(selectedModel);
  };

  const clearRegionSamples = (regionId) => {
    if (!classifier.current) return;
    try {
      classifier.current.clearClass(getClassLabel(regionId));
    } catch (_) { }
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

  // Helper para converter Base64 para Uint8Array (para upload bytea)
  const base64ToUint8Array = (base64) => {
    const binaryString = window.atob(base64.split(',')[1]);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  // Helper para carregar imagem do Supabase (bytea hex -> blob -> image)
  const loadImageFromHex = (hex) => {
    return new Promise((resolve, reject) => {
      // Remove \x prefix if present
      const cleanHex = hex.startsWith('\\x') ? hex.slice(2) : hex;

      // Convert hex to Uint8Array
      const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
  };

  // Carregar dados do Supabase
  useEffect(() => {
    const loadSupabaseData = async () => {
      if (!classifier.current || !mobilenetModel.current || !currentModel) return;

      // setIsModelLoading(true); // Removido pois o state não existe mais
      // classifier.current.clearAllClasses(); // Removido para não limpar dados locais carregados

      try {
        // 1. Carregar Exemplos do Modelo (Polo ou Tera)
        // Mapear nome do modelo para nome da tabela
        let tableName = currentModel.toLowerCase();
        if (tableName.includes('polo')) tableName = 'polo';
        if (tableName.includes('tera')) tableName = 'tera';

        console.log(`Carregando dados da tabela: ${tableName}`);

        const { data: modelData, error: modelError } = await supabase
          .from(tableName)
          .select('*');

        if (modelError) {
          console.error(`Erro ao carregar ${tableName}:`, modelError);
        } else if (modelData) {
          console.log(`Carregado ${modelData.length} imagens de ${tableName}`);

          // Count samples locally first to avoid oscillating state updates
          const sampleCounts = {};

          for (const row of modelData) {
            try {
              const label = row.file_name;
              if (!row.url) continue;

              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.src = row.url;
              await new Promise((resolve) => { img.onload = resolve; });

              const activation = mobilenetModel.current.infer(img, true);
              classifier.current.addExample(activation, label);
              activation.dispose();

              // Increment local count
              sampleCounts[label] = (sampleCounts[label] || 0) + 1;
            } catch (err) {
              console.error('Erro processando imagem do modelo:', err);
            }
          }

          // Update state ONCE after processing all images
          setRegions(prev => prev.map(r => ({
            ...r,
            samples: (r.samples || 0) + (sampleCounts[r.id] || 0) // Add to existing samples
          })));
        }

        // 2. Carregar Fundos (Tabela fotoFundo)
        const { data: bgData, error: bgError } = await supabase
          .from('fotofundo')
          .select('*');

        if (bgError) {
          console.error('Erro ao carregar fotofundo:', bgError);
        } else if (bgData) {
          console.log(`Carregado ${bgData.length} imagens de fundo`);
          let newBgSamples = 0;
          for (const row of bgData) {
            try {
              if (!row.url) continue;

              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.src = row.url;
              await new Promise((resolve) => { img.onload = resolve; });

              const activation = mobilenetModel.current.infer(img, true);
              classifier.current.addExample(activation, 'background');
              activation.dispose();

              newBgSamples++;
            } catch (err) {
              console.error('Erro processando imagem de fundo:', err);
            }
          }
          setBackgroundSamples(prev => prev + newBgSamples);
        }

      } catch (e) {
        console.error('Erro geral loading:', e);
      } finally {
        // setIsModelLoading(false);
      }
    };

    loadSupabaseData();
  }, [currentModel]);

  const captureCropBase64 = (box) => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    const scaleX = video.videoWidth / video.clientWidth;
    const scaleY = video.videoHeight / video.clientHeight;

    const canvas = document.createElement('canvas');
    canvas.width = box.w * scaleX;
    canvas.height = box.h * scaleY;
    const ctx = canvas.getContext('2d');

    if (canvas.width <= 0 || canvas.height <= 0) return null;

    ctx.drawImage(video,
      box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY,
      0, 0, canvas.width, canvas.height
    );
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const addObjectExample = async (e) => {
    if (e) e.stopPropagation();

    if (isPredicting || !classifier.current) return;

    const activeRegion = regions.find(r => r.id === activeRegionId);
    if (!activeRegion) {
      console.error("No active region found");
      return;
    }

    if (activeRegion.samples >= 20) {
      alert("Limite de 20 exemplos atingido para otimizar desempenho.");
      return;
    }

    console.log(`Adding example for region ${activeRegion.id} (${activeRegion.name})`);

    const activation = getCropTensor(activeRegion.box);
    if (activation) {
      classifier.current.addExample(activation, getClassLabel(activeRegion.id));
      activation.dispose();

      setRegions(prevRegions =>
        prevRegions.map(r => r.id === activeRegionId ? { ...r, samples: r.samples + 1 } : r)
      );

      // Upload para Supabase
      try {
        const imageBase64 = captureCropBase64(activeRegion.box);
        if (imageBase64 && currentModel) {
          const tableName = currentModel.toLowerCase().includes('polo') ? 'polo' : 'tera';
          const { error } = await supabase
            .from(tableName)
            .insert({
              file_name: activeRegion.id,
              url: imageBase64
            });

          if (error) {
            console.error('Erro ao salvar no Supabase:', error);
          } else {
            console.log('Imagem salva no Supabase com sucesso!');
          }
        }
      } catch (err) {
        console.error('Erro no upload:', err);
      }
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

        // Upload para Supabase
        try {
          const imageBase64 = captureCropBase64(region.box);
          if (imageBase64) {
            const { error } = await supabase
              .from('fotofundo')
              .insert({
                file_name: `bg_${Date.now()}`,
                url: imageBase64
              });

            if (error) {
              console.error('Erro ao salvar fundo no Supabase:', error);
            }
          }
        } catch (err) {
          console.error('Erro no upload de fundo:', err);
        }
      }
    }
    if (successCount > 0) setBackgroundSamples(prev => prev + 1);
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
        predictRef.current = setTimeout(loopPrediction, 333);
      }
    };

    if (isPredicting && currentBarcode) loopPrediction();
    else {
      if (predictRef.current) clearTimeout(predictRef.current);
      setRegions(prev => prev.map(r => ({ ...r, status: null, confidence: 0 })));
    }
    return () => { if (predictRef.current) cancelAnimationFrame(predictRef.current); };
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
        const textWidth = ctx.measureText(labelText).width;
        ctx.fillRect(x, y - 22, textWidth + 16, 22);
        ctx.fillStyle = (viewMode === 'operator' && region.status) ? '#fff' : '#000';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(labelText, x + 4, y - 6);
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
        try { localStorage.removeItem(`modelData:${name}`); } catch (_) { }
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

  // --- Mouse Handlers ---
  const getClientCoordinates = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const handleMouseDown = (e) => {
    if (viewMode !== 'setup') return;
    const { x, y } = getClientCoordinates(e);
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = videoRef.current ? videoRef.current.videoWidth / rect.width : 1;
    const scaleY = videoRef.current ? videoRef.current.videoHeight / rect.height : 1;
    const mouseX = (x - rect.left) * scaleX;
    const mouseY = (y - rect.top) * scaleY;

    // Check resize handles first (simple 10px threshold)
    const activeRegion = regions.find(r => r.id === activeRegionId);
    if (activeRegion) {
      const { x: rx, y: ry, w: rw, h: rh } = activeRegion.box;
      if (Math.abs(mouseX - (rx + rw)) < 20 && Math.abs(mouseY - (ry + rh)) < 20) {
        setInteractionMode('resize');
        setDragStart({ x: mouseX, y: mouseY });
        return;
      }
    }

    // Check move
    const clickedRegion = regions.find(r =>
      mouseX >= r.box.x && mouseX <= r.box.x + r.box.w &&
      mouseY >= r.box.y && mouseY <= r.box.y + r.box.h
    );

    if (clickedRegion) {
      setActiveRegionId(clickedRegion.id);
      setInteractionMode('move');
      setDragStart({ x: mouseX, y: mouseY });
    }
  };

  const handleMouseMove = (e) => {
    if (viewMode !== 'setup' || interactionMode === 'none') return;
    const { x, y } = getClientCoordinates(e);
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = videoRef.current ? videoRef.current.videoWidth / rect.width : 1;
    const scaleY = videoRef.current ? videoRef.current.videoHeight / rect.height : 1;
    const mouseX = (x - rect.left) * scaleX;
    const mouseY = (y - rect.top) * scaleY;

    const dx = mouseX - dragStart.x;
    const dy = mouseY - dragStart.y;

    setRegions(prev => {
      const updated = prev.map(r => {
        if (r.id === activeRegionId) {
          const newBox = { ...r.box };
          if (interactionMode === 'move') {
            newBox.x += dx;
            newBox.y += dy;
          } else if (interactionMode === 'resize') {
            newBox.w = Math.max(20, newBox.w + dx);
            newBox.h = Math.max(20, newBox.h + dy);
          }
          return { ...r, box: newBox };
        }
        return r;
      });

      // Update local storage ref immediately for persistence
      if (selectedModel && modelsData.current[selectedModel]) {
        modelsData.current[selectedModel].regions = updated.map(r => ({ ...r, box: { ...r.box } }));
      }

      return updated;
    });

    setDragStart({ x: mouseX, y: mouseY });
  };

  const handleMouseUp = () => {
    if (interactionMode !== 'none') {
      setInteractionMode('none');
      if (selectedModel) saveModelToLocal(selectedModel);
    }
  };

  if (loadingError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-2xl border border-red-900/50 max-w-md text-center">
          <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Erro de Inicialização</h2>
          <p className="text-slate-400 mb-6">{loadingError}</p>
          <button onClick={handleRetryCamera} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold">
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }
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
            {viewMode === 'setup' ? <Unlock size={14} /> : <Lock size={14} />}
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
                      CONFIRMAR <ArrowRight size={18} />
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
                    <Check size={20} /> APROVADO
                  </div>
                ) : (
                  <div className="bg-red-600 text-white px-6 py-2 rounded-full font-bold shadow-lg flex items-center gap-2 animate-bounce">
                    <X size={20} /> FALHA DETECTADA
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
                  <Settings size={18} /> Configuração
                </h2>

                {/* Seletor de Câmera */}
                <div className="bg-slate-800 p-3 rounded-lg mb-3">
                  <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                    <Camera size={12} /> Selecionar Câmera
                  </label>
                  <select
                    className="w-full bg-slate-700 text-white text-xs rounded p-2 border border-slate-600 outline-none"
                    value={selectedDeviceId}
                    onChange={handleCameraChange}
                  >
                    {videoDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Câmera ${device.deviceId.slice(0, 5)}...`}
                      </option>
                    ))}
                    {videoDevices.length === 0 && <option>Nenhuma câmera detectada</option>}
                  </select>
                </div>

                {/* Seletor de Modelo de Carro */}
                <div className="bg-slate-800 p-3 rounded-lg mb-3">
                  <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                    <Car size={12} /> Modelo do Carro
                  </label>
                  <select
                    className="w-full bg-slate-700 text-white text-xs rounded p-2 border border-slate-600 outline-none"
                    value={selectedModel || ''}
                    onChange={(e) => handleModelSelect(e.target.value)}
                  >
                    <option value="Polo Track">Polo Track</option>
                    <option value="Tera">Tera</option>
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
                  <Plus size={14} /> NOVO OBJETO
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
                          setRegions(prev => prev.map(reg => reg.id === r.id ? { ...reg, name: val } : reg));
                        }}
                      />
                      <button onClick={(e) => { e.stopPropagation(); removeRegion(r.id) }} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500"><Trash2 size={14} /></button>
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
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
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
                    <Eraser size={16} /> GRAVAR FUNDO
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
                <h2 className="font-bold text-white mb-1 flex items-center gap-2"><Eye size={16} /> Inspeção Ativa</h2>
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
                  <Save size={20} /> SALVAR & PRÓXIMO
                </button>

                <div className="pt-2 border-t border-slate-800">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                    <Database size={10} /> Histórico da Sessão
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {history.slice(0, 5).map(h => (
                      <div key={h.id} className="text-xs flex items-center justify-between text-slate-400 bg-slate-800/50 p-1.5 rounded group hover:bg-slate-800 transition-colors">
                        <div className="flex items-center gap-2">
                          {h.image && <img src={h.image} alt="snap" className="w-6 h-6 rounded object-cover border border-slate-600" />}
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
