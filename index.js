require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { default: makeWASocket, useMultiFileAuthState } = require('baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
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

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const de = msg.key.remoteJid;
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    if (!texto) return;

    console.log(`📩 Mensagem de ${de}: ${texto}`);

    try {
const numeroLimpo = de.replace('@s.whatsapp.net', '');

  const { data: contatoExistente } = await supabase
    .from('Contatos')
    .select('*')
    .eq('numero_whatsapp', numeroLimpo)
    .single();

  let saudacao = '';
  if (contatoExistente?.nome) {
    saudacao = `Olá ${contatoExistente.nome.split(' ')[0]}, tudo bem?\n`;
  }

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

  const respostaTexto = saudacao + resposta.data.answer;
        inputs: {}
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

      // 🔁 SUPABASE - salvar contato e histórico
      const { data: contatoExistente } = await supabase
        .from('Contatos')
        .select('*')
        .eq('numero_whatsapp', de)
        .single();

      if (!contatoExistente) {
        await supabase.from('Contatos').insert([{
          numero_whatsapp: de,
          nome: null,
          cpf: null,
          rg: null,
          outros_dados: null
        }]);
      }

      await supabase.from('historico_mensagens').insert([{
        numero_whatsapp: de,
        mensagem_usuario: texto,
        resposta_chatbot: respostaTexto,
        data_hora: new Date().toISOString()
      }]);

      console.log(`💾 Histórico salvo no Supabase para ${de}`);
    } catch (err) {
      console.error('❌ Erro ao processar mensagem:', err.message);
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
