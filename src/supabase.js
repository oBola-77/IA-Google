
// Mock do Supabase para funcionamento local (100% offline)
// Os dados são mantidos no localStorage e persistem entre sessões

const getLocalStore = () => {
  try {
    const store = localStorage.getItem('supabase_mock_store');
    return store ? JSON.parse(store) : { models: [], inspections: [], training_samples: [] };
  } catch (e) {
    return { models: [], inspections: [], training_samples: [] };
  }
};

const saveLocalStore = (store) => {
  try {
    localStorage.setItem('supabase_mock_store', JSON.stringify(store));
  } catch (e) {
    console.error("Erro ao salvar no localStorage:", e);
  }
};

// Funções auxiliares para simular o comportamento da query do Supabase
const createQuery = (tableName) => {
  const store = getLocalStore();
  let data = (store[tableName] || []).slice(); // Cópia para não mutar direto

  const query = {
    select: () => query,
    order: (column, options) => {
      data.sort((a, b) => {
        if (options?.ascending) return a[column] > b[column] ? 1 : -1;
        return a[column] < b[column] ? 1 : -1;
      });
      return query;
    },
    limit: (n) => {
      data = data.slice(0, n);
      return query;
    },
    eq: (column, value) => {
      data = data.filter(item => item[column] === value);
      return query;
    },
    insert: (rows) => {
      const rowsArr = Array.isArray(rows) ? rows : [rows];
      const newRows = rowsArr.map(row => ({
        id: Math.random().toString(36).substr(2, 9),
        created_at: new Date().toISOString(),
        ...row
      }));
      const currentStore = getLocalStore();
      if (!currentStore[tableName]) currentStore[tableName] = [];
      currentStore[tableName].push(...newRows);
      saveLocalStore(currentStore);
      const q2 = {
        select: () => Promise.resolve({ data: newRows, error: null }),
        then: (resolve) => resolve({ data: newRows, error: null })
      };
      return q2;
    },
    update: (updates) => ({
      eq: (column, value) => {
        const currentStore = getLocalStore();
        currentStore[tableName] = (currentStore[tableName] || []).map(item =>
          item[column] === value ? { ...item, ...updates } : item
        );
        saveLocalStore(currentStore);
        return Promise.resolve({ data: null, error: null });
      }
    }),
    delete: () => ({
      eq: (column, value) => {
        const currentStore = getLocalStore();
        currentStore[tableName] = (currentStore[tableName] || []).filter(item => item[column] !== value);
        saveLocalStore(currentStore);
        return Promise.resolve({ data: null, error: null });
      }
    }),
    // Resolve quando o resultado é aguardado com await
    then: (resolve) => resolve({ data, error: null })
  };

  return query;
};

export const supabase = {
  from: (tableName) => createQuery(tableName),
  storage: {
    from: () => ({
      remove: () => Promise.resolve({ data: null, error: null }),
      upload: () => Promise.resolve({ data: { path: '' }, error: null }),
      download: () => Promise.resolve({ data: null, error: null }),
      getPublicUrl: (path) => ({ data: { publicUrl: path } })
    })
  }
};
