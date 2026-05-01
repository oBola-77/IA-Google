
export const updateModelName = async (oldName, newName) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('model');
        const request = index.openCursor(IDBKeyRange.only(oldName));

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const updateData = cursor.value;
                updateData.model = newName;
                // Update label too if it contains the model name? 
                // Currently labels are like "Polo Track::1" or "Polo Track::background"
                if (updateData.label && updateData.label.includes(oldName)) {
                    updateData.label = updateData.label.replace(oldName, newName);
                }

                cursor.update(updateData);
                cursor.continue();
            } else {
                resolve();
            }
        };
        request.onerror = () => reject(request.error);
    });
};
