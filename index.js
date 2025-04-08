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
        let respostaTexto = "";
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
        respostaTexto = resposta.data.answer;
        await sock.sendMessage(de, { text: respostaTexto });
        console.log(`🤖 Resposta do Dify: ${respostaTexto}`);
      } catch (erro) {
        if (erro.response?.status === 504) {
          await sock.sendMessage(de, { text: '⚠️ O servidor está temporariamente indisponível. Tente novamente em instantes.' });
        } else {
          await sock.sendMessage(de, { text: '❌ Ocorreu um erro ao processar sua mensagem. Tente mais tarde.' });
        }
        console.error("Erro ao processar mensagem:", erro.message || erro);
        return;
      }

      // 1. Extrair dados com Dify EXTRATOR
      let extraido = {};
      
      try {
        let respostaTexto = "";
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
        respostaTexto = resposta.data.answer;
        await sock.sendMessage(de, { text: respostaTexto });
        console.log(`🤖 Resposta do Dify: ${respostaTexto}`);
      } catch (erro) {
        if (erro.response?.status === 504) {
          await sock.sendMessage(de, { text: '⚠️ O servidor está temporariamente indisponível. Tente novamente em instantes.' });
        } else {
          await sock.sendMessage(de, { text: '❌ Ocorreu um erro ao processar sua mensagem. Tente mais tarde.' });
        }
        console.error("Erro ao processar mensagem:", erro.message || erro);
        return;
      }

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
              Authorization: `Bearer ${process.env.DIFY_EXTRATOR_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        extraido = JSON.parse(extracao.data.answer);
      } catch (e) { // Corrigido o parêntese
        console.error('❌ Erro ao extrair dados com Dify:', e.response?.data || e.message);
      }

      
      // 1.1 Verificar se há solicitação de mudança de número
      if (extraido && typeof extraido === 'object' && 'novo_numero' in extraido && 'cpf_confirmacao' in extraido) {
        if (extraido.novo_numero && extraido.cpf_confirmacao) {
          const { data: contatoOriginal, error } = await supabase
            .from('Contatos')
            .select('*')
            .eq('numero_whatsapp', numeroLimpo)
            .maybeSingle();

          if (!error && contatoOriginal?.cpf === extraido.cpf_confirmacao) {
            const { error: erroUpdate } = await supabase
              .from('Contatos')
              .update({ numero_whatsapp: extraido.novo_numero })
              .eq('id', contatoOriginal.id);

            if (!erroUpdate) {
              await sock.sendMessage(de, { text: '✅ Seu número foi atualizado com sucesso!' });
              console.log(`🔁 Número alterado para ${extraido.novo_numero}`);
            } else {
              console.error('Erro ao atualizar número:', erroUpdate.message);
            }
            
          // após atualizar, reatribui os dados do novo número para manter consistência
          const { data: novoContatoFinal } = await supabase
            .from('Contatos')
            .select('*')
            .eq('numero_whatsapp', extraido.novo_numero)
            .maybeSingle();

          contatoFinal = novoContatoFinal;
          de = extraido.novo_numero + "@s.whatsapp.net";

          return; // encerra o fluxo aqui
          } else {
            await sock.sendMessage(de, { text: '⚠️ Para atualizar seu número, confirme seu CPF corretamente.' });
            return;
          }
        }
      }


      // 2 e 3. Verificar se o contato existe e atualizar ou inserir
      const atualizacao = {};
      if (extraido.nome) atualizacao.nome = extraido.nome;
      if (extraido.cpf) atualizacao.cpf = extraido.cpf;
      if (extraido.rg) atualizacao.rg = extraido.rg;
      if (extraido.email) atualizacao.email = extraido.email;
      if (extraido.endereco) atualizacao.endereco = extraido.endereco;
      if (extraido.telefone) atualizacao.telefone_alternativo = extraido.telefone;

      if (Object.keys(atualizacao).length > 0) {
        const { data: existente, error: erroBuscaContato } = await supabase
          .from('Contatos')
          .select('id')
          .eq('numero_whatsapp', numeroLimpo)
          .maybeSingle();

        if (erroBuscaContato && erroBuscaContato.code !== 'PGRST116') {
          console.error('Erro ao buscar contato:', erroBuscaContato.message);
        } else if (existente) {
          const { error: erroAtualizacao } = await supabase
            .from('Contatos')
            .update(atualizacao)
            .eq('numero_whatsapp', numeroLimpo);

          if (erroAtualizacao) {
            console.error('Erro ao atualizar contato:', erroAtualizacao.message);
          } else {
            console.log(`🧠 Dados atualizados no Supabase para ${numeroLimpo}:`, atualizacao);
          }
        } else {
          const { error: erroInsercao } = await supabase
            .from('Contatos')
            .insert([{ numero_whatsapp: numeroLimpo, ...atualizacao }]);

          if (erroInsercao) {
            console.error('Erro ao inserir novo contato:', erroInsercao.message);
          } else {
            console.log(`🆕 Novo contato inserido no Supabase para ${numeroLimpo}:`, atualizacao);
          }
        }
      }

      // 4. Buscar dados atualizados após extração
      const { data: contatoFinal } = await supabase
        .from('Contatos')
        .select('*')
        .eq('numero_whatsapp', numeroLimpo)
        .single();
	console.log('🔎 Dados recuperados do Supabase:', contatoFinal);

      // 5. Saudar se for o primeiro contato
      if (!contatoFinal?.nome) {
        const mensagemBoasVindas = "Olá! Seja bem-vindo(a) ao atendimento jurídico Clara 👩‍⚖️\nEstou aqui para te ajudar com dúvidas legais, informações sobre processos ou agendamentos. Como posso te chamar?";
        await sock.sendMessage(de, { text: mensagemBoasVindas });
      }

      // 6. Enviar pergunta para o Dify com os dados atualizados

      
      let respostaTexto = "";
      
      try {
        let respostaTexto = "";
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
        respostaTexto = resposta.data.answer;
        await sock.sendMessage(de, { text: respostaTexto });
        console.log(`🤖 Resposta do Dify: ${respostaTexto}`);
      } catch (erro) {
        if (erro.response?.status === 504) {
          await sock.sendMessage(de, { text: '⚠️ O servidor está temporariamente indisponível. Tente novamente em instantes.' });
        } else {
          await sock.sendMessage(de, { text: '❌ Ocorreu um erro ao processar sua mensagem. Tente mais tarde.' });
        }
        console.error("Erro ao processar mensagem:", erro.message || erro);
        return;
      }

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
        respostaTexto = resposta.data.answer;
        await sock.sendMessage(de, { text: respostaTexto });
        console.log(`🤖 Resposta do Dify: ${respostaTexto}`);
      } catch (erro) {
        if (erro.response?.status === 504) {
          await sock.sendMessage(de, { text: '⚠️ O servidor está temporariamente indisponível. Tente novamente em instantes.' });
        } else {
          await sock.sendMessage(de, { text: '❌ Ocorreu um erro ao processar sua mensagem. Tente mais tarde.' });
        }
        console.error("Erro ao processar mensagem:", erro.message || erro);
        return;
      }

        } else {
          await sock.sendMessage(de, { text: '❌ Ocorreu um erro ao processar sua mensagem. Tente mais tarde.' });
        }
        console.error("Erro ao processar mensagem:", erro.message || erro);
        return;
      }

      await sock.sendMessage(de, { text: respostaTexto });
      console.log(`🤖 Resposta do Dify: ${respostaTexto}`);

      
      let respostaTexto = "";
      
      try {
        let respostaTexto = "";
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
        respostaTexto = resposta.data.answer;
        await sock.sendMessage(de, { text: respostaTexto });
        console.log(`🤖 Resposta do Dify: ${respostaTexto}`);
      } catch (erro) {
        if (erro.response?.status === 504) {
          await sock.sendMessage(de, { text: '⚠️ O servidor está temporariamente indisponível. Tente novamente em instantes.' });
        } else {
          await sock.sendMessage(de, { text: '❌ Ocorreu um erro ao processar sua mensagem. Tente mais tarde.' });
        }
        console.error("Erro ao processar mensagem:", erro.message || erro);
        return;
      }

        
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