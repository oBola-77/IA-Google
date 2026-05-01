import React, { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  BoxSelect, Trash2, Plus, Pencil,
  Check, X, Layout, Eraser,
  Lock, Unlock, Settings, Save, Database, AlertTriangle, Eye,
  ScanBarcode, ArrowRight, Camera, Car
} from 'lucide-react';
import { saveImage, getImagesByModel, deleteImagesByModel, clearAllImages, updateModelName, bulkInsertImages, deleteImagesByLabel } from './db';
import { supabase } from './supabase';
import InspectionHistory from './InspectionHistory';

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

  // Fetch models from Supabase on load
  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .order('name');
      if (error) throw error;
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

  const handleAddModel = async () => {
    const name = window.prompt("Nome do novo modelo:");
    if (!name || name.trim() === "") return;

    if (availableModels.some(m => m.name === name)) {
      alert("Modelo já existe!");
      return;
    }

    try {
      const { error } = await supabase
        .from('models')
        .insert([{
          name,
          config: {
            regions: [{ id: '1', name: `Objeto 1 (${name})`, box: { x: 50, y: 50, w: 150, h: 150 }, samples: 0, status: null, confidence: 0 }],
            backgroundSamples: 0
          }
        }]);

      if (error) throw error;

      await fetchModels();
      // Optionally switch to it immediately - but requires full sync flow
      handleStartScreenModelSelect(name);
    } catch (e) {
      console.error("Erro ao criar modelo:", e);
      alert("Erro ao criar modelo.");
    }
  };

  const handleEditModel = async () => {
    if (!selectedModel) return;
    const modelId = getCurrentModelId();
    if (!modelId) return;

    const newName = window.prompt("Novo nome para o modelo:", selectedModel);
    if (!newName || newName.trim() === "" || newName === selectedModel) return;

    if (availableModels.some(m => m.name === newName)) {
      alert("Já existe um modelo com este nome!");
      return;
    }

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
      alert(`Modelo renomeado para "${newName}" com sucesso!`);
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

    // Use modelsData.current which is synced in the useEffect below
    const currentConfig = modelsData.current[modelName];
    if (!currentConfig) return;

    // 1. Update LocalStorage (Backup)
    try {
      localStorage.setItem(`modelData:${modelName}`, JSON.stringify(currentConfig));
    } catch (e) {
      console.error("Erro saving config to localStorage:", e);
    }

    // 2. Update Supabase
    const modelId = getCurrentModelId();
    if (modelId) {
      try {
        await supabase.from('models').update({
          config: currentConfig
        }).eq('id', modelId);
      } catch (e) {
        console.error("Erro saving config to cloud:", e);
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
    // REMOVIDO: localStorage.setItem(key, JSON.stringify(regions));
    // O salvamento agora ocorre apenas no handleMouseUp para evitar travamentos
  }, [regions]);

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

      // Salvar (Cloud + Local)
      try {
        const imageBase64 = captureCropBase64(activeRegion.box);
        if (imageBase64 && selectedModel) {
          // 1. Local Cache (for immediate use if needed)
          await saveImage(selectedModel, getClassLabel(activeRegion.id), imageBase64);

          // 2. Cloud Upload (Background)
          const modelId = getCurrentModelId();
          if (modelId) {
            // Base64 -> Blob
            const res = await fetch(imageBase64);
            const blob = await res.blob();

            const filePath = `${modelId}/${Date.now()}.jpg`;

            // Upload Image
            const { error: uploadError } = await supabase.storage
              .from('training_datasets')
              .upload(filePath, blob);

            if (!uploadError) {
              // Insert Record
              await supabase.from('training_samples').insert({
                model_id: modelId,
                label: getClassLabel(activeRegion.id),
                image_path: filePath
              });
            } else {
              console.error("Erro upload Supabase:", uploadError);
            }
          }
        }
        console.log(`Imagem salva localmente com sucesso!`);
      } catch (err) {
        console.error('Erro no upload local:', err);
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

        // Salvar 
        try {
          const imageBase64 = captureCropBase64(region.box);
          if (imageBase64) {
            // 1. Local
            await saveImage(selectedModel, 'background', imageBase64);

            // 2. Cloud
            if (modelId) {
              const res = await fetch(imageBase64);
              const blob = await res.blob();
              const filePath = `${modelId}/bg_${Date.now()}_${region.id}.jpg`;

              const { error } = await supabase.storage.from('training_datasets').upload(filePath, blob);
              if (!error) {
                await supabase.from('training_samples').insert({
                  model_id: modelId,
                  label: 'background',
                  image_path: filePath
                });
              }
            }
          }
        } catch (err) {
          console.error('Erro no upload de fundo local:', err);
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

      const modelId = getCurrentModelId();

      // 1. Cloud Cleanup
      if (modelId) {
        // Get all files to delete
        const { data: samples } = await supabase
          .from('training_samples')
          .select('image_path')
          .eq('model_id', modelId);

        if (samples && samples.length > 0) {
          const paths = samples.map(s => s.image_path);
          // Delete from bucket
          await supabase.storage.from('training_datasets').remove(paths);

          // Delete from table
          await supabase.from('training_samples').delete().eq('model_id', modelId);
        }
      }

      // 2. Local Cleanup
      // deleteImagesByModel deletes everything with `model` index matching selectedModel
      await deleteImagesByModel(selectedModel);
      // Also need to clear background? Currently background might be saved as 'background' or 'model::background'. 
      // In addBackgroundExample we used: saveImage(selectedModel, 'background', ...) -> So it has model=selectedModel.
      // So deleteImagesByModel(selectedModel) should catch it.

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
    return () => { if (predictRef.current) cancelAnimationFrame(predictRef.current); };
  }, [isPredicting, currentBarcode, threshold]);

  const uploadImage = async (base64Image, barcode) => {
    try {
      const blob = await fetch(base64Image).then(res => res.blob());
      const filename = `${Date.now()}_${barcode}.jpg`;
      const { data, error } = await supabase.storage
        .from('inspection_snapshots')
        .upload(filename, blob);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('inspection_snapshots')
        .getPublicUrl(filename);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      return null;
    }
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

    let snapshot = captureFullScreenshot();

    // Save to Supabase
    let imageUrl = null;
    if (snapshot) {
      imageUrl = await uploadImage(snapshot, currentBarcode);
    }

    const newInspection = {
      barcode: currentBarcode,
      model_name: selectedModel,
      status: allOk ? 'APROVADO' : 'REPROVADO',
      image_url: imageUrl,
      details: regions.map(r => ({
        name: r.name,
        status: r.status,
        confidence: r.confidence
      }))
    };

    const { data, error } = await supabase.from('inspections').insert([newInspection]).select();

    if (error) {
      console.error('Error saving inspection:', error);
      // alert('Erro ao salvar inspeção no servidor.'); // Opcional: alertar o usuário
    }

    const newEntry = {
      id: data ? data[0].id : Date.now(),
      code: currentBarcode,
      timestamp: new Date().toLocaleString(),
      status: allOk ? 'APROVADO' : 'REPROVADO',
      image: snapshot, // Use base64 locally for instant feedback
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

  /* --- Cloud Sync & Loading --- */
  const handleStartScreenModelSelect = async (modelName) => {
    setIsSyncing(true);
    setSyncStatus('Iniciando sincronização...');

    try {
      // 1. Find Model Config
      const modelObj = availableModels.find(m => m.name === modelName);
      if (!modelObj) throw new Error("Modelo não encontrado");

      // 2. Load Config into Memory/Cache
      // Assuming 'config' matches our internal structure or needs adaptation
      // We'll update the 'modelsData' ref which is used by `handleModelSelect`
      modelsData.current[modelName] = {
        regions: modelObj.config.regions || [],
        backgroundSamples: modelObj.config.backgroundSamples || 0,
        dataset: null // Will be trained from images
      };

      // 3. Clear Local Training Images
      await clearAllImages();

      // 4. Fetch Samples List
      setSyncStatus('Buscando imagens na nuvem...');
      const { data: samples, error: samplesError } = await supabase
        .from('training_samples')
        .select('*')
        .eq('model_id', modelObj.id);

      if (samplesError) throw samplesError;

      if (samples && samples.length > 0) {
        setSyncStatus(`Baixando ${samples.length} imagens...`);

        // 5. Download Images
        const imagesToInsert = [];
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i];
          const { data: blob } = await supabase.storage.from('training_datasets').download(sample.image_path);
          if (blob) {
            const url = URL.createObjectURL(blob);
            imagesToInsert.push({
              model: modelName, // IndexedDB uses name currently
              label: sample.label,
              url: url
            });
          }
          if (i % 5 === 0) setSyncStatus(`Baixando ${i + 1}/${samples.length}...`);
        }

        // 6. Bulk Insert to Local DB
        setSyncStatus('Salvando localmente...');
        await bulkInsertImages(imagesToInsert);
      }

      setSyncStatus('Finalizando...');
      handleModelSelect(modelName);
      setViewMode('operator');

    } catch (e) {
      console.error("Sync Error:", e);
      alert("Erro ao sincronizar modelo: " + e.message);
    } finally {
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
        <div className="max-w-md w-full bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl p-8 text-center">
          <div className="bg-blue-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <Car size={32} className="text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Selecione o Modelo</h1>
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
    if (viewMode !== 'setup') return;
    const { x, y } = getClientCoordinates(e);

    const metrics = getVideoContentRect();
    if (!metrics) return;

    const { rect, offsetX, offsetY, scale } = metrics;

    // Converte coordenadas da tela para pixels intrínsecos do video
    const mouseX = ((x - rect.left) - offsetX) * scale;
    const mouseY = ((y - rect.top) - offsetY) * scale;

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
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-slate-400 flex items-center gap-1">
                      <Car size={12} /> Modelo do Carro
                    </label>
                    <div className="flex gap-2">
                      <button onClick={handleEditModel} title="Renomear Modelo" className="text-slate-400 hover:text-blue-400 transition-colors">
                        <Pencil size={12} />
                      </button>
                      <button onClick={handleDeleteModel} title="Excluir Modelo" className="text-slate-400 hover:text-red-400 transition-colors">
                        <Trash2 size={12} />
                      </button>
                      <button onClick={handleAddModel} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold flex items-center gap-0.5 ml-1">
                        <Plus size={10} /> NOVO
                      </button>
                    </div>
                  </div>
                  <select
                    className="w-full bg-slate-700 text-white text-xs rounded p-2 border border-slate-600 outline-none"
                    value={selectedModel || ''}
                    onChange={(e) => handleModelSelect(e.target.value)}
                  >

                    {availableModels.map(model => (
                      <option key={model.id} value={model.name}>{model.name}</option>
                    ))}
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

                <button onClick={addRegion} className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs font-bold rounded border border-slate-700 flex justify-center items-center gap-1 mb-2">
                  <Plus size={14} /> NOVO OBJETO
                </button>
                <button
                  onClick={() => setShowHistory(true)}
                  className="w-full py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 hover:text-blue-400 text-xs font-bold rounded border border-blue-500/20 flex justify-center items-center gap-1"
                >
                  <Database size={14} /> HISTÓRICO COMPLETO
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
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteRegion(r.id) }} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500"><Trash2 size={14} /></button>
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

                {/* Botão de Exclusão de Emergência */}
                <button
                  onClick={handleDeleteAllPhotos}
                  className="w-full mt-3 py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-600/30 text-red-500 rounded flex justify-center items-center gap-2 text-xs font-bold active:scale-95 transition-transform"
                >
                  <Trash2 size={14} /> EXCLUIR TODAS AS FOTOS
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
