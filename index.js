require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal'); // Para exibir o QR code no terminal localmente
const axios = require('axios');
const { Pool } = require('pg');

// Configurar o pool do Supabase
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// Dados da Dify
const difyApiKey = process.env.DIFY_API_KEY;
const difyEndpoint = 'https://api.dify.ai/v1/chat-messages';

// Função para conectar ao WhatsApp
async function connectWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true // Isso só é útil em ambiente local; em Railway você pode precisar de outra abordagem
    });

    sock.ev.on('creds.update', saveCreds);

	sock.ev.on('connection.update', (update) => {
   	 console.log('Update de conexão:', update);
 	   const { connection, lastDisconnect, qr } = update;
 	   if (qr) {
 	       qrcode.generate(qr, { small: true });
	    }
  	  if (connection === 'close') {
 	       const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Conexão fechada. Tentando reconectar...', shouldReconnect);
   	     if (shouldReconnect) connectWhatsApp();
 	   } else if (connection === 'open') {
  	      console.log('✅ WhatsApp conectado com sucesso!');
  	  }
	});


    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const userMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        console.log(`Mensagem recebida de ${sender}: ${userMessage}`);

        // Registro da mensagem no Supabase (opcional)
        await pool.query('INSERT INTO mensagens (usuario, mensagem) VALUES ($1, $2)', [sender, userMessage]);

        // Obter resposta do Chatbot Dify
        try {
            const difyResponse = await axios.post(difyEndpoint, {
                inputs: { query: userMessage },
                user: sender
            }, {
                headers: {
                    'Authorization': `Bearer ${difyApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const botReply = difyResponse.data.answer;

            console.log(`Resposta Dify para ${sender}: ${botReply}`);

            // Enviar resposta via WhatsApp
            await sock.sendMessage(sender, { text: botReply });

            // Registro da resposta no Supabase (opcional)
            await pool.query('INSERT INTO mensagens (usuario, mensagem, enviado_por_bot) VALUES ($1, $2, $3)', [sender, botReply, true]);

        } catch (error) {
            console.error('Erro ao obter resposta da Dify:', error);
            await sock.sendMessage(sender, { text: 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.' });
        }
    });
}

connectWhatsApp();
