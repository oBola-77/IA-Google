import React, { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  BoxSelect, Trash2, Plus, Pencil,
  Check, X, Layout, Eraser,
  Lock, Unlock, Settings, Save, Database, AlertTriangle, Eye,
  ScanBarcode, ArrowRight, Camera, Car, Ruler
} from 'lucide-react';
import { saveImage, getImagesByModel, deleteImagesByModel, clearAllImages, updateModelName, bulkInsertImages, deleteImagesByLabel } from './db';
import { supabase } from './supabase';
import InspectionHistory from './InspectionHistory';
import { useCalibration } from './useCalibration';
import { processMeasurement, calculateDistance } from './services/MeasurementService';

const App = () => {
  // Metrology Hook
  const {
    calibrationPoints,
    addCalibrationPoint,
    realDistanceInput,
    setRealDistanceInput,
    scaleFactor,
    computeScaleFactor,
    resetCalibration,
    getPixelDistance
  } = useCalibration();

  // --- Refs ---
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const classifier = useRef(null);
  const mobilenetModel = useRef(null);
  const requestRef = useRef(null);
  const predictRef = useRef(null);
  const barcodeInputRef = useRef(null);

  const regionsRef = useRef([]);
  // Refs for loop (avoid stale closures)
  const viewModeRef = useRef('setup');
  const activeRegionIdRef = useRef('1');
  const currentBarcodeRef = useRef('');
  const calibrationPointsRef = useRef([]);
  const currentProjectTypeRef = useRef('detection');
  const scaleFactorRef = useRef(null);
  const measurementResultsRef = useRef([]); // [{ layer: 'regionId', x, y }]
  const frameCountRef = useRef(0);

  // --- Estados ---
  const [, setIsModelLoading] = useState(true);
  const [loadingError, setLoadingError] = useState(null);
  const [isCameraReady, setIsCameraReady] = useState(false);

  // Câmeras
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Modelo
  const [currentModel, setCurrentModel] = useState('Polo'); // 'Polo' | 'Tera'
  const [currentProjectType, setCurrentProjectType] = useState('detection'); // 'detection' | 'metrology'

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

  // Fetch initial history from Supabase
  useEffect(() => {
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (data) {
        const formattedHistory = data.map(item => ({
          id: item.id,
          code: item.barcode,
          timestamp: new Date(item.created_at).toLocaleString(),
          status: item.status,
          image: item.image_url,
          details: Array.isArray(item.details)
            ? item.details.map(d => `${d.name}: ${d.status === 'ok' ? 'OK' : 'FALHA'}`).join(', ')
            : 'Detalhes indisponíveis'
        }));
        setHistory(formattedHistory);
      }
    };
    fetchHistory();
  }, []);

  // Interação
  const [interactionMode, setInteractionMode] = useState('none');
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [actionMessageType, setActionMessageType] = useState('success');

  // History Modal
  const [showHistory, setShowHistory] = useState(false);

  // --- Car Model Logic ---
  const [selectedModel, setSelectedModel] = useState(null);
  // Store full model objects: {id, name, config}
  const [availableModels, setAvailableModels] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  // Custom Modal State for Project Type
  const [showModelTypeModal, setShowModelTypeModal] = useState(false);
  const [pendingModelName, setPendingModelName] = useState('');

  // Custom Modal State for Name Input
  const [showNameModal, setShowNameModal] = useState(false);
  const [newModelNameInput, setNewModelNameInput] = useState('');
  const [nameModalError, setNameModalError] = useState('');

  // Custom Modal State for Rename Input
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameModelInput, setRenameModelInput] = useState('');
  const [renameModalError, setRenameModalError] = useState('');

  // Fetch models from Supabase on load
  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .order('name', { ascending: true });
      setAvailableModels(data || []);
    } catch (e) {
      console.error("Erro ao buscar modelos:", e);
    }
  };

  const modelsData = useRef({});
  const isSwitchingRef = useRef(false);

  // Helper to get current model ID
  const getCurrentModelId = () => {
    const found = availableModels.find(m => m.name === selectedModel);
    return found ? found.id : null;
  };

  const handleAddModel = () => {
    setNewModelNameInput('');
    setNameModalError('');
    setShowNameModal(true);
  };

  const submitNewModelName = () => {
    const name = newModelNameInput.trim();
    if (!name) {
      setNameModalError("O nome não pode estar vazio.");
      return;
    }
    if (availableModels.some(m => m.name === name)) {
      setNameModalError("Modelo já existe!");
      return;
    }
    
    setShowNameModal(false);
    setPendingModelName(name);
    setShowModelTypeModal(true);
  };

  const confirmModelCreation = async (projectType) => {
    setShowModelTypeModal(false);
    const name = pendingModelName;
    if (!name) return;

    const newModelConfig = {
      type: projectType,
      regions: [{ id: '1', name: `Objeto 1 (${name})`, box: { x: 50, y: 50, w: 150, h: 150 }, samples: 0, status: null, confidence: 0 }],
      backgroundSamples: 0
    };

    try {
      const { data: inserted, error } = await supabase
        .from('models')
        .insert([{ name, config: newModelConfig }])
        .select();

      if (error) throw error;

      // Atualiza a lista de modelos no estado com o novo modelo já disponível
      const newModel = inserted ? inserted[0] : { id: Date.now().toString(), name, config: newModelConfig };
      setAvailableModels(prev => [...prev, newModel]);

      // Seleciona diretamente passando o objeto, sem esperar o estado atualizar
      handleStartScreenModelSelect(name, newModel);
    } catch (e) {
      console.error("Erro ao criar modelo:", e);
      alert("Erro ao criar modelo.");
    }
    setPendingModelName('');
  };

  const handleEditModel = () => {
    if (!selectedModel) return;
    setRenameModelInput(selectedModel);
    setRenameModalError('');
    setShowRenameModal(true);
  };

  const submitRenameModel = async () => {
    const newName = renameModelInput.trim();
    if (!newName || newName === selectedModel) {
      setShowRenameModal(false);
      return;
    }

    if (availableModels.some(m => m.name === newName)) {
      setRenameModalError("Já existe um modelo com este nome!");
      return;
    }

    setShowRenameModal(false);
    const modelId = getCurrentModelId();
    if (!modelId) return;

    try {
      // Update in Supabase
      const { error } = await supabase
        .from('models')
        .update({ name: newName })
        .eq('id', modelId);

      if (error) throw error;

      // Update Local State lists
      setAvailableModels(prev => prev.map(m => m.id === modelId ? { ...m, name: newName } : m));

      // Update Internal Refs if loaded
      if (modelsData.current[selectedModel]) {
        modelsData.current[newName] = modelsData.current[selectedModel];
        delete modelsData.current[selectedModel];
      }

      // Update Local DB (IndexedDB) for completeness, though we rely on cloud primarily now
      await updateModelName(selectedModel, newName);

      setSelectedModel(newName);
      // alert(`Modelo renomeado para "${newName}" com sucesso!`);
      setActionMessage(`Modelo renomeado para "${newName}" com sucesso!`);
      setActionMessageType('success');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (e) {
      console.error("Erro ao renomear modelo:", e);
      alert("Erro ao renomear modelo.");
    }
  };

  const handleDeleteModel = async () => {
    if (!selectedModel) return;
    const modelId = getCurrentModelId();
    if (!modelId) return;

    if (!window.confirm(`Tem certeza que deseja EXCLUIR o modelo "${selectedModel}"? \nIsso apagará todas as configurações e imagens (Cloud e Local).`)) return;

    try {
      // Delete from Supabase (Cascade handles samples)
      // We also need to delete bucket files. 
      // Ideally we list them and remove, but for now we rely on table cascade.
      // Note: Storage files remain if not handled.
      // Let's at least delete the table row.
      const { error } = await supabase.from('models').delete().eq('id', modelId);
      if (error) throw error;

      // Clear Local
      await deleteImagesByModel(selectedModel);
      if (modelsData.current[selectedModel]) delete modelsData.current[selectedModel];

      await fetchModels();
      setSelectedModel(null);
      setViewMode('setup');

      alert("Modelo excluído com sucesso.");
    } catch (e) {
      console.error("Erro ao excluir modelo:", e);
    }
  };

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

  const saveModelConfig = async (modelName) => {
    if (!modelName) return;
    const currentConfig = modelsData.current[modelName];
    if (!currentConfig) return;

    // Salvar na localStorage (persistente)
    try {
      localStorage.setItem(`modelData:${modelName}`, JSON.stringify(currentConfig));
    } catch (e) {
      console.error("Erro saving config to localStorage:", e);
    }

    // Atualizar o mock local
    const modelId = getCurrentModelId();
    if (modelId) {
      try {
        await supabase.from('models').update({ config: currentConfig }).eq('id', modelId);
      } catch (e) {
        console.error("Erro saving config to mock:", e);
      }
    }
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
    // REMOVIDO: localStorage.setItem(key, JSON.stringify(regions));
    // O salvamento agora ocorre apenas no handleMouseUp para evitar travamentos
  }, [regions]);

  // Sync refs for loop
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { activeRegionIdRef.current = activeRegionId; }, [activeRegionId]);
  useEffect(() => { currentBarcodeRef.current = currentBarcode; }, [currentBarcode]);
  useEffect(() => { calibrationPointsRef.current = calibrationPoints; }, [calibrationPoints]);
  useEffect(() => { currentProjectTypeRef.current = currentProjectType; }, [currentProjectType]);
  useEffect(() => { scaleFactorRef.current = scaleFactor; }, [scaleFactor]);

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
    if (selectedModel && !isSwitchingRef.current) {
      // Sync State to Ref before saving
      if (!modelsData.current[selectedModel]) modelsData.current[selectedModel] = {};
      const modelRef = modelsData.current[selectedModel];

      // Only update if changed to avoid unnecessary cycles (though useEffect deps handle this)
      modelRef.regions = regions;
      modelRef.backgroundSamples = backgroundSamples;

      saveModelConfig(selectedModel);
    }
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
            width: { ideal: 1280 },
            height: { ideal: 720 }
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

        await loadScript('/libs/iauto-inference-engine.js');
        await loadScript('/libs/iauto-cluster-module.js');

        await new Promise(r => setTimeout(r, 500));

        if (window.knnClassifier && window.mobilenet) {
          classifier.current = window.knnClassifier.create();
          console.log("Iniciando motor de inferência...");
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
    if (selectedModel) saveModelConfig(selectedModel);
  };

  /* --- Delete Region (Full Cleanup) --- */
  const handleDeleteRegion = async (id) => {
    if (regions.length <= 1) {
      alert("Você precisa ter pelo menos 1 região.");
      return;
    }

    if (!window.confirm("Tem certeza que deseja apagar este objeto? Todas as imagens de treinamento dele serão perdidas.")) return;

    try {
      const regionLabel = getClassLabel(id);
      const modelId = getCurrentModelId();

      // 1. Cloud Cleanup (if model exists in cloud)
      if (modelId) {
        // Find samples to get file paths
        const { data: samples } = await supabase
          .from('training_samples')
          .select('image_path')
          .eq('model_id', modelId)
          .eq('label', regionLabel);

        if (samples && samples.length > 0) {
          const paths = samples.map(s => s.image_path);
          // Delete files from bucket
          await supabase.storage.from('training_datasets').remove(paths);

          // Delete rows (Cascade won't work here because we are keeping model, just removing samples)
          await supabase.from('training_samples')
            .delete()
            .eq('model_id', modelId)
            .eq('label', regionLabel);
        }
      }

      // 2. Local Cleanup
      await deleteImagesByLabel(regionLabel);

      // 3. Clear Classifier Class
      if (classifier.current) {
        try { classifier.current.clearClass(regionLabel); } catch (_) { }
      }

      // 4. Update State
      let nextActiveId = activeRegionId;
      if (activeRegionId === id) {
        const remaining = regions.filter(r => r.id !== id);
        nextActiveId = remaining[0].id;
      }

      setRegions(prev => {
        const updated = prev.filter(r => r.id !== id);
        // Updating ref for saveModelConfig
        if (selectedModel && modelsData.current[selectedModel]) {
          modelsData.current[selectedModel].regions = updated;
        }
        return updated;
      });

      if (nextActiveId !== activeRegionId) setActiveRegionId(nextActiveId);

      // 5. Save Config (removes box from metadata)
      // Wait a bit for state to settle or pass updated directly
      // saveModelConfig reads from modelsData.current which we updated above
      if (selectedModel) {
        await saveModelConfig(selectedModel);
      }

    } catch (e) {
      console.error("Erro ao excluir região:", e);
      alert("Erro ao excluir região.");
    }
  };

  /* --- Clear Samples of a Region (Keep Region) --- */
  const handleClearRegionSamples = async (id, name) => {
    if (!window.confirm(`Deseja apagar todas as fotos de treinamento de "${name}"? (O quadrado da região será mantido)`)) return;

    try {
      const regionLabel = getClassLabel(id);
      const modelId = getCurrentModelId();

      // 1. Cloud Cleanup
      if (modelId) {
        const { data: samples } = await supabase.from('training_samples')
          .select('image_path').eq('model_id', modelId).eq('label', regionLabel);

        if (samples && samples.length > 0) {
          const paths = samples.map(s => s.image_path);
          await supabase.storage.from('training_datasets').remove(paths);
          await supabase.from('training_samples').delete().eq('model_id', modelId).eq('label', regionLabel);
        }
      }

      // 2. Local Cleanup
      await deleteImagesByLabel(regionLabel);

      // 3. Clear Classifier
      if (classifier.current) {
        try { classifier.current.clearClass(regionLabel); } catch (_) { }
      }

      // 4. Update State
      setRegions(prev => {
        const updated = prev.map(r => r.id === id ? { ...r, samples: 0, status: null, confidence: 0 } : r);
        if (selectedModel && modelsData.current[selectedModel]) {
          modelsData.current[selectedModel].regions = updated;
        }
        return updated;
      });

      // 5. Save Config
      if (selectedModel) await saveModelConfig(selectedModel);

    } catch (e) {
      console.error("Erro ao limpar amostras:", e);
      alert("Erro ao limpar amostras.");
    }
  };

  const clearRegionSamples = (regionId) => {
    if (!classifier.current) return;
    try {
      classifier.current.clearClass(getClassLabel(regionId));
    } catch (_) { }
    setRegions(prev => prev.map(r => r.id === regionId ? { ...r, samples: 0, status: null, confidence: 0 } : r));
    if (selectedModel) saveModelConfig(selectedModel);
  };

  // --- IA Core ---
  const getCropTensor = (box) => {
    if (!videoRef.current || !mobilenetModel.current || !isCameraReady) return null;
    const video = videoRef.current;
    if (video.readyState !== 4) return null;

    return tf.tidy(() => {
      const img = tf.browser.fromPixels(video);
      // box is already in intrinsic video coordinates, no scaling needed based on clientWidth

      let startX = Math.floor(box.x);
      let startY = Math.floor(box.y);
      let width = Math.floor(box.w);
      let height = Math.floor(box.h);

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

  // Carregar dados locais (IndexedDB)
  useEffect(() => {
    const loadLocalTrainingData = async () => {
      if (!classifier.current || !mobilenetModel.current || !selectedModel) return;

      classifier.current.clearAllClasses();

      try {
        // 1. Carregar Exemplos do Modelo (incluindo background)
        console.log(`Carregando dados locais para: ${selectedModel}`);

        const modelData = await getImagesByModel(selectedModel);

        if (modelData) {
          console.log(`Carregado ${modelData.length} imagens de ${selectedModel}`);
          const sampleCounts = {};
          let newBgSamples = 0;

          for (const row of modelData) {
            try {
              const label = row.label;
              if (!row.url) continue;

              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.src = row.url;
              await new Promise((resolve) => { img.onload = resolve; });

              const activation = mobilenetModel.current.infer(img, true);

              const normalizedLabel = label.toLowerCase().trim();

              if (normalizedLabel === 'background') {
                classifier.current.addExample(activation, 'background');
                newBgSamples++;
              } else {
                classifier.current.addExample(activation, label);
                // Extrai o ID da região do label
                const regionId = label.includes('::') ? label.split('::')[1] : label;
                sampleCounts[regionId] = (sampleCounts[regionId] || 0) + 1;
              }
              activation.dispose();

            } catch (err) {
              console.error('Erro processando imagem:', err);
            }
          }

          console.log(`Finalizado: ${newBgSamples} amostras de fundo carregadas.`);

          // Atualizar contadores na UI
          setRegions(prev => prev.map(r => ({
            ...r,
            samples: (sampleCounts[r.id] || 0)
          })));
          setBackgroundSamples(newBgSamples);
        }

      } catch (e) {
        console.error('Erro geral loading:', e);
      }
    };

    loadLocalTrainingData();
  }, [selectedModel]);

  const captureCropBase64 = (box) => {
    if (!videoRef.current) return null;
    const video = videoRef.current;

    // box coords are intrinsic video pixels. Canvas needs to match box size (intrinsic).
    const canvas = document.createElement('canvas');
    canvas.width = box.w;
    canvas.height = box.h;
    const ctx = canvas.getContext('2d');

    if (canvas.width <= 0 || canvas.height <= 0) return null;

    ctx.drawImage(video,
      box.x, box.y, box.w, box.h, // Source (intrinsic)
      0, 0, canvas.width, canvas.height // Dest
    );
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const addObjectExample = async (e, targetRegionId = null) => {
    if (e) e.stopPropagation();

    if (isPredicting || !classifier.current) return;

    const regionIdToUse = targetRegionId || activeRegionId;
    const activeRegion = regions.find(r => r.id === regionIdToUse);
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
        prevRegions.map(r => r.id === regionIdToUse ? { ...r, samples: r.samples + 1 } : r)
      );

      // Salvar Local
      try {
        const imageBase64 = captureCropBase64(activeRegion.box);
        if (imageBase64 && selectedModel) {
          await saveImage(selectedModel, getClassLabel(activeRegion.id), imageBase64);
        }
        console.log(`Imagem salva localmente com sucesso!`);
      } catch (err) {
        console.error('Erro ao salvar imagem:', err);
      }
    }
  };

  const addBackgroundExample = async () => {
    if (isPredicting || !classifier.current) return;
    let successCount = 0;

    const modelId = getCurrentModelId();

    for (const region of regions) {
      const activation = getCropTensor(region.box);
      if (activation) {
        classifier.current.addExample(activation, 'background');
        activation.dispose();
        successCount++;

        try {
          const imageBase64 = captureCropBase64(region.box);
          if (imageBase64) {
            await saveImage(selectedModel, 'background', imageBase64);
          }
        } catch (err) {
          console.error('Erro ao salvar fundo:', err);
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

        if (result.label === label) {
          conf = result.confidences[label] || 0;
          if (conf >= threshold) {
            resultStatus = 'ok';
          }
        } else {
          conf = result.confidences[label] || 0;
          resultStatus = 'bad';
        }

        // Debug Log
        // console.log(`Region: ${label}, Predicted: ${result.label}, Conf: ${conf}`);

      } catch (e) {
        console.log(e);
      } finally {
        activation.dispose();
      }

      return { ...region, status: resultStatus, confidence: conf };
    }));

    setRegions(updatedRegions);
  };

  // --- Excluir Todas as Fotos ---
  // --- Excluir Todas as Fotos e Resetar ---
  const handleDeleteAllPhotos = async () => {
    if (!selectedModel) return;

    const confirmDelete = window.confirm(
      '⚠️ ATENÇÃO: Isso vai excluir TODOS os objetos e TODAS as fotos deste modelo (Nuvem e Local). O modelo voltará ao estado inicial. Tem certeza?'
    );

    if (!confirmDelete) return;

    try {
      setActionMessage('Excluindo tudo...');
      setActionMessageType('warning');

      // Local Cleanup
      await deleteImagesByModel(selectedModel);

      // 3. Clear Classifier
      if (classifier.current) {
        classifier.current.clearAllClasses();
      }

      // 4. Reset Configurations (Keep 1 empty region)
      const defaultRegions = [{
        id: Date.now().toString(),
        name: `Objeto 1 (${selectedModel})`,
        box: { x: 50, y: 50, w: 150, h: 150 },
        samples: 0, status: null, confidence: 0
      }];

      setRegions(defaultRegions);
      setBackgroundSamples(0);
      setActiveRegionId(defaultRegions[0].id);

      // 5. Save Reset Config to Cloud
      // Update ref immediately so saveModelConfig works
      if (modelsData.current[selectedModel]) {
        modelsData.current[selectedModel].regions = defaultRegions;
        modelsData.current[selectedModel].backgroundSamples = 0;
      }
      await saveModelConfig(selectedModel);

      setActionMessage('✅ Modelo resetado com sucesso!');
      setActionMessageType('success');
      setTimeout(() => setActionMessage(null), 3000);

    } catch (err) {
      console.error('Erro ao resetar modelo:', err);
      setActionMessage('❌ Erro ao resetar modelo');
      setActionMessageType('error');
      setTimeout(() => setActionMessage(null), 3000);
    }
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
    return () => { if (predictRef.current) clearTimeout(predictRef.current); };
  }, [isPredicting, currentBarcode, threshold]);

  const uploadImage = async (base64Image) => {
    // Modo local: retorna o próprio base64 como URL
    return base64Image;
  };

  /* --- Capture Logic --- */
  const captureFullScreenshot = () => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;

    // Create an off-screen canvas matching the video's intrinsic resolution
    const offCanvas = document.createElement('canvas');
    offCanvas.width = video.videoWidth;
    offCanvas.height = video.videoHeight;
    const ctx = offCanvas.getContext('2d');

    if (offCanvas.width === 0 || offCanvas.height === 0) return null;

    // 1. Draw the Video Frame
    ctx.drawImage(video, 0, 0, offCanvas.width, offCanvas.height);

    // 2. Draw Overlays (Regions & Status)
    // We need to map the normalized regions (if they were normalized) or just use them directly 
    // since they seem to be stored in intrinsic coordinates (based on getCropTensor logic)
    regions.forEach(region => {
      const { x, y, w, h } = region.box;

      let strokeColor = '#3b82f6'; // blue default
      if (region.status === 'ok') strokeColor = '#22c55e'; // green
      else if (region.status === 'bad') strokeColor = '#ef4444'; // red

      // Draw Box
      ctx.lineWidth = 2;
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(x, y, w, h);

      // Draw Label Background
      const labelText = region.status ? (region.status === 'ok' ? 'OK' : 'FALHA') : region.name;
      ctx.font = 'bold 12px sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const textWidth = textMetrics.width;
      const textHeight = 16;

      ctx.fillStyle = strokeColor;
      ctx.fillRect(x, y - textHeight, textWidth + 10, textHeight);

      // Draw Label Text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, x + 5, y - 4);
    });

    // 3. Draw Global Status (Approved/Rejected) watermark
    const allOk = regions.every(r => r.status === 'ok');
    const globalStatus = allOk ? 'APROVADO' : 'REPROVADO';
    const statusColor = allOk ? '#22c55e' : '#ef4444';

    ctx.save();
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = statusColor;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1; // Subtle stroke
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    // Draw at bottom right with some padding
    ctx.strokeText(globalStatus, offCanvas.width - 15, offCanvas.height - 15);
    ctx.fillText(globalStatus, offCanvas.width - 15, offCanvas.height - 15);
    ctx.restore();

    return offCanvas.toDataURL('image/jpeg', 0.8);
  };

  const saveToHistory = async () => {
    const allOk = regions.every(r => r.status === 'ok');
    const snapshot = captureFullScreenshot();

    const newInspection = {
      barcode: currentBarcode,
      model_name: selectedModel,
      status: allOk ? 'APROVADO' : 'REPROVADO',
      image_url: snapshot, // base64 local
      details: regions.map(r => ({
        name: r.name,
        status: r.status,
        confidence: r.confidence
      }))
    };

    // Salvar via mock local
    await supabase.from('inspections').insert([newInspection]);

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



  // Helper para calcular métricas de exibição do vídeo (considerando object-fit: contain)
  const getVideoContentRect = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const rect = canvasRef.current.getBoundingClientRect(); // Tamanho do container

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = rect.width;
    const ch = rect.height;

    if (!vw || !vh || !cw || !ch) return null;

    const videoRatio = vw / vh;
    const containerRatio = cw / ch;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (containerRatio > videoRatio) {
      // Container é mais largo -> Pillarbox (barras laterais)
      drawHeight = ch;
      drawWidth = ch * videoRatio;
      offsetX = (cw - drawWidth) / 2;
      offsetY = 0;
    } else {
      // Container é mais alto -> Letterbox (barras topo/baixo)
      drawWidth = cw;
      drawHeight = cw / videoRatio;
      offsetX = 0;
      offsetY = (ch - drawHeight) / 2;
    }

    return {
      rect,       // BoundingClientRect do container
      offsetX,    // Offset X visual do vídeo
      offsetY,    // Offset Y visual do vídeo
      scale: vw / drawWidth, // Fator para converter pixels de tela para pixels do vídeo
      drawScale: drawWidth / vw // Fator para converter pixels do vídeo para pixels de tela
    };
  };

  // --- Loop Visual ---
  const loop = () => {
    // Read from refs to get fresh state in the RAF loop
    const viewMode = viewModeRef.current;
    const activeRegionId = activeRegionIdRef.current;
    const currentBarcode = currentBarcodeRef.current;

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

    const metrics = getVideoContentRect();
    if (!metrics) {
      requestRef.current = requestAnimationFrame(loop);
      return;
    }

    const { offsetX, offsetY, drawScale } = metrics;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(drawScale, drawScale);

    // --- DRAW CALIBRATION ---
    if (viewMode === 'calibration') {
      const points = calibrationPointsRef.current;

      // Draw Points
      points.forEach((p, i) => {
        ctx.fillStyle = '#06b6d4'; // cyan-500
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 / drawScale, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = `bold ${12 / drawScale}px monospace`;
        ctx.fillText(i === 0 ? 'A' : 'B', p.x + (8 / drawScale), p.y - (8 / drawScale));
      });

      // Draw Line
      if (points.length === 2) {
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2 / drawScale;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();

        // Draw Distance Label
        const midX = (points[0].x + points[1].x) / 2;
        const midY = (points[0].y + points[1].y) / 2;

        const dx = points[1].x - points[0].x;
        const dy = points[1].y - points[0].y;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);

        ctx.fillStyle = '#06b6d4'; // cyan background
        const text = `${pixelDist.toFixed(1)}px`;
        const textWidth = ctx.measureText(text).width;
        ctx.fillRect(midX, midY - (10 / drawScale), textWidth + 10, 15 / drawScale); // rough background

        ctx.fillStyle = 'black';
        ctx.fillText(text, midX + 2, midY);
      }
    }

    // --- METROLOGY PROCESSING (Operator Mode) ---
    const projectType = currentProjectTypeRef.current;
    if (projectType === 'metrology' && viewMode === 'operator' && currentBarcode) {
      frameCountRef.current++;

      // Throttling: Process every 10 frames (~6 FPS)
      if (frameCountRef.current % 10 === 0) {
        const scale = scaleFactorRef.current;
        if (scale) {
          // Determine regions to measure (Assuming all active regions)
          // In future: Filter by "type"
          const rs = regionsRef.current;

          // Process each region
          const newResults = rs.map(r => {
            // Only process needed
            const res = processMeasurement(videoRef.current, r, scale);
            return { id: r.id, ...res };
          });
          measurementResultsRef.current = newResults;
        }
      }
    }

    // --- DRAW MEASUREMENTS ---
    if (projectType === 'metrology' && viewMode === 'operator' && currentBarcode) {
      const results = measurementResultsRef.current;
      const validPoints = results.filter(r => r.status === 'ok' && r.centroid);

      // MODE A: SINGLE OBJECT DIMENSIONING
      if (validPoints.length === 1) {
        const res = validPoints[0];

        if (res.dimensionsPx && scaleFactorRef.current) {
          const scale = scaleFactorRef.current;
          const wMm = res.dimensionsPx.width / scale;
          const hMm = res.dimensionsPx.height / scale;

          // Draw Rotated Rect (Bounding Box) if available
          if (res.rotatedRect) {
            const { center, size, angle } = res.rotatedRect;

            ctx.save();
            ctx.translate(center.x, center.y);
            ctx.rotate(angle * Math.PI / 180);

            ctx.strokeStyle = '#22c55e'; // green-500
            ctx.lineWidth = 2 / drawScale;
            ctx.strokeRect(-size.width / 2, -size.height / 2, size.width, size.height);

            ctx.restore();
          }

          // Draw Label (Width x Height)
          ctx.fillStyle = '#0f172a'; // slate-900 bg
          const text = `L: ${Math.min(wMm, hMm).toFixed(1)}mm  x  A: ${Math.max(wMm, hMm).toFixed(1)}mm`;
          const fontSize = 16 / drawScale;
          ctx.font = `bold ${fontSize}px font-mono`;
          const textWidth = ctx.measureText(text).width;

          const labelX = res.centroid.x - (textWidth / 2);
          const labelY = res.centroid.y;

          ctx.fillRect(labelX - 10, labelY - (fontSize + 10), textWidth + 20, fontSize + 20);
          ctx.fillStyle = '#4ade80'; // green-400 text
          ctx.fillText(text, labelX, labelY);
        } else {
          // Fallback if dimensions missing
          ctx.fillStyle = '#eab308';
          ctx.fillText("Calculando dimensões...", res.centroid.x, res.centroid.y);
        }

      }
      // MODE B: MULTI-POINT DISTANCE (Legacy)
      else if (validPoints.length >= 2) {

        // Draw Centroids
        validPoints.forEach(res => {
          ctx.fillStyle = '#eab308';
          ctx.beginPath();
          ctx.arc(res.centroid.x, res.centroid.y, 4 / drawScale, 0, 2 * Math.PI);
          ctx.fill();
        });

        const p1 = validPoints[0].centroid;
        const p2 = validPoints[1].centroid;

        // Draw Line
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2 / drawScale;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Calculate Real Distance
        const scale = scaleFactorRef.current;
        if (scale) {
          const distMm = calculateDistance(p1, p2, scale);

          // Draw Label
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;

          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          const text = `Dist: ${distMm.toFixed(2)} mm`;
          ctx.font = `bold ${16 / drawScale}px sans-serif`;
          const textWidth = ctx.measureText(text).width;
          ctx.fillRect(midX - 5, midY - (20 / drawScale), textWidth + 10, 25 / drawScale);

          ctx.fillStyle = '#fbbf24'; // yellow
          ctx.fillText(text, midX, midY);
        }
      } else if (results.length > 0) {
        // Feedback if 0 points
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const xPos = 10 / drawScale;
        const yPos = 10 / drawScale;
        ctx.fillRect(xPos, yPos, 220 / drawScale, 30 / drawScale);
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold ${14 / drawScale}px sans-serif`;
        ctx.fillText("Buscando objeto...", xPos + (10 / drawScale), yPos + (20 / drawScale));
      }
    }

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

      // Compensar a escala da linha para não ficar muito fina/grossa
      ctx.lineWidth = lineWidth / drawScale;
      ctx.strokeStyle = strokeColor;

      ctx.setLineDash(viewMode === 'setup' && !isActive ? [5, 5] : []);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      if (viewMode === 'setup' || (viewMode === 'operator' && currentBarcode)) {
        ctx.fillStyle = strokeColor;
        const labelText = viewMode === 'operator' && region.status ? (region.status === 'ok' ? 'OK' : 'FALHA') : region.name;
        // Reset scale for text to ensure sharpness? Or just draw scaled.
        // Drawing scaled text might be blurry or distorted.
        // Better to calculate position and draw unscaled text?
        // For simplicity, let's keep drawing in transformed space but adjust size.

        ctx.font = `bold ${12 / drawScale}px sans-serif`;
        const textWidth = ctx.measureText(labelText).width;

        ctx.fillRect(x, y - (22 / drawScale), textWidth + (16 / drawScale), (22 / drawScale));

        ctx.fillStyle = (viewMode === 'operator' && region.status) ? '#fff' : '#000';
        ctx.fillText(labelText, x + (4 / drawScale), y - (6 / drawScale));
      }

      if (viewMode === 'setup' && isActive) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        // Resize handle
        ctx.arc(x + w, y + h, 8 / drawScale, 0, 2 * Math.PI);
        ctx.fill();
      }
    });

    ctx.restore();
    requestRef.current = requestAnimationFrame(loop);
  };

  const activeRegion = regions.find(r => r.id === activeRegionId);
  const isUnbalanced = activeRegion && (activeRegion.samples > backgroundSamples * 2 || backgroundSamples > activeRegion.samples * 2) && backgroundSamples > 0;
  const hasPhotos = (classifier.current && classifier.current.getNumClasses() > 0) || regions.some(r => r.samples > 0) || backgroundSamples > 0 || history.length > 0;


  const handleModelSelect = (modelName) => {
    isSwitchingRef.current = true;
    if (selectedModel) saveModelConfig(selectedModel);
    setSelectedModel(modelName);
    const stored = loadModelFromLocal(modelName);
    if (classifier.current) {
      classifier.current.clearAllClasses();
      if (stored && stored.dataset) {
        const ds = deserializeDataset(stored.dataset);
        if (ds) classifier.current.setClassifierDataset(ds);
      } else if (modelsData.current[modelName] && modelsData.current[modelName].dataset) {
        classifier.current.setClassifierDataset(modelsData.current[modelName].dataset);
      }
    }

    // Default structure for new models if not found in cache or storage
    const defaultStructure = {
      regions: [{ id: '1', name: `Objeto 1 (${modelName})`, box: { x: 50, y: 50, w: 150, h: 150 }, samples: 0, status: null, confidence: 0 }],
      backgroundSamples: 0
    };

    const sourceData = stored || modelsData.current[modelName] || defaultStructure;

    // Detect Project Type from Config
    // Priority: 1. LocalStorage (Flat) 2. Memory (Flat) 3. Supabase List (Flat/Nested)
    if (sourceData.type) {
      setCurrentProjectType(sourceData.type);
    } else if (sourceData.config && sourceData.config.type) {
      // Legacy or Nested from Supabase availableModels
      setCurrentProjectType(sourceData.config.type);
    } else {
      // Check availableModels list directly (Initial Load State)
      const modelFromList = availableModels.find(m => m.name === modelName);
      const listConfig = modelFromList?.config || {};
      setCurrentProjectType(listConfig.type || 'detection');
    }

    // Load config (regions, etc)
    const config = sourceData.config || sourceData; // Handle legacy structure where root was config
    const sourceRegions = sourceData.regions;

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

    const bgSamples = sourceData.backgroundSamples != null ? sourceData.backgroundSamples : 0;
    setBackgroundSamples(bgSamples);

    setViewMode('setup');
    setIsPredicting(false);
    setCurrentBarcode('');
    setTimeout(() => { isSwitchingRef.current = false; }, 0);
  };

  /* --- Local Loading --- */
  // modelObj é opcional: pode ser passado diretamente para evitar depender do estado async
  const handleStartScreenModelSelect = async (modelName, modelObj = null) => {
    setIsSyncing(true);
    setSyncStatus('Carregando modelo...');

    try {
      // Usa o objeto passado ou busca na lista de modelos atual
      const found = modelObj || availableModels.find(m => m.name === modelName);
      if (!found) throw new Error("Modelo não encontrado");

      const config = found.config || {};
      const projectType = config.type || 'detection';
      setCurrentProjectType(projectType);

      modelsData.current[modelName] = {
        type: projectType,
        regions: config.regions || [],
        backgroundSamples: config.backgroundSamples || 0,
        dataset: null
      };

      handleModelSelect(modelName);
      setSyncStatus('Pronto!');
      setTimeout(() => setIsSyncing(false), 300);

    } catch (e) {
      console.error("Erro ao selecionar modelo:", e);
      alert("Erro ao carregar modelo: " + e.message);
      setIsSyncing(false);
    }
  };



  if (!selectedModel) {
    if (isSyncing) {
      return (
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center flex-col">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <h2 className="text-xl font-bold">{syncStatus}</h2>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-950 text-white font-sans flex items-center justify-center p-4">
        {/* MODAL DE NOME DO MODELO */}
        {showNameModal && (
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
              <h2 className="text-xl font-bold mb-4">Nome do novo modelo</h2>
              <input
                type="text"
                autoFocus
                value={newModelNameInput}
                onChange={(e) => { setNewModelNameInput(e.target.value); setNameModalError(''); }}
                onKeyDown={(e) => { if(e.key === 'Enter') submitNewModelName(); }}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 outline-none mb-2"
                placeholder="Ex: Polo"
              />
              {nameModalError && <p className="text-red-500 text-sm mb-4">{nameModalError}</p>}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowNameModal(false)}
                  className="text-slate-400 hover:text-white font-bold px-4 py-2"
                >
                  Cancelar
                </button>
                <button
                  onClick={submitNewModelName}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-2 rounded-lg"
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE TIPO DE PROJETO */}
        {showModelTypeModal && (
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
              <h2 className="text-xl font-bold mb-2">Selecione o Modo</h2>
              <p className="text-slate-400 text-sm mb-6">
                Defina como o projeto <span className="font-bold text-white">"{pendingModelName}"</span> irá funcionar.
              </p>
              
              <div className="space-y-3">
                <button
                  onClick={() => confirmModelCreation('detection')}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 p-4 rounded-xl text-left transition-all group"
                >
                  <div className="flex items-center gap-3 mb-1">
                    <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg group-hover:bg-blue-500 group-hover:text-white transition-colors">
                      <BoxSelect size={20} />
                    </div>
                    <span className="font-bold text-lg text-white">Detecção</span>
                  </div>
                  <p className="text-slate-400 text-sm pl-11">
                    Selecione objetos na imagem para detecção.
                  </p>
                </button>

                <button
                  onClick={() => confirmModelCreation('metrology')}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-500 p-4 rounded-xl text-left transition-all group"
                >
                  <div className="flex items-center gap-3 mb-1">
                    <div className="p-2 bg-green-500/20 text-green-400 rounded-lg group-hover:bg-green-500 group-hover:text-white transition-colors">
                      <Ruler size={20} />
                    </div>
                    <span className="font-bold text-lg text-white">Medição</span>
                  </div>
                  <p className="text-slate-400 text-sm pl-11">
                    Utilize para realizar medições de peças.
                  </p>
                </button>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowModelTypeModal(false)}
                  className="text-slate-400 hover:text-white font-bold px-4 py-2"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-md w-full bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl p-8 text-center">
          <div className="bg-blue-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <h1 className="text-3xl font-black text-blue-500 italic">iAuto</h1>
          </div>
          <h1 className="text-2xl font-bold mb-2">iAuto Inspection</h1>
          <p className="text-slate-400 mb-8">Escolha o veículo para carregar as configurações de inspeção.</p>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {availableModels.map(model => (
              <button
                key={model.id}
                onClick={() => handleStartScreenModelSelect(model.name)}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/50 p-4 rounded-xl flex items-center justify-between group transition-all"
              >
                <span className="font-bold text-lg group-hover:text-blue-400 transition-colors uppercase">{model.name}</span>
                <ArrowRight size={20} className="text-slate-600 group-hover:text-blue-500" />
              </button>
            ))}

            <button
              onClick={handleAddModel}
              className="w-full bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 border-dashed p-4 rounded-xl flex items-center justify-center gap-2 group transition-all"
            >
              <Plus size={20} className="text-blue-500" />
              <span className="font-bold text-blue-500">CRIAR NOVO MODELO</span>
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
    const { x, y } = getClientCoordinates(e);

    const metrics = getVideoContentRect();
    if (!metrics) return;

    const { rect, offsetX, offsetY, scale } = metrics;

    // Converte coordenadas da tela para pixels intrínsecos do video
    const mouseX = ((x - rect.left) - offsetX) * scale;
    const mouseY = ((y - rect.top) - offsetY) * scale;

    // --- CALIBRATION MODE ---
    if (viewMode === 'calibration') {
      addCalibrationPoint(mouseX, mouseY);
      return;
    }

    if (viewMode !== 'setup') return;

    // Threshold em pixels de tela para facilitar o clique (30px)
    const RESIZE_THRESHOLD = 30 * scale;

    // Check resize handles first
    const activeRegion = regions.find(r => r.id === activeRegionId);
    if (activeRegion) {
      const { x: rx, y: ry, w: rw, h: rh } = activeRegion.box;
      const dist = Math.sqrt(Math.pow(mouseX - (rx + rw), 2) + Math.pow(mouseY - (ry + rh), 2));

      if (dist < RESIZE_THRESHOLD) {
        setInteractionMode('resize');
        dragStartRef.current = { x: mouseX, y: mouseY };
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
      dragStartRef.current = { x: mouseX, y: mouseY };
    }
  };

  const handleMouseMove = (e) => {
    if (viewMode !== 'setup' || interactionMode === 'none') return;
    const { x, y } = getClientCoordinates(e);

    const metrics = getVideoContentRect();
    if (!metrics) return;

    const { rect, offsetX, offsetY, scale } = metrics;
    const mouseX = ((x - rect.left) - offsetX) * scale;
    const mouseY = ((y - rect.top) - offsetY) * scale;

    const dx = mouseX - dragStartRef.current.x;
    const dy = mouseY - dragStartRef.current.y;

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

      // Sincroniza refs imediatamente para garantir fluidez no Canvas
      regionsRef.current = updated;

      // Update local storage ref immediately for persistence
      if (selectedModel && modelsData.current[selectedModel]) {
        modelsData.current[selectedModel].regions = updated.map(r => ({ ...r, box: { ...r.box } }));
      }

      return updated;
    });

    dragStartRef.current = { x: mouseX, y: mouseY };
  };

  const handleMouseUp = () => {
    if (interactionMode !== 'none') {
      setInteractionMode('none');
      if (selectedModel) saveModelConfig(selectedModel);
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
      {/* MODAL DE NOME DO MODELO (Reaproveitado na Sidebar) */}
      {showNameModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-4">Nome do novo modelo</h2>
            <input
              type="text"
              autoFocus
              value={newModelNameInput}
              onChange={(e) => { setNewModelNameInput(e.target.value); setNameModalError(''); }}
              onKeyDown={(e) => { if(e.key === 'Enter') submitNewModelName(); }}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 outline-none mb-2"
              placeholder="Ex: Polo"
            />
            {nameModalError && <p className="text-red-500 text-sm mb-4">{nameModalError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowNameModal(false)}
                className="text-slate-400 hover:text-white font-bold px-4 py-2"
              >
                Cancelar
              </button>
              <button
                onClick={submitNewModelName}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-2 rounded-lg"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE TIPO DE PROJETO (Reaproveitado na Sidebar) */}
      {showModelTypeModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-2">Selecione o Modo</h2>
            <p className="text-slate-400 text-sm mb-6">
              Defina como o projeto <span className="font-bold text-white">"{pendingModelName}"</span> irá funcionar.
            </p>
            
            <div className="space-y-3">
              <button
                onClick={() => confirmModelCreation('detection')}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 p-4 rounded-xl text-left transition-all group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg group-hover:bg-blue-500 group-hover:text-white transition-colors">
                    <BoxSelect size={20} />
                  </div>
                  <span className="font-bold text-lg text-white">Detecção</span>
                </div>
                <p className="text-slate-400 text-sm pl-11">
                  Selecione objetos na imagem para detecção.
                </p>
              </button>

              <button
                onClick={() => confirmModelCreation('metrology')}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-green-500 p-4 rounded-xl text-left transition-all group"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 bg-green-500/20 text-green-400 rounded-lg group-hover:bg-green-500 group-hover:text-white transition-colors">
                    <Ruler size={20} />
                  </div>
                  <span className="font-bold text-lg text-white">Medição</span>
                </div>
                <p className="text-slate-400 text-sm pl-11">
                  Utilize para realizar medições de peças.
                </p>
              </button>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowModelTypeModal(false)}
                className="text-slate-400 hover:text-white font-bold px-4 py-2"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL DE RENOMEAR MODELO */}
      {showRenameModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-4">Renomear Modelo</h2>
            <input
              type="text"
              autoFocus
              value={renameModelInput}
              onChange={(e) => { setRenameModelInput(e.target.value); setRenameModalError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRenameModel(); }}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 outline-none mb-2"
              placeholder="Novo nome"
            />
            {renameModalError && <p className="text-red-500 text-sm mb-4">{renameModalError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="text-slate-400 hover:text-white font-bold px-4 py-2"
              >
                Cancelar
              </button>
              <button
                onClick={submitRenameModel}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-2 rounded-lg"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900 z-50">
        <div className="flex items-center gap-2">
          <Layout className="text-blue-500" />
          <h1 className="font-bold tracking-tight">iAuto <span className="text-blue-500 font-black italic">Inspection</span> <span className="text-slate-600 font-normal text-xs ml-2">v2.7 Stable</span></h1>
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
            {viewMode === 'setup' ? 'PRODUÇÃO' : 'OPERADOR'}
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

              {/* CONFIGURAÇÃO INICIAL */}
              <div className="p-3 border-b border-slate-800 space-y-2">
                <div>
                  <label className="text-[10px] text-slate-500 flex items-center gap-1 mb-1"><Camera size={10} /> Câmera</label>
                  <select className="w-full bg-slate-800 text-white text-xs rounded p-1.5 border border-slate-700 outline-none" value={selectedDeviceId} onChange={handleCameraChange}>
                    {videoDevices.map(d => (<option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${d.deviceId.slice(0,5)}...`}</option>))}
                    {videoDevices.length === 0 && <option>Nenhuma câmera detectada</option>}
                  </select>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] text-slate-500 flex items-center gap-1"><Car size={10} /> Modelo de Inspeção</label>
                    <div className="flex gap-2">
                      <button onClick={handleEditModel} title="Renomear" className="text-slate-500 hover:text-blue-400"><Pencil size={11} /></button>
                      <button onClick={handleDeleteModel} title="Excluir" className="text-slate-500 hover:text-red-400"><Trash2 size={11} /></button>
                      <button onClick={handleAddModel} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-0.5"><Plus size={10} /> NOVO</button>
                    </div>
                  </div>
                  <select className="w-full bg-slate-800 text-white text-xs rounded p-1.5 border border-slate-700 outline-none" value={selectedModel || ''} onChange={(e) => handleModelSelect(e.target.value)}>
                    {availableModels.map(m => (<option key={m.id} value={m.name}>{m.name}</option>))}
                  </select>
                </div>
              </div>

              {/* GUIA DE TREINAMENTO */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-3 pb-0">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Guia de Treinamento</p>
                </div>

                {/* ① PASSO 1 */}
                <div className="px-4 pt-3">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
                    <div>
                      <p className="text-sm font-bold text-white leading-tight">Defina os pontos de inspeção</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Posicione os quadrados sobre cada peça na câmera e dê um nome</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 pl-8">
                    {regions.map(r => (
                      <div key={r.id} onClick={() => setActiveRegionId(r.id)}
                        className={`p-2 rounded border text-xs cursor-pointer relative group transition-all ${r.id === activeRegionId ? 'bg-blue-900/30 border-blue-500/60' : 'bg-slate-800/60 border-slate-700 hover:border-slate-600'}`}>
                        <div className="flex justify-between items-center">
                          <input className="bg-transparent font-semibold text-white outline-none w-28 text-xs" value={r.name}
                            onClick={e => e.stopPropagation()}
                            onChange={(e) => { const v = e.target.value; setRegions(prev => prev.map(reg => reg.id === r.id ? {...reg, name: v} : reg)); }} />
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); handleClearRegionSamples(r.id, r.name); }} className="text-slate-500 hover:text-orange-400" title="Limpar fotos"><Eraser size={11} /></button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteRegion(r.id); }} className="text-slate-500 hover:text-red-500" title="Excluir"><Trash2 size={11} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button onClick={addRegion} className="w-full py-1.5 border border-dashed border-slate-700 hover:border-blue-500/60 text-slate-500 hover:text-blue-400 text-xs rounded flex items-center justify-center gap-1 transition-all">
                      <Plus size={12} /> Adicionar Objeto
                    </button>
                  </div>
                </div>

                <div className="px-7 py-1"><div className="w-px h-4 bg-slate-700 ml-2.5"></div></div>

                {/* ② PASSO 2 */}
                <div className="px-4">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-green-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
                    <div>
                      <p className="text-sm font-bold text-white leading-tight">Mostre peças <span className="text-green-400">APROVADAS</span></p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Posicione peças boas na câmera e grave pelo menos 5 fotos de cada</p>
                    </div>
                  </div>
                  <div className="space-y-2 pl-8">
                    {regions.map(r => {
                      const pct = Math.min(100, (r.samples / 5) * 100);
                      const done = r.samples >= 5;
                      return (
                        <div key={r.id} className="bg-slate-800/60 border border-slate-700 rounded p-2.5">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-xs font-semibold text-slate-300 truncate max-w-[110px]">{r.name}</span>
                            <span className={`text-[10px] font-bold ${done ? 'text-green-400' : 'text-slate-500'}`}>{r.samples}/5{done ? ' ✓' : ''}</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-700 rounded-full mb-2">
                            <div className={`h-1.5 rounded-full transition-all duration-300 ${done ? 'bg-green-500' : 'bg-green-600/60'}`} style={{width: `${pct}%`}}></div>
                          </div>
                          <button onClick={() => { setActiveRegionId(r.id); addObjectExample(null, r.id); }}
                            className="w-full py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 bg-green-700/50 hover:bg-green-600 text-green-100 border border-green-700/40 hover:border-green-500">
                            <Eye size={12} /> Gravar Peça Aprovada
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-7 py-1"><div className="w-px h-4 bg-slate-700 ml-2.5"></div></div>

                {/* ③ PASSO 3 */}
                <div className="px-4">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
                    <div>
                      <p className="text-sm font-bold text-white leading-tight">Mostre o <span className="text-orange-400">FUNDO / Reprovadas</span></p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Campo vazio ou peças com defeito — grave pelo menos 5 fotos</p>
                    </div>
                  </div>
                  <div className="pl-8">
                    <div className="bg-slate-800/60 border border-slate-700 rounded p-2.5">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-semibold text-slate-300">Fundo / Reprovado</span>
                        <span className={`text-[10px] font-bold ${backgroundSamples >= 5 ? 'text-orange-400' : 'text-slate-500'}`}>{backgroundSamples}/5{backgroundSamples >= 5 ? ' ✓' : ''}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-700 rounded-full mb-2">
                        <div className="h-1.5 rounded-full bg-orange-500/70 transition-all duration-300" style={{width: `${Math.min(100, (backgroundSamples / 5) * 100)}%`}}></div>
                      </div>
                      <button onClick={addBackgroundExample}
                        className="w-full py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all bg-orange-600/70 hover:bg-orange-500 text-white border border-orange-600/40 hover:border-orange-400">
                        <Eraser size={12} /> Gravar Fundo / Reprovado
                      </button>
                    </div>
                  </div>
                </div>

                {/* Banner de Status */}
                {(() => {
                  const allObj = regions.every(r => r.samples >= 5);
                  const bgDone = backgroundSamples >= 5;
                  const allReady = allObj && bgDone;
                  const partial = regions.every(r => r.samples >= 3) && backgroundSamples >= 3;
                  if (allReady) return <div className="mx-4 mt-3 p-2.5 rounded-lg border bg-green-500/10 border-green-500/40 text-green-400 text-xs font-bold flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0"></div>✅ Pronto para produção!</div>;
                  if (partial) return <div className="mx-4 mt-3 p-2.5 rounded-lg border bg-yellow-500/10 border-yellow-500/40 text-yellow-400 text-xs font-bold flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0"></div>⚠️ Treinamento mínimo — adicione mais fotos</div>;
                  return <div className="mx-4 mt-3 p-2.5 rounded-lg border bg-slate-800 border-slate-700 text-slate-500 text-xs font-bold flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-600 flex-shrink-0"></div>🔴 Complete o treinamento acima para iniciar</div>;
                })()}

                {isUnbalanced && (
                  <div className="mx-4 mt-2 text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded flex items-start gap-2">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    <p>Equilibre as fotos de peças aprovadas e fundo.</p>
                  </div>
                )}
                <div className="h-3"></div>
              </div>

              {/* RODAPÉ */}
              <div className="border-t border-slate-800 p-3 space-y-2.5">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-500">Sensibilidade de detecção</span>
                    <span className="text-blue-400 font-bold">{(threshold * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min="0.5" max="0.99" step="0.01" value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))} className="w-full accent-blue-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowHistory(true)} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[10px] font-bold rounded border border-slate-700 flex items-center justify-center gap-1">
                    <Database size={11} /> Histórico
                  </button>
                  {currentProjectType === 'metrology' && (
                    <button onClick={() => setViewMode('calibration')} className="flex-1 py-1.5 bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-500 text-[10px] font-bold rounded border border-cyan-500/20 flex items-center justify-center gap-1">
                      <Ruler size={11} /> Calibração
                    </button>
                  )}
                </div>
                <button onClick={handleDeleteAllPhotos} className="w-full py-1 text-slate-600 hover:text-red-500 text-[10px] flex items-center justify-center gap-1 transition-colors rounded hover:bg-red-500/5">
                  <Trash2 size={10} /> Excluir todas as fotos
                </button>
              </div>
            </div>
          )}

          {/* MODO CALIBRATION */}
          {viewMode === 'calibration' && (
            <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 text-slate-300">
              <div className="p-4 border-b border-slate-800 bg-cyan-950/30">
                <h2 className="font-bold text-cyan-400 flex items-center gap-2 mb-2">
                  <Ruler size={18} /> Metrologia
                </h2>
                <p className="text-[10px] text-cyan-300/70">
                  Defina 2 pontos de referência.
                </p>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-slate-800 p-3 rounded border border-slate-700">
                  <h3 className="text-xs font-bold text-white mb-2 uppercase">1. Referência</h3>
                  <div className="flex gap-1 mb-2">
                    {Array(2).fill(0).map((_, i) => (
                      <div key={i} className={`h-2 flex-1 rounded-full ${i < calibrationPoints.length ? 'bg-cyan-500' : 'bg-slate-700'}`}></div>
                    ))}
                  </div>
                  {calibrationPoints.length === 2 ? (
                    <div className="text-xs text-green-400 font-bold flex items-center gap-1"><Check size={12} /> Pontos definidos</div>
                  ) : (
                    <div className="text-xs text-slate-500">Clique na imagem... ({calibrationPoints.length}/2)</div>
                  )}
                </div>

                <div className="bg-slate-800 p-3 rounded border border-slate-700">
                  <h3 className="text-xs font-bold text-white mb-2 uppercase">2. Distância Real</h3>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="number"
                      value={realDistanceInput}
                      onChange={(e) => setRealDistanceInput(e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white font-mono text-center outline-none focus:border-cyan-500"
                    />
                    <span className="text-xs font-bold text-slate-400">mm</span>
                  </div>
                  <button
                    onClick={computeScaleFactor}
                    disabled={calibrationPoints.length !== 2 || !realDistanceInput}
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded text-xs transition-colors"
                  >
                    DEFINIR ESCALA
                  </button>
                </div>

                {scaleFactor && (
                  <div className="bg-green-900/20 border border-green-500/30 p-3 rounded text-center">
                    <span className="text-[10px] text-green-400 font-bold block mb-1">CALIBRADO</span>
                    <div className="text-xl font-mono text-white tracking-widest">
                      {scaleFactor.toFixed(2)} <span className="text-xs text-green-500/70">px/mm</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={resetCalibration}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 font-bold rounded text-xs flex items-center justify-center gap-2"
                >
                  <Eraser size={14} /> LIMPAR TUDO
                </button>
              </div>

              <div className="mt-auto p-4 border-t border-slate-800">
                <button
                  onClick={() => setViewMode('setup')}
                  className="w-full py-3 bg-slate-800 text-slate-400 hover:text-white font-bold rounded text-xs transition-colors"
                >
                  VOLTAR
                </button>
              </div>
            </div>
          )}

          {/* MODO OPERADOR */}
          {viewMode === 'operator' && (
            <div className="flex flex-col h-full">
              <div className="p-4 bg-slate-800 border-b border-slate-700">
                <h2 className="font-bold text-white mb-1 flex items-center gap-2"><Eye size={16} /> Inspeção Ativa</h2>

                {/* Operator Camera Selector */}
                <div className="mt-4 mb-4">
                  <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                    <Camera size={12} /> Câmera
                  </label>
                  <select
                    className="w-full bg-slate-900 text-white text-xs rounded p-2 border border-slate-600 outline-none focus:border-blue-500"
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
      {/* History Modal */}
      {showHistory && <InspectionHistory onClose={() => setShowHistory(false)} />}
    </div>
  );
};

export default App;
