require('dotenv').config();
const { Pool } = require('pg');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const express = require('express');
const axios = require('axios');
const { default: makeWASocket, useMultiFileAuthState } = require('baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

let currentQrCode = null;

async function connectWhatsApp() {
  const authPath = path.join(__dirname, 'auth');
  fs.mkdirSync(authPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Chrome', 'Linux', '110.0.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;

    if (qr) {
      currentQrCode = await qrcode.toDataURL(qr);
      console.log('QR code gerado. Acesse /qr para escanear.');
    }

    if (connection === 'open') {
      console.log('✅ Conectado ao WhatsApp!');
      currentQrCode = null;
    }

    if (connection === 'close') {
      console.log('❌ Conexão encerrada. Tentando reconectar...');
      connectWhatsApp(); // reconecta automaticamente
    }
  });

  // Integração com Dify
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const de = msg.key.remoteJid;
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

    if (!texto) return;

    console.log(`📩 Mensagem de ${de}: ${texto}`);

    try {
      const resposta = await axios.post('https://api.dify.ai/v1/chat-messages', {
        inputs: {},
        query: texto,
        response_mode: "blocking",
        user: de
      }, {
        headers: {
          Authorization: `Bearer ${process.env.DIFY_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      const respostaTexto = resposta.data.answer;
      console.log(`🤖 Resposta do Dify: ${respostaTexto}`);

      await sock.sendMessage(de, { text: respostaTexto });

    } catch (err) {
      console.error('Erro ao integrar com Dify:', err.message);
      await sock.sendMessage(de, { text: "❌ Ocorreu um erro ao responder. Tente novamente mais tarde." });
    } 
    try {
  // Verifica se o número já está cadastrado em Contatos
  const checkContato = await db.query(
    'SELECT * FROM Contatos WHERE numero_whatsapp = $1',
    [de]
  );

  if (checkContato.rows.length === 0) {
    // Se não estiver, insere como novo contato (com dados vazios inicialmente)
    await db.query(
      'INSERT INTO Contatos (numero_whatsapp, nome, cpf, rg, outros_dados) VALUES ($1, $2, $3, $4, $5)',
      [de, null, null, null, null]
    );
  }

  // Insere histórico da conversa
  await db.query(
    'INSERT INTO historico_mensagens (numero_whatsapp, mensagem_usuario, resposta_chatbot, data_hora) VALUES ($1, $2, $3, NOW())',
    [de, texto, respostaTexto]
  );

  console.log(`💾 Histórico salvo no banco para ${de}`);

} catch (err) {
  console.error('❌ Erro ao salvar no banco:', err.message);
}

  });
}

// Rota principal
app.get('/', (req, res) => {
  res.send('Bot WhatsApp rodando. Acesse /qr para escanear o código.');
});

// Rota do QR Code
app.get('/qr', (req, res) => {
  if (currentQrCode) {
    res.send(`<img src="${currentQrCode}" />`);
  } else {
    res.send('QR code não disponível no momento. Talvez já esteja conectado.');
  }
});

connectWhatsApp();

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
