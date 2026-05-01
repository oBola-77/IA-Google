
// Armazenamento em memória para imagens de treinamento
// Estes dados serão perdidos ao fechar ou recarregar o navegador
let inMemoryImages = [];

export const openDB = () => Promise.resolve(true);

export const saveImage = async (model, label, url) => {
    const newImage = {
        id: Date.now() + Math.random(),
        model,
        label,
        url,
        timestamp: Date.now()
    };
    inMemoryImages.push(newImage);
    return Promise.resolve(newImage.id);
};

export const getImagesByModel = async (modelName) => {
    return Promise.resolve(inMemoryImages.filter(img => img.model === modelName));
};

export const getAllImages = async () => {
    return Promise.resolve([...inMemoryImages]);
};

export const deleteImagesByModel = async (modelName) => {
    inMemoryImages = inMemoryImages.filter(img => img.model !== modelName);
    return Promise.resolve();
};

export const clearAllImages = async () => {
    inMemoryImages = [];
    return Promise.resolve();
};

export const updateModelName = async (oldName, newName) => {
    inMemoryImages = inMemoryImages.map(img => {
        if (img.model === oldName) {
            const updated = { ...img, model: newName };
            if (updated.label && updated.label.includes(oldName)) {
                updated.label = updated.label.replace(oldName, newName);
            }
            return updated;
        }
        return img;
    });
    return Promise.resolve();
};

export const bulkInsertImages = async (images) => {
    const imagesWithTimestamp = images.map(img => ({
        ...img,
        id: img.id || (Date.now() + Math.random()),
        timestamp: img.timestamp || Date.now()
    }));
    inMemoryImages.push(...imagesWithTimestamp);
    return Promise.resolve();
};

export const deleteImagesByLabel = async (label) => {
    inMemoryImages = inMemoryImages.filter(img => img.label !== label);
    return Promise.resolve();
};
