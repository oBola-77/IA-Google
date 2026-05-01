import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import { MetrologyProvider } from './MetrologyContext';

// --- TRAVA DE SEGURANÇA ---
// Impede que o código rode em domínios não autorizados. 
// Substitua 'seu-dominio-oficial.com' pelo seu domínio real antes de publicar.
const DOMINIOS_AUTORIZADOS = ['localhost', '127.0.0.1', 'iautomotivo.com.br', 'www.iautomotivo.com.br', 'inspector.iautomotivo.com.br'];
if (!DOMINIOS_AUTORIZADOS.includes(window.location.hostname)) {
    document.body.innerHTML = '<div style="background:#000;color:#f00;padding:50px;text-align:center;font-family:sans-serif;"><h1>ACESSO NÃO AUTORIZADO</h1><p>Este software é protegido por licença.</p></div>';
    throw new Error("Domínio não autorizado.");
}
// --------------------------

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <MetrologyProvider>
            <App />
        </MetrologyProvider>
    </React.StrictMode>,
)
