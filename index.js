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
      connectWhatsApp();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const de = msg.key.remoteJid;
    const numeroLimpo = de.replace('@s.whatsapp.net', '');
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    if (!texto) return;

    console.log(`📩 Mensagem de ${numeroLimpo}: ${texto}`);

    try {
      // 1. Extrair dados com Dify EXTRATOR
      let extraido = {};
      try {
        const extracao = await axios.post(
          'https://api.dify.ai/v1/chat-messages',
          {
            inputs: {},
            query: texto,
            response_mode: "blocking",
            user: `extrator-${numeroLimpo}`
          },
          {
            headers: {
              Authorization: 'Bearer app-COzloOTP69Z5MKjSFT8EbuKo',
              'Content-Type': 'application/json'
            }
          }
        );
        extraido = JSON.parse(extracao.data.answer);
      } catch (e) {
        console.error('❌ Erro ao extrair dados com Dify:', e.response?.data || e.message);
      }

      // 2. Verificar se o contato existe
      let { data: contatoExistente } = await supabase
        .from('Contatos')
        .select('*')
        .eq('numero_whatsapp', numeroLimpo)
        .single();

      if (!contatoExistente) {
        // Criar o contato
        await supabase.from('Contatos').insert([{ numero_whatsapp: numeroLimpo }]);
        console.log(`📌 Novo contato adicionado: ${numeroLimpo}`);
      }

      // 3. Atualizar dados extraídos no Supabase
      const atualizacao = {};
      if (extraido.nome) atualizacao.nome = extraido.nome;
      if (extraido.cpf) atualizacao.cpf = extraido.cpf;
      if (extraido.rg) atualizacao.rg = extraido.rg;
      if (extraido.email) atualizacao.email = extraido.email;
      if (extraido.endereco) atualizacao.endereco = extraido.endereco;
      if (extraido.telefone) atualizacao.telefone_alternativo = extraido.telefone;

      if (Object.keys(atualizacao).length > 0) {
        await supabase.from('Contatos')
          .update(atualizacao)
          .eq('numero_whatsapp', numeroLimpo);
        console.log(`🧠 Dados atualizados no Supabase para ${numeroLimpo}:`, atualizacao);
      }

      // 4. Buscar dados atualizados após extração
      const { data: contatoFinal } = await supabase
        .from('Contatos')
        .select('*')
        .eq('numero_whatsapp', numeroLimpo)
        .single();

      // 5. Saudar se for o primeiro contato
      if (!contatoExistente) {
        const mensagemBoasVindas = "Olá! Seja bem-vindo(a) ao atendimento jurídico Clara 👩‍⚖️\nEstou aqui para te ajudar com dúvidas legais, informações sobre processos ou agendamentos. Como posso te chamar?";
        await sock.sendMessage(de, { text: mensagemBoasVindas });
      }

      // 6. Enviar pergunta para o Dify com os dados atualizados
      const resposta = await axios.post(
        'https://api.dify.ai/v1/chat-messages',
        {
          inputs: {
            nome: contatoFinal?.nome || "",
            cpf: contatoFinal?.cpf || "",
            rg: contatoFinal?.rg || "",
            email: contatoFinal?.email || "",
            endereco: contatoFinal?.endereco || "",
            telefone: contatoFinal?.telefone_alternativo || ""
          },
          query: texto,
          response_mode: "blocking",
          user: de
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DIFY_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const respostaTexto = resposta.data.answer;
      await sock.sendMessage(de, { text: respostaTexto });
      console.log(`🤖 Resposta do Dify: ${respostaTexto}`);

      // 7. Salvar histórico
      await supabase.from('historico_mensagens').insert([{
        numero_whatsapp: numeroLimpo,
        mensagem_usuario: texto,
        resposta_chatbot: respostaTexto,
        data_hora: new Date().toISOString()
      }]);

    } catch (err) {
      console.error('❌ Erro ao processar mensagem:', err.message);
    }
  });
}

app.get('/', (req, res) => {
  res.send('Bot WhatsApp rodando. Acesse /qr para escanear o código.');
});

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